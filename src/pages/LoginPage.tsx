import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import type { ApiError } from '@/types';
import { promptForLoginError } from './loginErrorPrompt';
import styles from './LoginPage.module.scss';

/**
 * 将 API 错误转换为本地化的用户友好消息
 */
type RedirectState = { from?: { pathname?: string } };

function getLocalizedErrorMessage(error: unknown, t: TFunction): string {
  // The prompt is chosen by a tested decision table; the raw backend text is
  // never rendered, so provider names, HTML and proxy detail cannot leak here.
  const prompt = promptForLoginError(error);

  const apiError = error as Partial<ApiError>;
  const status = typeof apiError.status === 'number' ? apiError.status : undefined;

  const withHttpStatus = (summary: string) => {
    if (!status) {
      return summary;
    }
    return `HTTP ${status}: ${summary}`;
  };

  if (prompt.key === 'login.error_rate_limited' && prompt.retryAfter) {
    return `${withHttpStatus(t(prompt.key))}（${t('login.error_retry_after', {
      seconds: prompt.retryAfter,
    })}）`;
  }

  // 网络类错误没有 HTTP 状态码，直接返回友好提示
  if (
    prompt.key === 'login.error_network' ||
    prompt.key === 'login.error_timeout' ||
    prompt.key === 'login.error_ssl' ||
    prompt.key === 'login.error_cors'
  ) {
    return t(prompt.key);
  }

  return withHttpStatus(t(prompt.key));
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoLoginSuccess, setAutoLoginSuccess] = useState(false);
  const [error, setError] = useState('');

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const languageOptions = useMemo(
    () =>
      LANGUAGE_ORDER.map((lang) => ({
        value: lang,
        label: t(LANGUAGE_LABEL_KEYS[lang]),
      })),
    [t]
  );
  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      if (!isSupportedLanguage(selectedLanguage)) {
        return;
      }
      setLanguage(selectedLanguage);
    },
    [setLanguage]
  );

  useEffect(() => {
    const init = async () => {
      try {
        const autoLoggedIn = await restoreSession();
        if (autoLoggedIn) {
          setAutoLoginSuccess(true);
          // 延迟跳转，让用户看到成功动画
          setTimeout(() => {
            const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
            navigate(redirect, { replace: true });
          }, 1500);
        } else {
          setApiBase(storedBase || detectedBase);
          setManagementKey(storedKey || '');
          setRememberPassword(storedRememberPassword || Boolean(storedKey));
        }
      } finally {
        // 自动登录成功时 showSplash 仍由 autoLoginSuccess 维持，可无条件结束 loading
        setAutoLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }

    const baseToUse = apiBase ? normalizeApiBase(apiBase) : detectedBase;
    setLoading(true);
    setError('');
    try {
      await login({
        apiBase: baseToUse,
        managementKey: managementKey.trim(),
        rememberPassword,
      });
      showNotification(t('common.connected_status'), 'success');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const message = getLocalizedErrorMessage(err, t);
      setError(message);
      showNotification(`${t('notification.login_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [
    apiBase,
    detectedBase,
    login,
    managementKey,
    navigate,
    rememberPassword,
    showNotification,
    t,
  ]);

  const handleSubmitKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !loading) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [loading, handleSubmit]
  );

  if (isAuthenticated && !autoLoading && !autoLoginSuccess) {
    const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  // 显示启动动画（自动登录中或自动登录成功）
  const showSplash = autoLoading || autoLoginSuccess;

  return (
    <div className={styles.container}>
      {/* 左侧品牌展示区 */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <span className={styles.brandWord}>CLI</span>
          <span className={styles.brandWord}>PROXY</span>
          <span className={styles.brandWord}>API</span>
        </div>
      </div>

      {/* 右侧功能交互区 */}
      <div className={styles.formPanel}>
        {showSplash ? (
          /* 启动动画 */
          <div className={styles.splashContent}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.splashLogo} />
            <h1 className={styles.splashTitle}>{t('splash.title')}</h1>
            <p className={styles.splashSubtitle}>{t('splash.subtitle')}</p>
            <div className={styles.splashLoader}>
              <div className={styles.splashLoaderBar} />
            </div>
          </div>
        ) : (
          /* 登录表单 */
          <div className={styles.formContent}>
            {/* Logo */}
            <img src={INLINE_LOGO_JPEG} alt="Logo" className={styles.logo} />

            {/* 登录表单卡片 */}
            <div className={styles.loginCard}>
              <div className={styles.loginHeader}>
                <div className={styles.titleRow}>
                  <div className={styles.title}>{t('title.login')}</div>
                  <Select
                    className={styles.languageSelect}
                    value={language}
                    options={languageOptions}
                    onChange={handleLanguageChange}
                    fullWidth={false}
                    ariaLabel={t('language.switch')}
                  />
                </div>
                <div className={styles.subtitle}>{t('login.subtitle')}</div>
              </div>

              <div className={styles.connectionBox}>
                <div className={styles.label}>{t('login.connection_current')}</div>
                <div className={styles.value}>{apiBase || detectedBase}</div>
                <div className={styles.hint}>{t('login.connection_auto_hint')}</div>
              </div>

              <div className={styles.toggleAdvanced}>
                <SelectionCheckbox
                  checked={showCustomBase}
                  onChange={setShowCustomBase}
                  ariaLabel={t('login.custom_connection_label')}
                  label={t('login.custom_connection_label')}
                  labelClassName={styles.toggleLabel}
                />
              </div>

              {showCustomBase && (
                <Input
                  label={t('login.custom_connection_label')}
                  placeholder={t('login.custom_connection_placeholder')}
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  hint={t('login.custom_connection_hint')}
                />
              )}

              <Input
                autoFocus
                label={t('login.management_key_label')}
                placeholder={t('login.management_key_placeholder')}
                type={showKey ? 'text' : 'password'}
                name="cpa-management-key"
                autoComplete="current-password"
                value={managementKey}
                onChange={(e) => setManagementKey(e.target.value)}
                onKeyDown={handleSubmitKeyDown}
                rightElement={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={
                      showKey
                        ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                        : t('login.show_key', { defaultValue: '显示密钥' })
                    }
                    title={
                      showKey
                        ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                        : t('login.show_key', { defaultValue: '显示密钥' })
                    }
                  >
                    {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                }
              />

              <div className={styles.toggleAdvanced}>
                <SelectionCheckbox
                  checked={rememberPassword}
                  onChange={setRememberPassword}
                  ariaLabel={t('login.remember_password_label')}
                  label={t('login.remember_password_label')}
                  labelClassName={styles.toggleLabel}
                />
              </div>

              <Button fullWidth onClick={handleSubmit} loading={loading}>
                {loading ? t('login.submitting') : t('login.submit_button')}
              </Button>

              {error && <div className={styles.errorBox}>{error}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
