import { json } from '../_lib.js';
import { liveSession } from '../_auth.js';

// 접속자 신원 (세션 쿠키 → 계정)
export async function identity(request, env) {
  const s = await liveSession(request, env, env.DB);
  return s ? { name: s.name, email: s.email, role: s.role } : { name: null, email: null, role: null };
}
export async function onRequestGet({ request, env }) {
  const id = await identity(request, env);
  return json({ ...id, gate: env.GATE_MODE || 'all' });
}
