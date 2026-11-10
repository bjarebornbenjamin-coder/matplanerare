import { describe, expect, it } from 'vitest'
import { runChat } from './chat'
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

describe('reservmodell', () => {
  it('faller tillbaka på standardmodellen om vald modell saknas', async () => {
    const used: string[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const model = JSON.parse(init.body as string).model
      used.push(model)
      return model === 'finns-inte'
        ? new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 404 })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'Hej' } }] }))
    }) as unknown as typeof fetch
    const ctx = { settings: { id: 'main' as const, theme: 'system' as const, food: { allergies: '', portions: 2, quickWeekdays: [], trainingWeekdays: [], shopping: { enabled: true, weekday: 5, time: '16:00' }, expiry: { enabled: true, time: '08:00' } }, nutrition: { proteinG: 120, carbsG: 250, fatG: 70, waterMl: 2000, glassMl: 250 }, memories: [] }, pantry: [], shopping: [], meals: [], water: [], mealPlan: [] }
    const res = await runChat({ headers: { 'x-app-password': 'k' }, model: 'finns-inte', history: [], userText: 'hej', now: new Date(), loadContext: async () => ctx, fetchFn })
    expect(used).toEqual(['finns-inte', DEFAULT_MODEL])
    expect(res.reply).toBe('Hej')
    expect(res.notice).toContain('finns-inte')
    // standardmodellen själv ger inget oändligt omförsök
    const always404 = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    await expect(runChat({ headers: { 'x-app-password': 'k' }, model: DEFAULT_MODEL, history: [], userText: 'hej', now: new Date(), loadContext: async () => ctx, fetchFn: always404 })).rejects.toThrow(/Modellen hittades inte/)
  })
})
