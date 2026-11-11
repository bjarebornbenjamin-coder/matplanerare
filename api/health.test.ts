import { beforeEach, describe, expect, it } from 'vitest'
import { handleHealth, resetHealthCache } from './_lib/health.js'
import { resetRateLimit } from './_lib/rateLimit.js'
import type { ApiRequest, Env } from './_lib/types.js'

const req = (method = 'GET', headers: ApiRequest['headers'] = {}): ApiRequest => ({ method, headers, body: undefined, ip: '1.1.1.1' })
const counting = (status = 200, body: unknown = {}) => {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { f, calls }
}
const env: Env = { OPENAI_API_KEY: 'sk-hemlig', APP_PASSWORD: 'lösen' }
const authed = req('POST', { 'x-app-password': 'lösen' })

beforeEach(() => {
  resetHealthCache()
  resetRateLimit()
})

describe('/api/health', () => {
  it('GET svarar bara att servern är uppe: inget om konfigurationen och inget anrop till OpenAI', async () => {
    const { f, calls } = counting()
    for (const e of [env, {}, { OPENAI_API_KEY: 'x' }, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a' }]) {
      const r = await handleHealth(req(), e, f)
      expect(r).toMatchObject({ status: 200, body: { ok: true } })
      expect(Object.keys(r.body as object)).toEqual(['ok'])
    }
    expect(calls).toHaveLength(0)
  })
  it('detaljerna kräver lösenord eller inloggning', async () => {
    const { f, calls } = counting()
    expect((await handleHealth(req('POST'), env, f)).status).toBe(401)
    expect((await handleHealth(req('POST', { 'x-app-password': 'fel' }), env, f)).status).toBe(401)
    expect(calls).toHaveLength(0)
    expect((await handleHealth(req('PUT'), env, f)).status).toBe(405)
  })
  it('visar för den som har åtkomst om nyckeln fungerar, utan att avslöja värden', async () => {
    const { f } = counting(200)
    const r = await handleHealth(authed, env, f)
    expect(r.body).toEqual({ openaiKeyConfigured: true, openAccess: false, openai: { ok: true, status: 200, code: undefined } })
    expect(JSON.stringify(r.body)).not.toContain('sk-hemlig')
    expect(JSON.stringify(r.body)).not.toContain('lösen')
  })
  it('kontrollen mot OpenAI sparas i 5 minuter', async () => {
    const { f, calls } = counting(200)
    const t = 1_000_000
    await handleHealth(authed, env, f, t)
    await handleHealth(authed, env, f, t + 60_000)
    expect(calls).toHaveLength(1)
    await handleHealth(authed, env, f, t + 5 * 60_000 + 1)
    expect(calls).toHaveLength(2)
  })
  it('rapporterar OpenAI-felkoder och saknad nyckel', async () => {
    expect((await handleHealth(authed, env, counting(401, { error: { code: 'invalid_api_key' } }).f)).body).toMatchObject({ openai: { ok: false, status: 401, code: 'invalid_api_key' } })
    resetHealthCache()
    const down = (async () => { throw new Error('x') }) as unknown as typeof fetch
    expect((await handleHealth(authed, env, down)).body).toMatchObject({ openai: { ok: false, code: 'unreachable' } })
    const { f, calls } = counting()
    expect((await handleHealth(authed, { APP_PASSWORD: 'lösen' }, f)).body).toMatchObject({ openaiKeyConfigured: false, openai: null })
    expect(calls).toHaveLength(0)
  })
  it('markerar öppen åtkomst för den som använder den', async () => {
    expect((await handleHealth(req('POST'), { OPENAI_API_KEY: 'x' }, counting().f)).body).toMatchObject({ openAccess: true })
  })
})
