import { authorize } from './auth.js'
import { rateLimit } from './rateLimit.js'
import { errorBody, json, type ApiRequest, type ApiResponse, type Env, type FetchFn } from './types.js'

export const OPENAI = 'https://api.openai.com/v1'
const MAX_BODY_BYTES = 4_000_000 // Vercel tillåter 4,5 MB
const MAX_MESSAGES = 80
const MODEL = /^[\w.:-]{1,64}$/

/** Skickar bara vidare de fält appen behöver, så att servern inte kan missbrukas till annat. */
export function sanitizeAiBody(body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'Ogiltig förfrågan.' }
  const b = body as Record<string, unknown>
  if (typeof b.model !== 'string' || !MODEL.test(b.model)) return { ok: false, message: 'Ogiltigt modellnamn.' }
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > MAX_MESSAGES) return { ok: false, message: 'Ogiltiga meddelanden.' }
  if (JSON.stringify(b).length > MAX_BODY_BYTES) return { ok: false, message: 'Förfrågan är för stor.' }
  const value: Record<string, unknown> = { model: b.model, messages: b.messages }
  if (b.response_format !== undefined) value.response_format = b.response_format
  return { ok: true, value }
}

export async function guard(req: ApiRequest, env: Env, fetchFn: FetchFn, method: string): Promise<ApiResponse | { id: string }> {
  if (req.method !== method) return errorBody(405, 'Metoden stöds inte.')
  if (!env.OPENAI_API_KEY) return errorBody(500, 'Servern saknar OPENAI_API_KEY.')
  const auth = await authorize(req, env, fetchFn)
  if (!auth.ok) return errorBody(auth.status, auth.message)
  const limit = Number(env.RATE_LIMIT_PER_MIN) || 60
  if (auth.open) {
    // Öppen åtkomst: strängare gräns per besökare, och ett dagstak per serverinstans.
    const day = rateLimit(`open-day:${auth.id}`, Number(env.OPEN_DAILY_LIMIT) || 100, Date.now(), 86_400_000)
    if (!day.ok) return errorBody(429, 'Dagens gräns för öppen åtkomst är nådd. Sätt APP_PASSWORD eller försök i morgon.')
  }
  const rl = rateLimit(auth.id, auth.open ? Math.min(limit, 10) : limit)
  if (!rl.ok) return json(429, { error: { message: `För många anrop. Vänta ${rl.retryAfter} sekunder.` } }, { 'Retry-After': String(rl.retryAfter) })
  return { id: auth.id }
}

async function forward(url: string, init: RequestInit, fetchFn: FetchFn): Promise<ApiResponse> {
  let res: Response
  try {
    res = await fetchFn(url, init)
  } catch {
    return errorBody(502, 'Servern kunde inte nå OpenAI.')
  }
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: { message: `Oväntat svar från OpenAI (${res.status}).` } }
  }
  return json(res.status, body)
}

export async function handleAi(req: ApiRequest, env: Env, fetchFn: FetchFn = fetch): Promise<ApiResponse> {
  const g = await guard(req, env, fetchFn, 'POST')
  if ('status' in g) return g
  const clean = sanitizeAiBody(req.body)
  if (!clean.ok) return errorBody(400, clean.message)
  return forward(
    `${OPENAI}/chat/completions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(clean.value) },
    fetchFn,
  )
}

export async function handleModels(req: ApiRequest, env: Env, fetchFn: FetchFn = fetch): Promise<ApiResponse> {
  const g = await guard(req, env, fetchFn, 'GET')
  if ('status' in g) return g
  return forward(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }, fetchFn)
}
