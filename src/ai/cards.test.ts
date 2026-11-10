import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { applyCard } from './cards'

beforeEach(async () => {
  await Promise.all([db.pantry.clear(), db.shopping.clear(), db.meals.clear(), db.water.clear()])
})

describe('applyCard: mat', () => {
  it('lägger på inköpslistan (utan dubbletter), i lagret, och tar bort ur lagret', async () => {
    await applyCard({ type: 'shopping_add', items: [{ name: 'Mjölk', amount: '2 l' }, { name: 'Ägg' }] })
    await applyCard({ type: 'shopping_add', items: [{ name: 'mjölk' }] })
    expect((await db.shopping.toArray()).map((i) => i.name).sort()).toEqual(['Mjölk', 'Ägg'])
    await applyCard({ type: 'pantry_add', items: [{ name: 'Smör', amount: '1 st', expires: '2026-12-01' }, { name: 'Ost' }] })
    const pantry = await db.pantry.toArray()
    expect(pantry.map((p) => p.name).sort()).toEqual(['Ost', 'Smör'])
    const butter = pantry.find((p) => p.name === 'Smör')!
    expect(await applyCard({ type: 'pantry_remove', ids: [butter.id, 'finns-inte'], names: ['Smör'] })).toBe('done')
    expect((await db.pantry.toArray()).map((p) => p.name)).toEqual(['Ost'])
    expect(await applyCard({ type: 'pantry_remove', ids: [butter.id], names: ['Smör'] })).toBe('missing')
  })
})

describe('applyCard: kost', () => {
  it('loggar måltid som AI-uppskattad och lägger till vatten (flera gånger summeras)', async () => {
    await applyCard({ type: 'meal_add', meal: { date: '2026-11-10', name: 'Gröt', protein: 12, carbs: 60, fat: 8, time: '08:00' } })
    const m = (await db.meals.toArray())[0]
    expect(m).toMatchObject({ name: 'Gröt', source: 'ai', date: '2026-11-10', time: '08:00', protein: 12 })
    await applyCard({ type: 'water_add', date: '2026-11-10', ml: 500 })
    await applyCard({ type: 'water_add', date: '2026-11-10', ml: 250 })
    expect((await db.water.get('2026-11-10'))?.ml).toBe(750)
  })
})
