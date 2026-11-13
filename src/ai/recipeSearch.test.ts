import { describe, expect, it } from 'vitest'
import { findRecipes, ingredientStatuses, splitIngredient, recipeForDish } from './recipeSearch'
import type { PantryItem } from '../domain/types'

const pantry: PantryItem[] = [
  { id: '1', name: 'Kycklingfilé', addedAt: '2026-11-01', source: 'manual', updatedAt: '' },
  { id: '2', name: 'Grädde', expires: '2026-11-01', addedAt: '2026-11-01', source: 'manual', updatedAt: '' },
]

describe('receptsökning i appen', () => {
  it('delar upp ingrediensrader i mängd och vara', () => {
    expect(splitIngredient('400 g kycklingfilé')).toEqual({ amount: '400 g', name: 'kycklingfilé' })
    expect(splitIngredient('1 1/2 dl grädde')).toEqual({ amount: '1 1/2 dl', name: 'grädde' })
    expect(splitIngredient('2 klyftor vitlök')).toEqual({ amount: '2 klyftor', name: 'vitlök' })
    expect(splitIngredient('salt och peppar')).toEqual({ amount: '', name: 'salt och peppar' })
    // Mått som receptsidor använder och som annars hamnar i namnet.
    expect(splitIngredient('0,5 ask ärtskott')).toEqual({ amount: '0,5 ask', name: 'ärtskott' })
    expect(splitIngredient('12 cm gurka')).toEqual({ amount: '12 cm', name: 'gurka' })
    expect(splitIngredient('1/2 kruka basilika')).toEqual({ amount: '1/2 kruka', name: 'basilika' })
    expect(splitIngredient('1 pkt bacon')).toEqual({ amount: '1 pkt', name: 'bacon' })
    expect(splitIngredient('2 stjälkar blekselleri')).toEqual({ amount: '2 stjälkar', name: 'blekselleri' })
    expect(splitIngredient('1 förpackning halloumi')).toEqual({ amount: '1 förpackning', name: 'halloumi' })
    // Ord som bara börjar som ett mått hör till varan.
    expect(splitIngredient('2 gurkor')).toEqual({ amount: '2', name: 'gurkor' })
    expect(splitIngredient('1 lök')).toEqual({ amount: '1', name: 'lök' })
    expect(splitIngredient('2 portabellosvampar')).toEqual({ amount: '2', name: 'portabellosvampar' })
    expect(splitIngredient('1 bladselleri')).toEqual({ amount: '1', name: 'bladselleri' })
  })
  it('markerar det som finns hemma, basvaror och det som saknas', () => {
    expect(ingredientStatuses(['500 g kycklingfilé, i bitar', '2 dl grädde', '1 tsk salt', '1 gul lök'], pantry).map((i) => i.status)).toEqual(['pantry', 'pantry', 'staple', 'missing'])
  })
  it('skickar valet och bara ej utgångna varor till servern', async () => {
    let sent: Record<string, unknown> = {}
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ recipes: [{ title: 'Kycklinggryta', url: 'https://www.ica.se/recept/x/', site: 'ica.se', why: '', ingredients: ['500 g kycklingfilé'] }] }))
    }) as typeof fetch
    const r = await findRecipes({ mode: 'pantry', pantry, food: { allergies: 'nötter' }, memories: [], today: '2026-11-10', wish: ' snabbt ' }, {}, f)
    expect(r[0].title).toBe('Kycklinggryta')
    expect(sent).toMatchObject({ mode: 'pantry', allergies: 'nötter', wish: 'snabbt', count: 3 })
    expect(sent.pantry).toEqual([{ name: 'Kycklingfilé' }])
  })
})

describe('recipeForDish', () => {
  const q = { pantry: [], food: { allergies: '' }, memories: [], today: '2026-11-11' }
  const recipe = { title: 'Kikärtsgryta med spenat', url: 'https://www.ica.se/recept/kikartsgryta/', site: 'ica.se', why: '', ingredients: ['400 g kikärtor'] }
  const respond = (ok: boolean) => (ok ? new Response(JSON.stringify({ recipes: [recipe] }), { status: 200 }) : new Response(JSON.stringify({ error: 'Hittade inga receptsidor som gick att läsa.' }), { status: 404 }))

  it('tar en liknande rätt när ingen sida för rätten går att läsa', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return respond(bodies.length === 2)
    }) as typeof fetch
    expect(await recipeForDish('Chana masala med ris', q, {}, fetchFn)).toEqual(recipe)
    expect(bodies[0]).toMatchObject({ dish: 'Chana masala med ris', count: 1, mode: 'any' })
    expect(bodies[1].dish).toBeUndefined()
    expect(bodies[1].wish).toMatch(/Chana masala med ris, eller en liknande rätt/)
  })

  it('ger null när inget recept alls hittas, och frågar inte två gånger när det första går', async () => {
    expect(await recipeForDish('X', q, {}, (async () => respond(false)) as unknown as typeof fetch)).toBeNull()
    let calls = 0
    await recipeForDish('Lasagne', q, {}, (async () => { calls++; return respond(true) }) as unknown as typeof fetch)
    expect(calls).toBe(1)
  })
})
