import { json, type ApiResponse, type Env, type FetchFn } from './types.js'

/**
 * Hastighetsbegränsning i två lager:
 * 1. I minnet per serverinstans: snabbt och alltid på, men nollställs när Vercel startar en ny
 *    instans, så det räcker inte ensamt.
 * 2. I Supabase per inloggad användare (supabase/rate_limits.sql): gäller över alla instanser.
 */
const hits = new Map<string, number[]>()

export function rateLimit(id: string, limit: number, now = Date.now(), windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const recent = (hits.get(id) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(id, recent)
    return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) }
  }
  recent.push(now)
  hits.set(id, recent)
  if (hits.size > 1000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
  return { ok: true, retryAfter: 0 }
}

export function resetRateLimit(): void {
  hits.clear()
}

export type Bucket = 'ai' | 'recipes' | 'models' | 'push'

/**
 * Gränser per användare. En veckomeny är 1–2 AI-anrop och upp till ett 40-tal receptsökningar
 * (frukost, lunch och middag i 7 dagar, ibland två sökningar per rätt), utspritt över ett par minuter.
 */
export const LIMITS: Record<Bucket, { perMinute: number; perDay: number }> = {
  ai: { perMinute: 10, perDay: 150 },
  recipes: { perMinute: 30, perDay: 400 },
  models: { perMinute: 10, perDay: 200 },
  push: { perMinute: 5, perDay: 50 },
}

export function waitText(seconds: number): string {
  if (seconds <= 90) return `${seconds} sekunder`
  if (seconds <= 90 * 60) return `${Math.ceil(seconds / 60)} minuter`
  return `${Math.ceil(seconds / 3600)} timmar`
}

export function tooMany(retryAfter: number): ApiResponse {
  return json(429, { error: { message: `För många anrop. Försök igen om ${waitText(retryAfter)}.` } }, { 'Retry-After': String(retryAfter) })
}

let warned = false

/**
 * Räknar anropet i Supabase för den inloggade användaren. Svarar 0 om det är tillåtet, annars
 * sekunder att vänta. null om räknaren inte går att nå (t.ex. om SQL-filen inte körts); då
 * gäller bara gränsen i minnet, och en varning skrivs i Vercels loggar.
 */
export async function sharedRateLimit(bucket: Bucket, token: string, env: Env, fetchFn: FetchFn): Promise<number | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  const { perMinute, perDay } = LIMITS[bucket]
  try {
    const res = await fetchFn(`${env.SUPABASE_URL}/rest/v1/rpc/hit_rate_limit`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_bucket: bucket, p_per_minute: perMinute, p_per_day: perDay }),
    })
    const wait = res.ok ? ((await res.json()) as unknown) : null
    if (typeof wait === 'number' && Number.isFinite(wait)) return Math.max(0, Math.round(wait))
    if (!warned) console.warn(`Hastighetsbegränsningen i Supabase svarade ${res.status}. Har supabase/rate_limits.sql körts?`)
  } catch {
    if (!warned) console.warn('Hastighetsbegränsningen i Supabase gick inte att nå.')
  }
  warned = true
  return null
}
