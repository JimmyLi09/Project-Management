'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
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
      setErr(body.error || '登录失败');
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="logo-mark"><span /></div>
          <div>
            <div className="logo-word">AUDAX</div>
            <div className="logo-sub">PROJECT PLATFORM</div>
          </div>
        </div>
        {err && <div className="login-err">{err}</div>}
        <div className="field">
          <label>Username 账号</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div className="field">
          <label>Password 密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="btn-navy" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in 登录'}
        </button>
        <div className="login-hint">
          初始账号:pd / bd / sales(密码 audax123)。登录 PD 后在「Users」页为团队创建账号。
        </div>
      </form>
    </div>
  );
}
