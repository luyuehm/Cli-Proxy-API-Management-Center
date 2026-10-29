import { describe, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import type { LoginPromptKey } from '../src/pages/loginErrorPrompt';

const LOCALES = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru } as const;

/** Every login prompt the page can render, including the retry-window suffix. */
const PROMPT_KEYS: LoginPromptKey[] = [
  'login.error_remote_disabled',
  'login.error_ip_not_allowed',
  'login.error_key_unusable',
  'login.error_rate_limited',
  'login.error_unauthorized',
  'login.error_forbidden',
  'login.error_not_found',
  'login.error_server',
  'login.error_network',
  'login.error_timeout',
  'login.error_ssl',
  'login.error_cors',
  'login.error_invalid',
];

const initI18n = async (lng: keyof typeof LOCALES) => {
  const i18n = createInstance();
  await i18n.init({
    lng,
    fallbackLng: false,
    resources: Object.fromEntries(
      Object.entries(LOCALES).map(([code, translation]) => [code, { translation }])
    ),
    interpolation: { escapeValue: false },
  });
  return i18n;
};

describe('login prompt translations', () => {
  for (const locale of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
    test(`${locale} resolves every login prompt without falling back to a raw key`, async () => {
      const i18n = await initI18n(locale);

      for (const key of PROMPT_KEYS) {
        const value = i18n.t(key);
        expect(value).not.toBe(key);
        expect(value.trim()).not.toBe('');
      }

      expect(i18n.t('login.error_retry_after', { seconds: 120 })).toContain('120');
    });

    test(`${locale} login prompts stay free of technical detail`, async () => {
      const i18n = await initI18n(locale);

      // Prompts must not name the stack, the proxy config or raw HTTP text.
      const forbidden = ['nginx', '<html', 'bcrypt', 'provider'];
      for (const key of PROMPT_KEYS) {
        const value = i18n.t(key).toLowerCase();
        for (const term of forbidden) {
          expect(value).not.toContain(term);
        }
      }
    });
  }

  test('the four 403 subtypes read differently in every locale', async () => {
    const four: LoginPromptKey[] = [
      'login.error_remote_disabled',
      'login.error_ip_not_allowed',
      'login.error_key_unusable',
      'login.error_rate_limited',
    ];

    for (const locale of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
      const i18n = await initI18n(locale);
      const rendered = four.map((key) => i18n.t(key));
      expect(new Set(rendered).size).toBe(four.length);
    }
  });
});
