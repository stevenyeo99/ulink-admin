import { request } from './client';
import type { SessionUser } from '../lib/session';

export function login(username: string, password: string): Promise<{ token: string; user: SessionUser }> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}
