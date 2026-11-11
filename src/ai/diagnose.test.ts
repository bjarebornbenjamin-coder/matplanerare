import { describe, expect, it } from 'vitest'
import { diagnose } from './diagnose'

type Details = { openaiKeyConfigured: boolean; openAccess?: boolean; openai: { ok: boolean; status: number; code?: string } | null }
const good: Details = { openaiKeyConfigured: true, openAccess: false, openai: { ok: true, status: 200 } }

/** GET /api/health svarar bara "uppe"; detaljerna kommer från POST med åtkomst. */
const server = (details: Details | number, up = 200) =>
  (async (url: string, init?: RequestInit) => {
    if (!String(url).includes('/api/health')) return new Response('{}', { status: 404 })
    if (init?.method !== 'POST') return new Response(JSON.stringify({ ok: true }), { status: up })
    return typeof details === 'number' ? new Response('{}', { status: details }) : new Response(JSON.stringify(details))
  }) as unknown as typeof fetch

describe('diagnose', () => {
  it('pekar ut rätt problem i rätt ordning', async () => {
    expect((await diagnose({ 'x-app-password': 'a' }, server(good, 404))).message).toMatch(/inte deployad/)
    expect((await diagnose({ 'x-app-password': 'a' }, server(good, 500))).message).toMatch(/Logs/)
    expect((await diagnose({}, server(401))).message).toMatch(/kräver inloggning eller lösenord/)
    expect((await diagnose({ 'x-app-password': 'fel' }, server(401))).message).toMatch(/stämmer inte/)
    expect((await diagnose({ Authorization: 'Bearer x' }, server(401))).message).toMatch(/Logga ut och in/)
    expect((await diagnose({ Authorization: 'Bearer x' }, server(403))).message).toMatch(/ALLOWED_EMAILS/)
    expect((await diagnose({ Authorization: 'Bearer x' }, server(429))).message).toMatch(/För många/)
    expect((await diagnose({ 'x-app-password': 'a' }, server({ ...good, openaiKeyConfigured: false, openai: null }))).message).toMatch(/OPENAI_API_KEY/)
    expect((await diagnose({ 'x-app-password': 'a' }, server({ ...good, openai: { ok: false, status: 401, code: 'invalid_api_key' } }))).message).toMatch(/avvisar nyckeln/)
    expect((await diagnose({ 'x-app-password': 'a' }, server({ ...good, openai: { ok: false, status: 429, code: 'insufficient_quota' } }))).message).toMatch(/tegoder/)
    expect(await diagnose({}, server({ ...good, openAccess: true }))).toMatchObject({ ok: true, message: expect.stringContaining('åtkomsten är öppen') })
  })
  it('varnar om en OpenAI-nyckel sparats som lösenord', async () => {
    expect((await diagnose({ 'x-app-password': 'sk-proj-abcdefghijklmnopqrstuvwxyz' }, server(good))).message).toMatch(/ser ut som en OpenAI-nyckel/)
  })
  it('rapporterar ok när allt fungerar, och nätfel begripligt', async () => {
    expect(await diagnose({ 'x-app-password': 'a' }, server(good))).toMatchObject({ ok: true })
    expect(await diagnose({ Authorization: 'Bearer x' }, server(good))).toMatchObject({ ok: true })
    const offline = (async () => { throw new TypeError('x') }) as unknown as typeof fetch
    expect((await diagnose({}, offline)).message).toMatch(/Kunde inte nå servern/)
  })
})
