import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_COMPLETION_TOKENS, handleAi, handleModels, sanitizeAiBody } from './_lib/openai.js'
import { handleHealth } from './_lib/health.js'
import { handleRecipeSearch } from './_lib/recipes.js'
import { handleTest } from './_lib/push.js'
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
    expect(Object.keys(sent).sort()).toEqual(['max_completion_tokens', 'messages', 'model'])
  })
  it('avvisar fel, saknat lösenord och saknad konfiguration', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    expect((await handleAi(req({ headers: { 'x-app-password': 'fel' } }), env, upstream(calls))).status).toBe(401)
    expect((await handleAi(req({ headers: {} }), env, upstream(calls))).status).toBe(401)
    expect((await handleAi(req(), { ...env, OPENAI_API_KEY: undefined }, upstream(calls))).status).toBe(500)
    expect((await handleAi(req({ method: 'GET' }), env, upstream(calls))).status).toBe(405)
    expect(calls).toHaveLength(0) // ingenting nådde OpenAI
  })
  it('hastighetsbegränsning: 10 AI-anrop per minut, sedan 429 med Retry-After och besked', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    for (let i = 0; i < 10; i++) expect((await handleAi(req(), env, upstream(calls))).status).toBe(200)
    const over = await handleAi(req(), env, upstream(calls))
    expect(over.status).toBe(429)
    expect(Number(over.headers?.['Retry-After'])).toBeGreaterThan(0)
    expect(JSON.stringify(over.body)).toMatch(/Försök igen om \d+ sekunder/)
    expect(calls).toHaveLength(10)
    // Modellistan har en egen räknare.
    expect((await handleModels(req({ method: 'GET' }), env, upstream([], 200, { data: [] }))).status).toBe(200)
  })
  it('skickar OpenAI-fel vidare med samma status', async () => {
    const res = await handleAi(req(), env, upstream([], 404, { error: { message: 'model_not_found' } }))
    expect(res).toMatchObject({ status: 404, body: { error: { message: 'model_not_found' } } })
  })
  it('skickar bara model, messages och response_format, med fast tak för svarets längd', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    await handleAi(req({ body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hej', name: 'x', tool_calls: [] }], tools: [{ type: 'function' }], tool_choice: 'auto', stream: true, max_tokens: 100000, n: 50, response_format: { type: 'json_object', extra: 1 } } }), env, upstream(calls))
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hej' }], max_completion_tokens: MAX_COMPLETION_TOKENS, response_format: { type: 'json_object' } })
  })
  it('validerar förfrågan och modellen mot listan över tillåtna', () => {
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x'.repeat(4_100_000) }] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'o1-pro', messages: [{ role: 'user', content: 'hej' }] })).toMatchObject({ ok: false, message: expect.stringMatching(/inte tillåten/) })
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'tool', content: 'x' }] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'javascript:alert(1)' } }] }] }).ok).toBe(false)
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: [{ type: 'text', text: 'Läs kvittot' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA', detail: 'high' } }] }] }).ok).toBe(true)
    const odd = sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hej' }], response_format: { type: 'json_schema', json_schema: {} } })
    expect(odd.ok && 'response_format' in odd.value).toBe(false)
    // Egen lista i Vercel ersätter den inbyggda.
    expect(sanitizeAiBody({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hej' }] }, { ALLOWED_MODELS: 'gpt-4o-mini' }).ok).toBe(false)
  })
  it('modellistan visar bara tillåtna modeller', async () => {
    const res = await handleModels(req({ method: 'GET' }), env, upstream([], 200, { object: 'list', data: [{ id: 'gpt-4o-mini' }, { id: 'o1-pro' }, { id: 'gpt-5' }] }))
    expect((res.body as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-5'])
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
    const e = { ...open, OPEN_DAILY_LIMIT: '2' }
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

describe('hastighetsbegränsning i Supabase (gemensam för alla serverinstanser)', () => {
  const bearer = { authorization: 'Bearer jwt' }
  const supa = (rpc: (body: Record<string, unknown>) => Response, rpcCalls: Record<string, unknown>[] = []) =>
    (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'me@example.com' }))
      if (String(url).includes('/rest/v1/rpc/hit_rate_limit')) {
        const body = JSON.parse(String(init?.body))
        rpcCalls.push({ ...body, auth: (init?.headers as Record<string, string>).Authorization })
        return rpc(body)
      }
      return new Response(JSON.stringify({ choices: [] }))
    }) as unknown as typeof fetch
  it('räknar per användare med användarens egen inloggning, och nekar med 429 när gränsen nåtts', async () => {
    const rpcCalls: Record<string, unknown>[] = []
    expect((await handleAi(req({ headers: bearer }), env, supa(() => new Response('0'), rpcCalls))).status).toBe(200)
    expect(rpcCalls[0]).toEqual({ p_bucket: 'ai', p_per_minute: 10, p_per_day: 150, auth: 'Bearer jwt' })
    const over = await handleAi(req({ headers: bearer }), env, supa(() => new Response('42')))
    expect(over.status).toBe(429)
    expect(over.headers?.['Retry-After']).toBe('42')
    const day = await handleAi(req({ headers: bearer }), env, supa(() => new Response('7200')))
    expect(JSON.stringify(day.body)).toMatch(/2 timmar/)
  })
  it('om räknaren saknas (SQL inte körd) gäller gränsen i minnet', async () => {
    const missing = supa(() => new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 }))
    for (let i = 0; i < 10; i++) expect((await handleAi(req({ headers: bearer }), env, missing)).status).toBe(200)
    expect((await handleAi(req({ headers: bearer }), env, missing)).status).toBe(429)
  })
})

describe('e-post som inte står i ALLOWED_EMAILS', () => {
  const bearer = { authorization: 'Bearer jwt' }
  const other = (async (url: string) => (String(url).includes('/auth/v1/user') ? new Response(JSON.stringify({ id: 'u9', email: 'okand@example.com' })) : new Response('{}'))) as unknown as typeof fetch
  it('får 403 från alla skyddade adresser', async () => {
    const e = { ...env, SUPABASE_SERVICE_ROLE_KEY: 's', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k' }
    expect((await handleAi(req({ headers: bearer }), e, other)).status).toBe(403)
    expect((await handleModels(req({ method: 'GET', headers: bearer }), e, other)).status).toBe(403)
    expect((await handleRecipeSearch({ method: 'POST', headers: bearer, body: { mode: 'any' }, ip: '1' }, e, other, async () => null)).status).toBe(403)
    expect((await handleHealth({ method: 'POST', headers: bearer, body: undefined, ip: '1' }, e, other)).status).toBe(403)
    expect((await handleTest({ method: 'POST', headers: bearer, body: undefined, ip: '1' }, e, { fetchFn: other })).status).toBe(403)
  })
})
