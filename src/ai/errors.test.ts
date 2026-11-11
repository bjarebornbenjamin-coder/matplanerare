import { describe, expect, it } from 'vitest'
import { describeError } from './errors'

describe('describeError', () => {
  it('ger begripliga meddelanden för vanliga serverfel', async () => {
    expect(await describeError(new Response('', { status: 405 }))).toMatch(/Ladda om sidan/)
    expect(await describeError(new Response('', { status: 504 }))).toMatch(/hann inte svara/)
    expect(await describeError(new Response(JSON.stringify({ error: { message: 'Fel lösenord.' } }), { status: 401 }))).toMatch(/Fel lösenord/)
    expect(await describeError(new Response(JSON.stringify({ error: { message: 'Receptsökningen misslyckades' } }), { status: 502 }))).toMatch(/Receptsökningen misslyckades/)
  })
})
