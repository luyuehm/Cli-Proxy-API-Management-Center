import type { ApiError } from '@/types';

/**
 * Machine-readable reasons returned by the Management API when an access check
 * fails. They mirror `AuthReason*` in the CLIProxyAPI management package
 * (`internal/api/handlers/management/auth_errors.go`).
 *
 * Keep this list in sync with the backend: an unknown code falls back to the
 * HTTP-status prompt, which is still friendly but less specific.
 */
export const AUTH_ERROR_CODES = {
  missingKey: 'management_key_missing',
  invalidKey: 'management_key_invalid',
  keyNotConfigured: 'management_key_not_configured',
  remoteDisabled: 'remote_management_disabled',
  rateLimited: 'too_many_failed_attempts',
} as const;

export type LoginPromptKey =
  | 'login.error_remote_disabled'
  | 'login.error_ip_not_allowed'
  | 'login.error_key_unusable'
  | 'login.error_rate_limited'
  | 'login.error_unauthorized'
  | 'login.error_forbidden'
  | 'login.error_not_found'
  | 'login.error_server'
  | 'login.error_network'
  | 'login.error_timeout'
  | 'login.error_ssl'
  | 'login.error_cors'
  | 'login.error_invalid';

export interface LoginPrompt {
  /** i18n key of the friendly, user-facing prompt. */
  key: LoginPromptKey;
  /** Seconds to wait before retrying, when the server supplied a window. */
  retryAfter?: number;
  /**
   * True when the failure came from something in front of the Management API
   * (an allowlist, WAF, or reverse proxy) rather than from the API itself.
   */
  blockedBeforeBackend?: boolean;
}

/**
 * Structured inputs used to pick a prompt. Extracted separately from React so
 * the decision table can be unit tested without mounting the page.
 */
export interface LoginFailureInput {
  status?: number;
  /** Machine-readable code from the error envelope's `error` field. */
  apiCode?: string;
  /** Axios transport code, e.g. `ERR_NETWORK`. */
  transportCode?: string;
  /** Raw response body, used only to detect a non-JSON proxy rejection. */
  responseBody?: unknown;
}

/** Reads the retry window the backend reports for a temporary ban. */
const readRetryAfter = (body: unknown): number | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const value = (body as { retry_after?: unknown }).retry_after;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.ceil(value);
};

/**
 * Detects a response that did not come from the Management API. The API always
 * answers with a JSON envelope, so a 403 whose body is absent, HTML or plain
 * text can only have been produced by something in front of it — an IP
 * allowlist, a WAF, or a reverse proxy.
 */
const looksLikeNonApiResponse = (body: unknown): boolean => {
  if (body == null) {
    // The API always sends an envelope for a 403, so no body means no API.
    return true;
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed === '' || (!trimmed.startsWith('{') && !trimmed.startsWith('['));
  }
  return false;
};

/**
 * Maps one failed login to a friendly prompt.
 *
 * The result is a decision, not a string: the caller resolves `key` through
 * i18n. Raw backend text, provider names, HTML and infrastructure details are
 * deliberately never part of the prompt — they stay in the browser console for
 * operators and in the server log.
 */
export const resolveLoginPrompt = (input: LoginFailureInput): LoginPrompt => {
  const { status, apiCode, transportCode = '', responseBody } = input;

  // No HTTP status means the request never reached the server.
  if (status === undefined) {
    if (transportCode === 'ECONNABORTED') {
      return { key: 'login.error_timeout' };
    }
    if (transportCode === 'ERR_CERT_AUTHORITY_INVALID') {
      return { key: 'login.error_ssl' };
    }
    return { key: 'login.error_network' };
  }

  // Server-reported machine codes are the most specific signal.
  switch (apiCode) {
    case AUTH_ERROR_CODES.remoteDisabled:
      return { key: 'login.error_remote_disabled' };
    case AUTH_ERROR_CODES.keyNotConfigured:
    case AUTH_ERROR_CODES.invalidKey:
    case AUTH_ERROR_CODES.missingKey:
      return { key: 'login.error_key_unusable' };
    case AUTH_ERROR_CODES.rateLimited:
      return {
        key: 'login.error_rate_limited',
        retryAfter: readRetryAfter(responseBody),
      };
    default:
      break;
  }

  if (status === 401) {
    return { key: 'login.error_unauthorized' };
  }

  if (status === 403) {
    // A 403 without the API's envelope means the request was stopped before it
    // reached the Management API — typically an IP allowlist or WAF rule.
    if (looksLikeNonApiResponse(responseBody)) {
      return { key: 'login.error_ip_not_allowed', blockedBeforeBackend: true };
    }
    return { key: 'login.error_forbidden' };
  }

  if (status === 404) {
    return { key: 'login.error_not_found' };
  }

  if (status >= 500) {
    return { key: 'login.error_server' };
  }

  return { key: 'login.error_invalid' };
};

/**
 * Builds the prompt for a thrown login error.
 *
 * The raw message is inspected only for transport classification; it is never
 * rendered.
 */
export const promptForLoginError = (error: unknown): LoginPrompt => {
  const apiError = error as Partial<ApiError> & { code?: unknown };
  const status = typeof apiError?.status === 'number' ? apiError.status : undefined;
  const apiCode =
    typeof apiError?.apiCode === 'string' && apiError.apiCode.trim() !== ''
      ? apiError.apiCode.trim()
      : undefined;
  const transportCode = typeof apiError?.code === 'string' ? apiError.code : undefined;
  const message = typeof apiError?.message === 'string' ? apiError.message : '';

  const input: LoginFailureInput = {
    status,
    apiCode,
    transportCode,
    responseBody: (apiError as { data?: unknown }).data,
  };

  // Axios reports CORS and some TLS failures as a generic network error with a
  // descriptive message and no response; keep those distinguishable.
  if (status === undefined) {
    const lower = message.toLowerCase();
    if (lower.includes('cors') || lower.includes('cross-origin')) {
      return { key: 'login.error_cors' };
    }
    if (lower.includes('certificate')) {
      return { key: 'login.error_ssl' };
    }
    if (lower.includes('timeout')) {
      return { key: 'login.error_timeout' };
    }
  }

  return resolveLoginPrompt(input);
};
