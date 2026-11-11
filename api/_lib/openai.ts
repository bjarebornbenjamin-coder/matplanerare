import { authorize } from './auth.js'
import { LIMITS, rateLimit, sharedRateLimit, tooMany, type Bucket } from './rateLimit.js'
import { errorBody, json, type ApiRequest, type ApiResponse, type Env, type FetchFn } from './types.js'

export const OPENAI = 'https://api.openai.com/v1'
const MAX_BODY_BYTES = 4_000_000 // Vercel tillåter 4,5 MB
const MAX_MESSAGES = 20
const MAX_TEXT = 200_000
/** Fast tak för svarets längd. Veckomenyn och bildläsningen behöver långt mindre. */
export const MAX_COMPLETION_TOKENS = 6000

/** Modeller som servern skickar vidare till. Kan ersättas med ALLOWED_MODELS i Vercel. */
export const DEFAULT_ALLOWED_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-nano', 'gpt-5-mini', 'gpt-5']

export function allowedModels(env: Env): string[] {
  const own = (env.ALLOWED_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean)
  return own.length ? own : DEFAULT_ALLOWED_MODELS
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

/** En meddelandedel: text, eller en bild som data-URL eller https-adress. Allt annat avvisas. */
function cleanPart(p: unknown): Part | null {
  const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
  if (o.type === 'text' && typeof o.text === 'string' && o.text.length <= MAX_TEXT) return { type: 'text', text: o.text }
  const img = (typeof o.image_url === 'object' && o.image_url !== null ? o.image_url : {}) as Record<string, unknown>
  if (o.type === 'image_url' && typeof img.url === 'string' && (img.url.startsWith('data:image/') || img.url.startsWith('https://'))) {
    const detail = img.detail === 'low' || img.detail === 'high' || img.detail === 'auto' ? img.detail : undefined
    return { type: 'image_url', image_url: { url: img.url, ...(detail ? { detail } : {}) } }
  }
  return null
}

/** Bygger om meddelandet med bara roll och innehåll (inga verktygsanrop, namn eller annat). */
function cleanMessage(m: unknown): { role: string; content: string | Part[] } | null {
  const o = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
  if (o.role !== 'system' && o.role !== 'user' && o.role !== 'assistant') return null
  if (typeof o.content === 'string') return o.content.length <= MAX_TEXT ? { role: o.role, content: o.content } : null
  if (!Array.isArray(o.content) || o.content.length === 0 || o.content.length > 10) return null
  const parts = o.content.map(cleanPart)
  return parts.every((p): p is Part => p !== null) ? { role: o.role, content: parts } : null
}

/**
 * Skickar bara vidare model, messages och response_format, så att servern inte kan missbrukas till
 * annat. Modellen måste stå på listan över tillåtna, och servern sätter själv taket för svarets längd.
 */
export function sanitizeAiBody(body: unknown, env: Env = {}): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'Ogiltig förfrågan.' }
  const b = body as Record<string, unknown>
  if (JSON.stringify(b).length > MAX_BODY_BYTES) return { ok: false, message: 'Förfrågan är för stor.' }
  if (typeof b.model !== 'string' || !allowedModels(env).includes(b.model)) return { ok: false, message: `Modellen är inte tillåten på servern. Välj en av: ${allowedModels(env).join(', ')}.` }
  if (!Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > MAX_MESSAGES) return { ok: false, message: 'Ogiltiga meddelanden.' }
  const messages = b.messages.map(cleanMessage)
  if (messages.some((m) => m === null)) return { ok: false, message: 'Ogiltiga meddelanden.' }
  const value: Record<string, unknown> = { model: b.model, messages, max_completion_tokens: MAX_COMPLETION_TOKENS }
  const rf = (typeof b.response_format === 'object' && b.response_format !== null ? b.response_format : {}) as Record<string, unknown>
  if (rf.type === 'json_object' || rf.type === 'text') value.response_format = { type: rf.type }
  return { ok: true, value }
}

/**
 * Gemensam kontroll för de skyddade adresserna: metod, nyckel, inloggning och hastighetsbegränsning.
 * Den som går över gränsen får 429 och Retry-After.
 */
export async function guard(req: ApiRequest, env: Env, fetchFn: FetchFn, method: string, bucket: Bucket): Promise<ApiResponse | { id: string }> {
  if (req.method !== method) return errorBody(405, 'Metoden stöds inte.')
  if (!env.OPENAI_API_KEY) return errorBody(500, 'Servern saknar OPENAI_API_KEY.')
  const auth = await authorize(req, env, fetchFn)
  if (!auth.ok) return errorBody(auth.status, auth.message)
  const { perMinute } = LIMITS[bucket]
  if (auth.open) {
    // Öppen åtkomst: strängare gräns per besökare, och ett dagstak per serverinstans.
    const day = rateLimit(`open-day:${auth.id}`, Number(env.OPEN_DAILY_LIMIT) || 100, Date.now(), 86_400_000)
    if (!day.ok) return errorBody(429, 'Dagens gräns för öppen åtkomst är nådd. Sätt APP_PASSWORD eller försök i morgon.')
  }
  const local = rateLimit(`${bucket}:${auth.id}`, auth.open ? Math.min(perMinute, 10) : perMinute)
  if (!local.ok) return tooMany(local.retryAfter)
  if (auth.token) {
    const wait = await sharedRateLimit(bucket, auth.token, env, fetchFn)
    if (wait) return tooMany(wait)
  }
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
  const g = await guard(req, env, fetchFn, 'POST', 'ai')
  if ('status' in g) return g
  const clean = sanitizeAiBody(req.body, env)
  if (!clean.ok) return errorBody(400, clean.message)
  return forward(
    `${OPENAI}/chat/completions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify(clean.value) },
    fetchFn,
  )
}

/** Modellistan från OpenAI, begränsad till de modeller servern tillåter. */
export async function handleModels(req: ApiRequest, env: Env, fetchFn: FetchFn = fetch): Promise<ApiResponse> {
  const g = await guard(req, env, fetchFn, 'GET', 'models')
  if ('status' in g) return g
  const res = await forward(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }, fetchFn)
  const data = (res.body as { data?: { id?: unknown }[] } | null)?.data
  if (res.status !== 200 || !Array.isArray(data)) return res
  const allowed = allowedModels(env)
  return json(200, { ...(res.body as object), data: data.filter((m) => typeof m.id === 'string' && allowed.includes(m.id)) })
}
