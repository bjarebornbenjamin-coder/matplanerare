import { beforeEach, describe, expect, it } from 'vitest'
import { handleRecipeSearch, isoMinutes, parseCandidates, recipeFromHtml, safeUrl, searchPrompt, parseBody } from './_lib/recipes.js'
import { resetRateLimit } from './_lib/rateLimit.js'
import type { Env } from './_lib/types.js'

const env: Env = { OPENAI_API_KEY: 'sk', APP_PASSWORD: 'pw' }
const page = (recipe: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(recipe)}</script></head></html>`
const carbonara = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': ['Recipe'], name: 'Pasta carbonara', recipeIngredient: ['400 g spaghetti', '150 g bacon', '3 &auml;gg'.replace('&auml;', 'ä'), '1 dl riven parmesan'], recipeYield: '4 portioner', totalTime: 'PT25M', image: { url: 'https://x.se/a.jpg' } }] }

beforeEach(() => resetRateLimit())

describe('receptsidor', () => {
  it('läser receptet ur JSON-LD, även i @graph', () => {
    expect(recipeFromHtml(page(carbonara))).toEqual({ title: 'Pasta carbonara', ingredients: ['400 g spaghetti', '150 g bacon', '3 ägg', '1 dl riven parmesan'], servings: '4 portioner', minutes: 25, image: 'https://x.se/a.jpg' })
    expect(recipeFromHtml('<html>inget recept</html>')).toBeNull()
    expect(recipeFromHtml(page({ '@type': 'Recipe', name: 'Tomt', recipeIngredient: [] }))).toBeNull()
    expect(isoMinutes('PT1H15M')).toBe(75)
  })
  it('släpper bara igenom publika https-adresser och tar bort spårning', () => {
    expect(safeUrl('https://www.ica.se/recept/pasta-123/?utm_source=x#top')?.toString()).toBe('https://www.ica.se/recept/pasta-123/')
    for (const bad of ['http://ica.se/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://a.local/x', 'https://u:p@ica.se/', 'nej']) expect(safeUrl(bad)).toBeNull()
  })
  it('plockar ut kandidater även med text runt JSON', () => {
    expect(parseCandidates('Här: {"recipes":[{"title":"A","url":"https://a.se/r","why":"snabb"},{"title":"B"}]} klart')).toEqual([{ title: 'A', url: 'https://a.se/r', why: 'snabb' }])
    expect(parseCandidates('inget')).toEqual([])
  })
  it('prompten följer valet om att handla', () => {
    const b = parseBody({ mode: 'pantry', pantry: [{ name: 'Kyckling', daysLeft: 1 }] })!
    expect(searchPrompt(b)).toMatch(/Inget annat får behöva köpas/)
    expect(searchPrompt({ ...b, mode: 'any' })).toMatch(/handla allt/)
    expect(searchPrompt({ ...b, dish: 'Lasagne' })).toMatch(/recept på rätten: Lasagne/)
    expect(searchPrompt({ ...b, count: 1 })).toMatch(/Hitta 4 olika/)
    expect(parseBody({ mode: 'fel' })).toBeNull()
  })
})

describe('/api/recipes', () => {
  it('returnerar bara sidor som går att läsa som recept, med sidans ingredienser', async () => {
    const calls: string[] = []
    const bodies: { model: string; tools: { type: string }[] }[] = []
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(url)
      if (url === 'https://api.openai.com/v1/responses') {
        const sent = JSON.parse(String(init!.body))
        bodies.push(sent)
        // Första försöket: verktyget stöds inte av modellen, så nästa kombination provas.
        if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: "Tool 'web_search' is not supported with this model." } }), { status: 400 })
        const text = JSON.stringify({ recipes: [{ title: 'Carbonara', url: 'https://www.ica.se/recept/carbonara-1/?utm_source=a', why: 'Använder äggen' }, { title: 'Påhittad', url: 'https://www.ica.se/recept/finns-inte/', why: '' }, { title: 'Intern', url: 'http://localhost/x', why: '' }] })
        return new Response(JSON.stringify({ output: [{ type: 'web_search_call', status: 'completed' }, { type: 'message', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url: 'https://www.koket.se/kycklinggryta', title: 'Kycklinggryta' }] }] }] }))
      }
      if (url === 'https://www.ica.se/recept/carbonara-1/') return new Response(page(carbonara), { headers: { 'content-type': 'text/html' } })
      if (url === 'https://www.koket.se/kycklinggryta') return new Response(page({ '@type': 'Recipe', name: 'Kycklinggryta', recipeIngredient: ['500 g kycklingfilé'] }), { headers: { 'content-type': 'text/html; charset=utf-8' } })
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch
    const res = await handleRecipeSearch({ method: 'POST', headers: { 'x-app-password': 'pw' }, body: { mode: 'some', pantry: [{ name: 'Ägg' }] }, ip: '1' }, env, fetchFn)
    expect(res.status).toBe(200)
    const { recipes } = res.body as { recipes: { title: string; url: string; site: string; why: string; ingredients: string[] }[] }
    expect(recipes.map((r) => [r.title, r.site, r.why])).toEqual([['Pasta carbonara', 'ica.se', 'Använder äggen'], ['Kycklinggryta', 'koket.se', '']])
    expect(calls).not.toContain('http://localhost/x')
    expect(bodies.map((b) => `${b.model}/${b.tools[0].type}`)).toEqual(['gpt-4.1-mini/web_search', 'gpt-4.1-mini/web_search_preview'])
  })
  it('kräver lösenord och ger 404 när inget gick att läsa', async () => {
    const f = (async (url: string) => (url.includes('openai') ? new Response(JSON.stringify({ output_text: '{"recipes":[]}' })) : new Response(''))) as unknown as typeof fetch
    expect((await handleRecipeSearch({ method: 'POST', headers: {}, body: { mode: 'any' }, ip: '1' }, env, f)).status).toBe(401)
    expect((await handleRecipeSearch({ method: 'POST', headers: { 'x-app-password': 'pw' }, body: { mode: 'any' }, ip: '1' }, env, f)).status).toBe(404)
    // Fel nyckel provas inte om med andra modeller, och felet blir 502 (inte "modellen hittades inte").
    let n = 0
    const bad = (async () => (n++, new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 }))) as unknown as typeof fetch
    const res = await handleRecipeSearch({ method: 'POST', headers: { 'x-app-password': 'pw' }, body: { mode: 'any' }, ip: '1' }, env, bad)
    expect([res.status, n]).toEqual([502, 1])
    expect(JSON.stringify(res.body)).toMatch(/Incorrect API key/)
  })
})
