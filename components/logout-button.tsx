'use client';
export function LogoutButton() {
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    finally { location.href = '/login'; }
  }
  return <button className="text-button" onClick={logout}>로그아웃</button>;
}
