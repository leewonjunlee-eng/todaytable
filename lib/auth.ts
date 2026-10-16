import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';
import { tokenHash } from './security';

export type AuthUser = { id: string; email: string; role: 'PARTICIPANT' | 'ADMIN' };

async function findUser(token: string): Promise<AuthUser | null> {
  try {
    const { rows } = await db.query<AuthUser>(
      `SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [tokenHash(decodeURIComponent(token))],
      `SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get('todaytable_session')?.value;
  return token ? findUser(token) : null;
}

export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/');
  return user;
}

export async function apiUser(request: Request, admin = false): Promise<AuthUser | null> {
  const cookie = request.headers.get('cookie')?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('todaytable_session='));
  const token = cookie?.slice('todaytable_session='.length);
  if (!token) return null;
  const user = await findUser(token);
  return user && (!admin || user.role === 'ADMIN') ? user : null;
}
