import { authorize } from './auth.js'
import { rateLimit, tooMany } from './rateLimit.js'
import { errorBody, json, type ApiRequest, type ApiResponse, type Env, type FetchFn } from './types.js'

/** Det som "Testa anslutningen" får veta. Bara för den som redan har åtkomst. */
export interface HealthDetails {
  openaiKeyConfigured: boolean
  /** Inget lösenord eller inloggning krävs: alla med adressen kan använda nyckeln. */
  openAccess: boolean
  /** Resultat av ett anrop till OpenAI med serverns nyckel (null om nyckel saknas). Sparas en stund. */
  openai: { ok: boolean; status: number; code?: string } | null
}

const CACHE_MS = 5 * 60_000
let cached: { at: number; result: HealthDetails['openai'] } | null = null

export function resetHealthCache(): void {
  cached = null
}

async function checkOpenAi(env: Env, fetchFn: FetchFn, now: number): Promise<HealthDetails['openai']> {
  if (!env.OPENAI_API_KEY) return null
  if (cached && now - cached.at < CACHE_MS) return cached.result
  let result: HealthDetails['openai']
  try {
    const res = await fetchFn('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } })
    let code: string | undefined
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; type?: string } }
      code = body.error?.code ?? body.error?.type ?? undefined
    }
    result = { ok: res.ok, status: res.status, code }
  } catch {
    result = { ok: false, status: 0, code: 'unreachable' }
  }
  cached = { at: now, result }
  return result
}

/**
 * GET: svarar bara att servern är uppe. Inget om konfigurationen och inget anrop till OpenAI.
 * POST (kräver lösenord eller inloggning): detaljer för "Testa anslutningen", med OpenAI-kontrollen
 * sparad i 5 minuter.
 */
export async function handleHealth(req: ApiRequest, env: Env, fetchFn: FetchFn = fetch, now = Date.now()): Promise<ApiResponse> {
  if (req.method === 'GET') return json(200, { ok: true }, { 'Cache-Control': 'no-store' })
  if (req.method !== 'POST') return errorBody(405, 'Metoden stöds inte.')
  const auth = await authorize(req, env, fetchFn)
  if (!auth.ok) return errorBody(auth.status, auth.message)
  const rl = rateLimit(`health:${auth.id}`, 10, now)
  if (!rl.ok) return tooMany(rl.retryAfter)
  const details: HealthDetails = {
    openaiKeyConfigured: Boolean(env.OPENAI_API_KEY),
    openAccess: Boolean(auth.open),
    openai: await checkOpenAi(env, fetchFn, now),
  }
  return json(200, details, { 'Cache-Control': 'no-store' })
}
