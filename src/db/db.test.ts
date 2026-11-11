import { beforeEach, describe, expect, it } from 'vitest'
import { parseBackup } from './backup'
import { db } from './db'
import { rateDish, addPantryItems, addShoppingItems, addWater, clearBought, exportAll, getSettings, importAll, moveBoughtToPantry, runOut, saveSettings } from './repo'

beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.aiConfig.clear(), db.pantry.clear(), db.shopping.clear(), db.water.clear(), db.mealPlan.clear(), db.sides.clear(), db.ratings.clear()])
})

describe('export och import', () => {
  it('ger samma data tillbaka', async () => {
    await saveSettings({ memories: ['Gillar inte svamp'], food: { ...(await getSettings()).food, allergies: 'nötter', quickWeekdays: [2, 4] } })
    await db.pantry.put({ id: 'p1', name: 'Mjölk', amount: '1 l', expires: '2026-11-12', addedAt: '2026-11-08', source: 'receipt', updatedAt: '' })
    await db.shopping.put({ id: 's1', name: 'Ägg', done: false, addedAt: '2026-11-08', updatedAt: '' })
    await addWater('2026-11-10', 500)
    await db.mealPlan.put({ id: '2026-11-11', date: '2026-11-11', title: 'Pasta carbonara', reason: '', portions: 2, minutes: 25, ingredients: [{ name: 'Pasta', amount: '200 g' }], steps: [], url: 'https://www.ica.se/recept/x/', site: 'ica.se', updatedAt: '' })
    await db.sides.put({ id: '2026-11-12:lunch', date: '2026-11-12', slot: 'lunch', title: 'Pasta carbonara', portions: 1, minutes: null, ingredients: [], fromBatch: '2026-11-11', updatedAt: '' })
    const backup = parseBackup(JSON.parse(JSON.stringify(await exportAll())))
    await Promise.all([db.settings.clear(), db.pantry.clear(), db.shopping.clear(), db.water.clear(), db.mealPlan.clear(), db.sides.clear(), db.ratings.clear()])
    await importAll(backup)
    const s = await getSettings()
    expect(s.memories).toEqual(['Gillar inte svamp'])
    expect(s.food).toMatchObject({ allergies: 'nötter', quickWeekdays: [2, 4] })
    expect((await db.pantry.get('p1'))?.expires).toBe('2026-11-12')
    expect((await db.shopping.get('s1'))?.name).toBe('Ägg')
    expect((await db.water.get('2026-11-10'))?.ml).toBe(500)
    expect(await db.sides.get('2026-11-12:lunch')).toMatchObject({ slot: 'lunch', fromBatch: '2026-11-11' })
    expect(await db.mealPlan.get('2026-11-11')).toMatchObject({ title: 'Pasta carbonara', url: 'https://www.ica.se/recept/x/' })
  })
  it('avvisar filer från andra appar och ogiltiga varor', () => {
    expect(() => parseBackup({ app: 'studieassistent', version: 8 })).toThrow(/Matplaneraren/)
    expect(() => parseBackup({ app: 'matplanerare', version: 2 })).toThrow(/version/)
    expect(() => parseBackup({ app: 'matplanerare', version: 1, pantry: [{ id: 'x', name: '', addedAt: '2026-11-08' }] })).toThrow(/matvara/)
    expect(parseBackup({ app: 'matplanerare', version: 1 })).toMatchObject({ pantry: [], shopping: [], water: [], mealPlan: [], settings: null })
  })
})

