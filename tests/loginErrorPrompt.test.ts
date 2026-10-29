import { describe, expect, test } from 'bun:test';
import {
  AUTH_ERROR_CODES,
  promptForLoginError,
  resolveLoginPrompt,
} from '../src/pages/loginErrorPrompt';

/**
 * One case per agreed user-facing scenario: the four distinguishable 403
 * subtypes, 401, 5xx, network failure and a normal-success regression guard.
 */
describe('login error prompt mapping', () => {
  test('403 remote management disabled maps to its own prompt', () => {
    expect(
      resolveLoginPrompt({
        status: 403,
        apiCode: AUTH_ERROR_CODES.remoteDisabled,
        responseBody: { error: AUTH_ERROR_CODES.remoteDisabled },
      })
    ).toEqual({ key: 'login.error_remote_disabled' });
  });

  test('403 from an allowlist or proxy (non-JSON body) maps to IP not allowed', () => {
    expect(
      resolveLoginPrompt({
        status: 403,
        responseBody: '<html><body>403 Forbidden</body></html>',
      })
    ).toEqual({ key: 'login.error_ip_not_allowed', blockedBeforeBackend: true });

    expect(
      resolveLoginPrompt({ status: 403, responseBody: 'Forbidden' })
    ).toEqual({ key: 'login.error_ip_not_allowed', blockedBeforeBackend: true });
  });

  test('403 management key not configured maps to key unusable', () => {
    expect(
      resolveLoginPrompt({
        status: 403,
        apiCode: AUTH_ERROR_CODES.keyNotConfigured,
        responseBody: { error: AUTH_ERROR_CODES.keyNotConfigured },
      })
    ).toEqual({ key: 'login.error_key_unusable' });
  });

  test('403 temporary ban carries the retry window', () => {
    expect(
      resolveLoginPrompt({
        status: 403,
        apiCode: AUTH_ERROR_CODES.rateLimited,
        responseBody: { error: AUTH_ERROR_CODES.rateLimited, retry_after: 1470 },
      })
    ).toEqual({ key: 'login.error_rate_limited', retryAfter: 1470 });
  });

  test('a temporary ban without a retry window still prompts for later retry', () => {
    expect(
      resolveLoginPrompt({ status: 403, apiCode: AUTH_ERROR_CODES.rateLimited })
    ).toEqual({ key: 'login.error_rate_limited', retryAfter: undefined });
  });

  test('each 403 subtype yields a distinct prompt key', () => {
    const keys = [
      resolveLoginPrompt({ status: 403, apiCode: AUTH_ERROR_CODES.remoteDisabled }).key,
      resolveLoginPrompt({ status: 403, responseBody: '<html>blocked</html>' }).key,
      resolveLoginPrompt({ status: 403, apiCode: AUTH_ERROR_CODES.keyNotConfigured }).key,
      resolveLoginPrompt({ status: 403, apiCode: AUTH_ERROR_CODES.rateLimited }).key,
    ];
    expect(new Set(keys).size).toBe(4);
  });

  test('401 missing and invalid keys map to key unusable', () => {
    for (const code of [AUTH_ERROR_CODES.missingKey, AUTH_ERROR_CODES.invalidKey]) {
      expect(resolveLoginPrompt({ status: 401, apiCode: code })).toEqual({
        key: 'login.error_key_unusable',
      });
    }
    expect(resolveLoginPrompt({ status: 401 })).toEqual({ key: 'login.error_unauthorized' });
  });

  test('5xx maps to the service-unavailable prompt', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(resolveLoginPrompt({ status })).toEqual({ key: 'login.error_server' });
    }
  });

  test('network failures without a status map to the network prompt', () => {
    expect(resolveLoginPrompt({})).toEqual({ key: 'login.error_network' });
    expect(resolveLoginPrompt({ transportCode: 'ERR_NETWORK' })).toEqual({
      key: 'login.error_network',
    });
  });

  test('timeout and TLS transport failures keep their own prompts', () => {
    expect(resolveLoginPrompt({ transportCode: 'ECONNABORTED' })).toEqual({
      key: 'login.error_timeout',
    });
    expect(resolveLoginPrompt({ transportCode: 'ERR_CERT_AUTHORITY_INVALID' })).toEqual({
      key: 'login.error_ssl',
    });
  });

  test('404 still reports a wrong server address', () => {
    expect(resolveLoginPrompt({ status: 404 })).toEqual({ key: 'login.error_not_found' });
  });
});

describe('promptForLoginError', () => {
  test('reads the machine code out of the enriched ApiError', () => {
    const error = Object.assign(new Error('management key rejected'), {
      name: 'ApiError',
      status: 401,
      apiCode: AUTH_ERROR_CODES.invalidKey,
    });

    expect(promptForLoginError(error)).toEqual({ key: 'login.error_key_unusable' });
  });

  test('never echoes the raw backend message into the prompt', () => {
    const error = Object.assign(
      new Error('IP banned due to too many failed attempts. Try again in 29m0s'),
      { name: 'ApiError', status: 403, apiCode: AUTH_ERROR_CODES.rateLimited }
    );

    const prompt = promptForLoginError(error);
    expect(prompt.key).toBe('login.error_rate_limited');
    expect(JSON.stringify(prompt)).not.toContain('IP banned');
  });

  test('classifies CORS and TLS failures that arrive without a response', () => {
    const cors = Object.assign(new Error('blocked by CORS policy'), { code: 'ERR_NETWORK' });
    expect(promptForLoginError(cors)).toEqual({ key: 'login.error_cors' });

    const tls = Object.assign(new Error('certificate has expired'), { code: 'ERR_NETWORK' });
    expect(promptForLoginError(tls)).toEqual({ key: 'login.error_ssl' });
  });

  test('a body-less 403 is treated as a proxy rejection', () => {
    // The API always sends
    // {"error":"<code>","message":"<text>"}; an empty body did not come from it.
    expect(resolveLoginPrompt({ status: 403 })).toEqual({
      key: 'login.error_ip_not_allowed',
      blockedBeforeBackend: true,
    });
  });

  test('a 403 with the API envelope but an unknown code stays generic', () => {
    expect(
      resolveLoginPrompt({ status: 403, responseBody: { error: 'something_new' } })
    ).toEqual({ key: 'login.error_forbidden' });
  });

  test('treats a body-less 403 as the generic forbidden prompt', () => {
    const error = Object.assign(new Error('Request failed with status code 403'), {
      status: 403,
    });
    // Nothing was readable from the response at all.
    expect(promptForLoginError(error)).toEqual({
      key: 'login.error_ip_not_allowed',
      blockedBeforeBackend: true,
    });
  });
});
