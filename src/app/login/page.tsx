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
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
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
