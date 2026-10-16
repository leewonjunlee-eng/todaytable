'use client';
import { useState } from 'react';

export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? '로그인할 수 없습니다.');
        return;
      }
      location.href = '/';
    } catch {
      setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-stack">
      <label>이메일<input name="email" type="email" autoComplete="username" required placeholder="you@example.com" /></label>
      <label>비밀번호<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? '확인 중…' : '로그인'} <span>→</span></button>
    </form>
  );
}
