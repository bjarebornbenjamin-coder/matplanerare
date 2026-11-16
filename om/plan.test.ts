import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../src/domain/storeSection'
import { DISHES, FRIDGE, planWeek, shoppingFor, usedInTime, type FridgeItem } from './plan'

describe('exemplet på presentationssidan', () => {
  const week = planWeek('2026-11-16')

  it('planerar sju olika middagar på sju dagar i följd', () => {
    expect(week.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
    expect(new Set(week.map((d) => d.dish.id)).size).toBe(7)
  })

  it('det som går ut först används först, och allt i kylen används innan det går ut', () => {
    expect(week[0].arrivals[0].name).toBe('Grädde')
    expect(week[1].arrivals.map((a) => a.name)).toContain('Spenat') // går ut imorgon, används imorgon
    for (const [d, day] of week.entries()) for (const item of day.arrivals) expect(item.daysLeft).toBeGreaterThanOrEqual(d)
    const arrived = week.flatMap((d) => d.arrivals.map((a) => a.id))
    expect(new Set(arrived).size).toBe(arrived.length) // varje vara landar en gång
    expect(usedInTime(week)).toBe(FRIDGE.length)
  })

  it('en vara som redan har gått ut får ingen dag', () => {
    const fridge: FridgeItem[] = [{ id: 'gradde', name: 'Grädde', amount: '3 dl', daysLeft: -1 }, { id: 'agg', name: 'Ägg', amount: '6 st', daysLeft: 5 }]
    const w = planWeek('2026-11-16', fridge, DISHES, 3)
    expect(w.flatMap((d) => d.arrivals.map((a) => a.id))).not.toContain('gradde')
    expect(usedInTime(w, fridge)).toBe(1)
  })

  it('inköpslistan slås ihop och sorteras av appens egen kod', () => {
    const s = shoppingFor(week)
    expect(s.raw.length).toBeGreaterThan(s.count)
    const all = s.sections.flatMap((x) => x.lines.map((l) => `${l.name} · ${l.amount ?? ''}`))
    expect(all).toContain('Gul lök · 4 st') // "gul lök", "hackad gul lök", "lök, hackad" och "1 gul lök"
    expect(all).toContain('Koriander · 2 krukor') // 1 + 1/2 kruka
    expect(all).toContain('Ingefära · 1 st') // 3 cm
    expect(s.sections.map((x) => SECTIONS.indexOf(x.section))).toEqual([...s.sections.map((x) => SECTIONS.indexOf(x.section))].sort((a, b) => a - b))
    // Varor som finns i kylen hamnar aldrig på listan.
    for (const f of FRIDGE) expect(all.some((l) => l.toLowerCase().startsWith(f.name.toLowerCase()))).toBe(false)
  })
})
