import { json } from '../_lib.js';
import { clearCookie } from '../_auth.js';
export async function onRequestPost() { return json({ ok: true }, 200, { 'set-cookie': clearCookie() }); }
export async function onRequestGet({ request }) { return new Response(null, { status: 302, headers: { location: new URL(request.url).origin + '/enter/', 'set-cookie': clearCookie() } }); }
