import { timingSafeEqual } from 'node:crypto'
import { header, type ApiRequest, type Env, type FetchFn } from './types.js'

/** token = användarens Supabase-token, för hastighetsbegränsningen i databasen. */
export type AuthResult = { ok: true; id: string; email?: string; open?: boolean; token?: string } | { ok: false; status: number; message: string }

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Verifierar en Supabase-session och att e-postadressen står på listan över tillåtna. */
export async function verifySupabaseUser(
  token: string,
  env: Env,
  fetchFn: FetchFn,
): Promise<{ ok: true; id: string; email: string } | { ok: false; status: number; message: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { ok: false, status: 401, message: 'Inloggning är inte konfigurerad på servern.' }
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (allowed.length === 0) return { ok: false, status: 403, message: 'Servern saknar ALLOWED_EMAILS.' }
  let res: Response
  try {
    res = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })
  } catch {
    return { ok: false, status: 502, message: 'Kunde inte verifiera inloggningen.' }
  }
  if (!res.ok) return { ok: false, status: 401, message: 'Ogiltig eller utgången inloggning.' }
  const user = (await res.json()) as { id?: string; email?: string }
  const email = (user.email ?? '').toLowerCase()
  if (!user.id || !allowed.includes(email)) return { ok: false, status: 403, message: 'Den här e-postadressen har inte åtkomst.' }
  return { ok: true, id: `user:${user.id}`, email }
}

export async function authorize(req: ApiRequest, env: Env, fetchFn: FetchFn): Promise<AuthResult> {
  const bearer = /^Bearer\s+(.+)$/i.exec(header(req, 'authorization'))?.[1]
  if (bearer) {
    const user = await verifySupabaseUser(bearer, env, fetchFn)
    return user.ok ? { ...user, token: bearer } : user
  }

  // Varken lösenord eller inloggning konfigurerat: öppen åtkomst, begränsad per besökare i openai.ts.
  if (!env.APP_PASSWORD && !env.SUPABASE_URL) {
    const forwarded = header(req, 'x-forwarded-for').split(',')[0].trim()
    return { ok: true, id: `open:${forwarded || req.ip || 'okänd'}`, open: true }
  }
  const pw = header(req, 'x-app-password')
  if (env.APP_PASSWORD && pw && safeEqual(pw, env.APP_PASSWORD)) return { ok: true, id: 'password' }
  return { ok: false, status: 401, message: 'Fel eller saknat lösenord.' }
}
