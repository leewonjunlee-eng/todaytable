'use client';
export function LogoutButton({operator=false}:{operator?:boolean}) {
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); }
    finally { location.href = operator?'/admin/login':'/login'; }
  }
  return <button className="text-button" onClick={logout}>로그아웃</button>;
}
