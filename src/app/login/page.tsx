'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLang } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/');
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setErr(body.error || t('登录失败', 'Sign-in failed'));
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="logo-mark"><span /></div>
          <div style={{ flex: 1 }}>
            <div className="logo-word">AUDAX</div>
            <div className="logo-sub">PROJECT PLATFORM</div>
          </div>
          <button
            type="button"
            className="btn-line sm"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            style={{ fontWeight: 700, color: 'var(--navy700)' }}
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>
        {err && <div className="login-err">{err}</div>}
        <div className="field">
          <label>{t('账号', 'Username')}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div className="field">
          <label>{t('密码', 'Password')}</label>
          {/* REQ-009: 眼睛切换明文/掩码,方便核对输入 */}
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ width: '100%', paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? t('隐藏密码', 'Hide password') : t('显示密码', 'Show password')}
              title={showPw ? t('隐藏密码', 'Hide password') : t('显示密码', 'Show password')}
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 6,
                color: 'var(--text2)', display: 'flex', alignItems: 'center',
              }}
            >
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>
        <button className="btn-navy" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={busy}>
          {busy ? t('登录中…', 'Signing in…') : t('登录', 'Sign in')}
        </button>
        <div className="login-hint">
          {t('初始账号:pd / bd / sales(密码 audax123)。登录 PD 后在「用户管理」为团队创建账号。',
            'Default accounts: pd / bd / sales (password audax123). Sign in as pd to create team accounts under Users.')}
        </div>
      </form>
    </div>
  );
}
