import { describe, expect, it } from 'vitest'
import { planNotifications } from './notifications'

describe('mat-notiser', () => {
  const food = { allergies: '', portions: 2, quickWeekdays: [], trainingWeekdays: [], shopping: { enabled: true, weekday: 5, time: '16:00' }, expiry: { enabled: true, time: '08:00' } }
  const settings = { food }
  const item = (name: string, expires?: string) => ({ id: name, name, expires, addedAt: '2026-11-01', source: 'manual' as const, updatedAt: '' })
  const buy = (name: string, done = false) => ({ id: name, name, done, addedAt: '2026-11-01', updatedAt: '' })
  const now = new Date('2026-11-10T12:00:00') // tisdag

  it('utgångsnotis dagen varan går ut och dagen före, sorterad, och inte för tider som passerat', () => {
    const plan = planNotifications(now, settings, { pantry: [item('Mjölk', '2026-11-12'), item('Yoghurt', '2026-11-11'), item('Ris', '2027-01-01'), item('Gammal', '2026-11-01')], shopping: [] }, 3)
    const exp = plan.filter((n) => n.id.startsWith('expiry:'))
    // idag 08:00 har redan passerat, så första är i morgon
    expect(exp.map((n) => n.id)).toEqual(['expiry:2026-11-11', 'expiry:2026-11-12'])
    expect(exp[0]).toMatchObject({ title: 'Mat som snart går ut', body: 'Yoghurt (idag), Mjölk (imorgon)' })
    expect(exp[1].body).toBe('Mjölk (idag)')
    expect(exp[0].fireAt).toEqual(new Date('2026-11-11T08:00:00'))
  })
  it('hoppar över passerad tid idag och avstängd notis', () => {
    const late = new Date('2026-11-10T09:00:00')
    expect(planNotifications(late, settings, { pantry: [item('Mjölk', '2026-11-10')], shopping: [] }, 0)).toEqual([])
    const off = { ...settings, food: { ...food, expiry: { ...food.expiry, enabled: false } } }
    expect(planNotifications(now, off, { pantry: [item('Mjölk', '2026-11-11')], shopping: [] }, 3)).toEqual([])
  })
  it('inköpsnotis på vald veckodag med antal och namn, bara om listan har något', () => {
    const shopping = [buy('Mjölk'), buy('Ägg'), buy('Bröd', true)]
    const plan = planNotifications(now, settings, { pantry: [], shopping }, 7)
    const shop = plan.filter((n) => n.id.startsWith('shopping:'))
    expect(shop.map((n) => n.id)).toEqual(['shopping:2026-11-13']) // fredag
    expect(shop[0]).toMatchObject({ title: 'Inköpslistan: 2 varor', body: 'Mjölk, Ägg' })
    expect(shop[0].fireAt).toEqual(new Date('2026-11-13T16:00:00'))
    expect(planNotifications(now, settings, { pantry: [], shopping: [buy('Bröd', true)] }, 7)).toEqual([])
    expect(planNotifications(now, settings, { pantry: [], shopping: [buy('Ost')] }, 7)[0].title).toBe('Inköpslistan: 1 vara')
  })
  it('många varor kortas med "+N till"', () => {
    const shopping = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => buy(n))
    expect(planNotifications(now, settings, { pantry: [], shopping }, 7)[0].body).toBe('a, b, c, d, e, f +2 till')
  })
  it('utgångsnotisen nämner kvällens middag när den är planerad', () => {
    const mealPlan = [{ id: '2026-11-11', date: '2026-11-11', title: 'Pasta carbonara', reason: '', portions: 2, minutes: 25, ingredients: [], steps: [], updatedAt: '' }]
    const [n] = planNotifications(now, settings, { pantry: [item('Grädde', '2026-11-11')], shopping: [], mealPlan }, 1)
    expect(n).toMatchObject({ title: 'Ikväll: Pasta carbonara', body: 'Går ut snart: Grädde (idag)' })
  })
})
