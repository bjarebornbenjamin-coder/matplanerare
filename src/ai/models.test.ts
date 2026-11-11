import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, fetchModels, filterChatModels } from './models'

describe('modeller', () => {
  it('filtrerar bort icke-chattmodeller och datumstämplade versioner', () => {
    const ids = ['gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-mini', 'gpt-4o-audio-preview', 'text-embedding-3-small', 'whisper-1', 'o3', 'o4-mini', 'gpt-4.1', 'gpt-4-0613', 'dall-e-3', 'gpt-image-1', 'gpt-4o-realtime-preview', 'tts-1']
    expect(filterChatModels(ids)).toEqual(['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'])
  })
  it('standardmodellen finns alltid med', () => {
    expect(filterChatModels(['gpt-4.1'])).toContain(DEFAULT_MODEL)
  })
  it('hämtar lista och ger begripliga fel', async () => {
    const ok = (async () => new Response(JSON.stringify({ data: [{ id: 'gpt-4.1' }, { id: 'o3' }, { id: 'whisper-1' }] }))) as unknown as typeof fetch
    expect(await fetchModels({ 'x-app-password': 'k' }, ok)).toEqual(['gpt-4.1', DEFAULT_MODEL, 'o3'].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })))
    const unauthorized = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    await expect(fetchModels({ 'x-app-password': 'k' }, unauthorized)).rejects.toThrow(/lösenord/i)
    const empty = (async () => new Response(JSON.stringify({ data: [{ id: 'whisper-1' }] }))) as unknown as typeof fetch
    await expect(fetchModels({ 'x-app-password': 'k' }, empty)).rejects.toThrow(/inga chattmodeller/)
  })
})
