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
          <span className="dot">A</span>
          <div>
            <b>Audax · 项目协作台</b>
            <small>Project Collaboration Platform</small>
          </div>
        </div>
        {err && <div className="login-err">{err}</div>}
        <div className="field">
          <label>账号 Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="field">
          <label>密码 Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? '登录中…' : '登录 Sign in'}
        </button>
        <div className="login-hint">
          初始账号:pd / bd / sales(密码 audax123,首次使用后请让 PD 在「用户」中创建团队账号并修改密码策略)。
        </div>
      </form>
    </div>
  );
}
