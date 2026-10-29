import { describe, expect, test } from 'bun:test';
import { parseApiErrorResponse } from '../src/services/api/apiError';
import { promptForLoginError } from '../src/pages/loginErrorPrompt';

/**
 * The Management API (CLIProxyAPI `internal/api/handlers/management/auth_errors.go`)
 * answers a rejected access check with this envelope:
 *
 *   {"error":"<stable code>","message":"<short generic text>","retry_after":<n>}
 *
 * These cases feed the real parsing + mapping pipeline with those bodies, so a
 * drift between backend and frontend surfaces here rather than in the browser.
 */
const buildApiError = (status: number, body: unknown) => {
  const parsed = parseApiErrorResponse(body, `Request failed with status code ${status}`);
  return Object.assign(new Error(parsed.message), {
    name: 'ApiError',
    status,
    apiCode: parsed.apiCode,
    data: body,
    details: body,
  });
};

describe('management auth envelope end to end', () => {
  test('403 remote management disabled', () => {
    const body = { error: 'remote_management_disabled', message: 'remote management is disabled' };
    expect(promptForLoginError(buildApiError(403, body))).toEqual({
      key: 'login.error_remote_disabled',
    });
  });

  test('403 management key not configured', () => {
    const body = {
      error: 'management_key_not_configured',
      message: 'management key is not configured on the server',
    };
    expect(promptForLoginError(buildApiError(403, body))).toEqual({
      key: 'login.error_key_unusable',
    });
  });

  test('403 temporary ban carries the retry window from the envelope', () => {
    const body = {
      error: 'too_many_failed_attempts',
      message: 'too many failed attempts, retry later',
      retry_after: 1470,
    };
    expect(promptForLoginError(buildApiError(403, body))).toEqual({
      key: 'login.error_rate_limited',
      retryAfter: 1470,
    });
  });

  test('401 missing and invalid keys', () => {
    for (const code of ['management_key_missing', 'management_key_invalid']) {
      expect(promptForLoginError(buildApiError(401, { error: code, message: 'rejected' }))).toEqual({
        key: 'login.error_key_unusable',
      });
    }
  });

  test('a proxy 403 that never reaches the API reads as not allowed', () => {
    // nginx `deny` / WAF answers with HTML, not the API envelope.
    const body = '<html><head><title>403 Forbidden</title></head></html>';
    expect(promptForLoginError(buildApiError(403, body))).toEqual({
      key: 'login.error_ip_not_allowed',
      blockedBeforeBackend: true,
    });
  });

  test('5xx from the API maps to service unavailable', () => {
    expect(promptForLoginError(buildApiError(502, { error: 'bad_gateway' }))).toEqual({
      key: 'login.error_server',
    });
  });
});