describe('inköpslista', () => {
  beforeEach(async () => {
    await Promise.all([db.shopping.clear(), db.pantry.clear()])
  })
  it('hoppar över dubbletter (skiftlägesokänsligt) men tillåter igen när varan är köpt', async () => {
    expect(await addShoppingItems([{ name: 'Mjölk' }, { name: ' mjölk ' }, { name: 'Ägg', amount: '10 st' }, { name: '  ' }])).toEqual({ added: 2, skipped: 2 })
    const milk = (await db.shopping.toArray()).find((i) => i.name === 'Mjölk')!
    await db.shopping.update(milk.id, { done: true })
    expect((await addShoppingItems([{ name: 'mjölk' }])).added).toBe(1) // den köpta räknas inte
  })
  it('köpta varor flyttas till lagret, resten ligger kvar', async () => {
    await addShoppingItems([{ name: 'Mjölk', amount: '1 l' }, { name: 'Ägg' }])
    const milk = (await db.shopping.toArray()).find((i) => i.name === 'Mjölk')!
    await db.shopping.update(milk.id, { done: true })
    expect(await moveBoughtToPantry('2026-11-10')).toBe(1)
    expect((await db.pantry.toArray())[0]).toMatchObject({ name: 'Mjölk', amount: '1 l', source: 'shopping', addedAt: '2026-11-10' })
    expect((await db.shopping.toArray()).map((i) => i.name)).toEqual(['Ägg'])
  })
  it('rensa köpta och "slut" med eller utan inköpslista', async () => {
    await addShoppingItems([{ name: 'A' }, { name: 'B' }])
    const a = (await db.shopping.toArray()).find((i) => i.name === 'A')!
    await db.shopping.update(a.id, { done: true })
    await clearBought()
    expect((await db.shopping.toArray()).map((i) => i.name)).toEqual(['B'])
    await db.pantry.bulkAdd([
      { id: 'p1', name: 'Smör', amount: '1 st', addedAt: '2026-11-01', source: 'manual', updatedAt: '' },
      { id: 'p2', name: 'Ost', addedAt: '2026-11-01', source: 'manual', updatedAt: '' },
    ])
    await runOut('p1', true)
    await runOut('p2', false)
    expect(await db.pantry.count()).toBe(0)
    expect((await db.shopping.toArray()).map((i) => i.name).sort()).toEqual(['B', 'Smör'])
  })
})

describe('addPantryItems', () => {
  it('sparar varor med källa och datum, och rensar samma varor från inköpslistan', async () => {
    await Promise.all([db.pantry.clear(), db.shopping.clear(), db.water.clear()])
    await addShoppingItems([{ name: 'Mjölk' }, { name: 'Ägg' }, { name: 'Bröd' }])
    const r = await addPantryItems([{ name: ' mjölk ', amount: '1 l', expires: '2026-11-17' }, { name: 'Ris' }, { name: '  ' }], 'receipt', { clearFromList: true, today: '2026-11-10' })
    expect(r).toEqual({ added: 2, removedFromList: 1 })
    const items = await db.pantry.toArray()
    expect(items.find((i) => i.name === 'mjölk')).toMatchObject({ amount: '1 l', expires: '2026-11-17', source: 'receipt', addedAt: '2026-11-10' })
    expect((await db.shopping.toArray()).map((i) => i.name).sort()).toEqual(['Bröd', 'Ägg'])
  })
})

describe('vatten', () => {
  it('vatten läggs ihop per dag, kan inte bli negativt och begränsas uppåt', async () => {
    await db.water.clear()
    expect(await addWater('2026-11-10', 250)).toBe(250)
    expect(await addWater('2026-11-10', 250)).toBe(500)
    expect(await addWater('2026-11-10', -1000)).toBe(0)
    expect(await addWater('2026-11-10', 99_999)).toBe(20_000)
    expect(await db.water.count()).toBe(1)
  })
})

describe('betyg på rätter', () => {
  it('samma rätt oavsett skrivsätt, samma tumme igen tar bort, och följer med i säkerhetskopian', async () => {
    await db.ratings.clear()
    await rateDish({ title: 'Pasta Carbonara', date: '2026-11-10', url: 'https://www.ica.se/recept/x/', site: 'ica.se' }, 1)
    await rateDish({ title: 'pasta  carbonara' }, -1)
    expect(await db.ratings.toArray()).toMatchObject([{ id: 'pasta carbonara', rating: -1 }])
    await rateDish({ title: 'Pasta carbonara' }, -1)
    expect(await db.ratings.count()).toBe(0)
    await rateDish({ title: 'Tacos' }, 1)
    const backup = parseBackup(JSON.parse(JSON.stringify(await exportAll())))
    expect(backup.ratings).toMatchObject([{ id: 'tacos', title: 'Tacos', rating: 1 }])
    expect(() => parseBackup({ app: 'matplanerare', version: 1, ratings: [{ id: 'x', title: 'X', rating: 5 }] })).toThrow(/betyg/)
  })
})
