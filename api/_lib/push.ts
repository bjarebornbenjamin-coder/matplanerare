import { timingSafeEqual } from 'node:crypto'
import * as webpush from 'web-push'
import { verifySupabaseUser } from './auth.js'
import { LIMITS, rateLimit, sharedRateLimit, tooMany } from './rateLimit.js'
import { errorBody, header, json, type ApiRequest, type ApiResponse, type Env, type FetchFn } from './types.js'

export interface Sub {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}
export interface DueNotification {
  user_id: string
  id: string
  title: string
  body: string
  fire_at: string
}
export interface PushStore {
  due(nowIso: string, limit: number): Promise<DueNotification[]>
  subscriptions(userId: string): Promise<Sub[]>
  markSent(rows: { user_id: string; id: string }[]): Promise<void>
  deleteSubscription(userId: string, endpoint: string): Promise<void>
}
/** Kastar ett fel med statusCode vid misslyckande (404/410 = prenumerationen finns inte längre). */
export type Sender = (sub: Sub, payload: string) => Promise<void>

const STALE_MS = 30 * 60_000

export interface DispatchResult {
  sent: number
  skipped: number
  retry: number
  removedSubscriptions: number
}

export async function dispatchDue(store: PushStore, send: Sender, now = new Date()): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, skipped: 0, retry: 0, removedSubscriptions: 0 }
  const done: { user_id: string; id: string }[] = []
  for (const n of await store.due(now.toISOString(), 200)) {
    if (now.getTime() - new Date(n.fire_at).getTime() > STALE_MS) {
      result.skipped++ // för gammal för att vara till nytta
      done.push(n)
      continue
    }
    const subs = await store.subscriptions(n.user_id)
    if (subs.length === 0) {
      result.skipped++
      done.push(n)
      continue
    }
    const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.id, url: '/' })
    let delivered = 0
    let temporaryFailure = false
    for (const sub of subs) {
      try {
        await send(sub, payload)
        delivered++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          await store.deleteSubscription(sub.user_id, sub.endpoint)
          result.removedSubscriptions++
        } else temporaryFailure = true
      }
    }
    if (delivered === 0 && temporaryFailure) result.retry++ // lämnas osänd, försöks igen nästa minut
    else {
      if (delivered > 0) result.sent++
      else result.skipped++
      done.push(n)
    }
  }
  if (done.length > 0) await store.markSent(done)
  return result
}

/** PostgREST med service role. Kringgår Row Level Security, används bara på servern. */
export function supabaseStore(env: Env, fetchFn: FetchFn = fetch): PushStore {
  const base = `${env.SUPABASE_URL}/rest/v1`
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
  const q = encodeURIComponent
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } })
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return res.status === 204 ? null : res.json()
  }
  return {
    async due(nowIso, limit) {
      return (await call(`/notifications?select=user_id,id,title,body,fire_at&sent=eq.false&fire_at=lte.${q(nowIso)}&order=fire_at.asc&limit=${limit}`)) as DueNotification[]
    },
    async subscriptions(userId) {
      return (await call(`/push_subscriptions?select=user_id,endpoint,p256dh,auth&user_id=eq.${q(userId)}`)) as Sub[]
    },
    async markSent(rows) {
      const byUser = new Map<string, string[]>()
      for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.id])
      for (const [user, ids] of byUser) {
        await call(`/notifications?user_id=eq.${q(user)}&id=in.(${ids.map((i) => `"${i.replace(/"/g, '')}"`).map(q).join(',')})`, {
          method: 'PATCH',
          body: JSON.stringify({ sent: true }),
        })
      }
    },
    async deleteSubscription(userId, endpoint) {
      await call(`/push_subscriptions?user_id=eq.${q(userId)}&endpoint=eq.${q(endpoint)}`, { method: 'DELETE' })
    },
  }
}

export function webPushSender(env: Env): Sender {
  webpush.setVapidDetails(env.VAPID_SUBJECT ?? 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  return async (sub, payload) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: 'high' })
  }
}

export interface PushDeps {
  store?: PushStore
  send?: Sender
  fetchFn?: FetchFn
  now?: Date
}

function configured(env: Env): string | null {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const) {
    if (!env[k]) return `Servern saknar ${k}.`
  }
  return null
}

function secretOk(req: ApiRequest, env: Env): boolean {
  if (!env.CRON_SECRET) return false
  const given = /^Bearer\s+(.+)$/i.exec(header(req, 'authorization'))?.[1] ?? header(req, 'x-cron-secret')
  const a = Buffer.from(given)
  const b = Buffer.from(env.CRON_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Anropas varje minut av en schemaläggare (Supabase pg_cron eller liknande). */
export async function handleDispatch(req: ApiRequest, env: Env, deps: PushDeps = {}): Promise<ApiResponse> {
  if (req.method !== 'POST' && req.method !== 'GET') return errorBody(405, 'Metoden stöds inte.')
  if (!secretOk(req, env)) return errorBody(401, 'Ogiltig hemlighet.')
  const missing = configured(env)
  if (missing) return errorBody(500, missing)
  const result = await dispatchDue(deps.store ?? supabaseStore(env, deps.fetchFn), deps.send ?? webPushSender(env), deps.now)
  return json(200, result)
}

/** Skickar en testnotis till den inloggade användarens enheter. */
export async function handleTest(req: ApiRequest, env: Env, deps: PushDeps = {}): Promise<ApiResponse> {
  if (req.method !== 'POST') return errorBody(405, 'Metoden stöds inte.')
  const bearer = /^Bearer\s+(.+)$/i.exec(header(req, 'authorization'))?.[1]
  if (!bearer) return errorBody(401, 'Logga in först.')
  const user = await verifySupabaseUser(bearer, env, deps.fetchFn ?? fetch)
  if (!user.ok) return errorBody(user.status, user.message)
  const missing = configured(env)
  if (missing) return errorBody(500, missing)
  const rl = rateLimit(`push:${user.id}`, LIMITS.push.perMinute)
  if (!rl.ok) return tooMany(rl.retryAfter)
  const wait = await sharedRateLimit('push', bearer, env, deps.fetchFn ?? fetch)
  if (wait) return tooMany(wait)
  const store = deps.store ?? supabaseStore(env, deps.fetchFn)
  const send = deps.send ?? webPushSender(env)
  const subs = await store.subscriptions(user.id.replace(/^user:/, ''))
  if (subs.length === 0) return errorBody(404, 'Ingen enhet är registrerad för notiser.')
  const payload = JSON.stringify({ title: 'Testnotis', body: 'Notiser fungerar på den här enheten.', tag: 'test', url: '/' })
  let delivered = 0
  for (const sub of subs) {
    try {
      await send(sub, payload)
      delivered++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await store.deleteSubscription(sub.user_id, sub.endpoint)
    }
  }
  return delivered > 0 ? json(200, { delivered }) : errorBody(502, 'Kunde inte skicka till någon enhet. Slå på notiser igen på enheten.')
}
