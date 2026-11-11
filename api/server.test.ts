import { beforeEach, describe, expect, it } from 'vitest'
import { handleAi, handleModels, sanitizeAiBody } from './_lib/openai.js'
import { resetRateLimit } from './_lib/rateLimit.js'
import type { ApiRequest, Env } from './_lib/types.js'

const env: Env = { OPENAI_API_KEY: 'sk-server', APP_PASSWORD: 'hemligt', ALLOWED_EMAILS: 'Me@Example.com', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }
const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({
  method: 'POST',
  headers: { 'x-app-password': 'hemligt' },
  body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hej' }], secret: 'ska inte skickas vidare', stream: true },
  ip: '1.2.3.4',
  ...over,
})
const upstream = (calls: { url: string; init: RequestInit }[], status = 200, body: unknown = { choices: [{ message: { content: 'ok' } }] }) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch

beforeEach(() => resetRateLimit())

describe('/api/ai', () => {
  it('vidarebefordrar med serverns nyckel och släpper bara igenom tillåtna fält', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const res = await handleAi(req(), env, upstream(calls))
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-server')
    const sent = JSON.parse(calls[0].init.body as string)
    expect(Object.keys(sent).sort()).toEqual(['messages', 'model'])
  })
  it('avvisar fel, saknat lösenord och saknad konfiguration', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    expect((await handleAi(req({ headers: { 'x-app-password': 'fel' } }), env, upstream(calls))).status).toBe(401)
    expect((await handleAi(req({ headers: {} }), env, upstream(calls))).status).toBe(401)
    expect((await handleAi(req(), { ...env, OPENAI_API_KEY: undefined }, upstream(calls))).status).toBe(500)
    expect((await handleAi(req({ method: 'GET' }), env, upstream(calls))).status).toBe(405)
    expect(calls).toHaveLength(0) // ingenting nådde OpenAI
  })
  it('rate limiting ger 429 med Retry-After', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const e = { ...env, RATE_LIMIT_PER_MIN: '2' }
    expect((await handleAi(req(), e, upstream(calls))).status).toBe(200)
    expect((await handleAi(req(), e, upstream(calls))).status).toBe(200)
    const third = await handleAi(req(), e, upstream(calls))
    expect(third.status).toBe(429)
    expect(Number(third.headers?.['Retry-After'])).toBeGreaterThan(0)
    expect(calls).toHaveLength(2)
  })
  it('skickar OpenAI-fel vidare med samma status', async () => {
    const res = await handleAi(req(), env, upstream([], 404, { error: { message: 'model_not_found' } }))
    expect(res).toMatchObject({ status: 404, body: { error: { message: 'model_not_found' } } })
  })
  it('validerar förfrågan', () => {
    expect(sanitizeAiBody({ model: 'a b', messages: [{}] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x'.repeat(4_100_000) }] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{}], tools: [{ type: 'function' }], response_format: { type: 'json_object' } })).toMatchObject({ ok: true })
    // Verktygsanrop användes bara av chatten och skickas inte längre vidare.
    const clean = sanitizeAiBody({ model: 'gpt-4o', messages: [{}], tools: [{ type: 'function' }], tool_choice: 'auto' })
    expect(clean.ok && 'tools' in clean.value).toBe(false)
    expect(clean.ok && 'tool_choice' in clean.value).toBe(false)
  })
})

describe('öppen åtkomst (inget APP_PASSWORD)', () => {
  const open: Env = { OPENAI_API_KEY: 'sk-server' }
  it('släpper in utan lösenord, men med strängare gräns per besökare', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const r = (ip: string) => req({ headers: { 'x-forwarded-for': ip }, ip })
    for (let i = 0; i < 10; i++) expect((await handleAi(r('9.9.9.9'), open, upstream(calls))).status).toBe(200)
    expect((await handleAi(r('9.9.9.9'), open, upstream(calls))).status).toBe(429) // max 10/min i öppet läge
    expect((await handleAi(r('8.8.8.8'), open, upstream(calls))).status).toBe(200) // annan besökare påverkas inte
  })
  it('dagstak per besökare', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const e = { ...open, OPEN_DAILY_LIMIT: '2', RATE_LIMIT_PER_MIN: '100' }
    const r = req({ headers: { 'x-forwarded-for': '7.7.7.7' } })
    expect((await handleAi(r, e, upstream(calls))).status).toBe(200)
    expect((await handleAi(r, e, upstream(calls))).status).toBe(200)
    const third = await handleAi(r, e, upstream(calls))
    expect(third.status).toBe(429)
    expect(JSON.stringify(third.body)).toContain('Dagens gräns')
  })
  it('lösenord eller inloggning på servern stänger det öppna läget igen', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    expect((await handleAi(req({ headers: {} }), { ...open, APP_PASSWORD: 'hemligt' }, upstream(calls))).status).toBe(401)
    expect((await handleAi(req({ headers: {} }), { ...open, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a' }, upstream(calls))).status).toBe(401)
  })
})

describe('Supabase-inloggning på servern', () => {
  const bearer = { authorization: 'Bearer jwt' }
  const supa = (status: number, body: unknown) => (async (url: string) => (String(url).includes('/auth/v1/user') ? new Response(JSON.stringify(body), { status }) : new Response(JSON.stringify({ choices: [] })))) as unknown as typeof fetch
  it('släpper in tillåten e-post (skiftlägesokänsligt) men inte andra eller ogiltiga tokens', async () => {
    expect((await handleAi(req({ headers: bearer }), env, supa(200, { id: 'u1', email: 'me@example.com' }))).status).toBe(200)
    expect((await handleAi(req({ headers: bearer }), env, supa(200, { id: 'u2', email: 'annan@example.com' }))).status).toBe(403)
    expect((await handleAi(req({ headers: bearer }), env, supa(401, {}))).status).toBe(401)
    expect((await handleAi(req({ headers: bearer }), { ...env, ALLOWED_EMAILS: '' }, supa(200, { id: 'u1', email: 'me@example.com' }))).status).toBe(403)
  })
})

describe('/api/models', () => {
  it('kräver GET och inloggning', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    expect((await handleModels(req({ method: 'GET' }), env, upstream(calls, 200, { data: [] }))).status).toBe(200)
    expect(calls[0].url).toBe('https://api.openai.com/v1/models')
    expect((await handleModels(req({ method: 'GET', headers: {} }), env, upstream(calls))).status).toBe(401)
    expect((await handleModels(req({ method: 'POST' }), env, upstream(calls))).status).toBe(405)
  })
})
