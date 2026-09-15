import { json } from '../_lib.js';
import { readSession } from '../_auth.js';

// 접속자 신원: 이름+입장코드 세션 (없으면 null)
export async function identity(request, env) {
  const s = await readSession(request, env);
  return s ? { name: s.name, role: s.role } : { name: null, role: null };
}
export async function onRequestGet({ request, env }) {
  const id = await identity(request, env);
  return json({ ...id, gate: env.GATE_MODE || 'all' });
}
