import { describe, expect, it } from 'vitest'
import { MEAL_PLAN_PROMPT, dayContext, fetchMealPlan, mealPlanUserContent, missingForPlan, parseMealPlan, planStart } from './mealPlan'
import type { PantryItem, PlannedDinner } from '../domain/types'

const food = { quickWeekdays: [2], trainingWeekdays: [3] }
const pantry: PantryItem[] = [{ id: 'p', name: 'Kycklingfilé', amount: '500 g', addedAt: '2026-11-01', source: 'manual', updatedAt: '' }]
const dinner = (date: string, title: string, ingredients: { name: string; amount: string }[]): PlannedDinner => ({ id: date, date, title, reason: '', portions: 2, minutes: 30, ingredients, steps: ['Laga'], updatedAt: '' })

describe('veckomeny', () => {
  it('dagar med ont om tid och träningsdagar följer användarens val', () => {
    expect(dayContext('2026-11-10', food)).toEqual({ date: '2026-11-10', weekday: 'tisdag', quick: true, training: false })
    expect(dayContext('2026-11-11', food)).toMatchObject({ quick: false, training: true })
    expect(dayContext('2026-11-12', food)).toMatchObject({ quick: false, training: false })
  })

  it('tar bara begärda datum, ett per dag, och kräver ingredienser och steg', () => {
    const text = JSON.stringify({
      days: [
        { date: '2026-11-10', title: 'Pasta carbonara', ingredients: [{ name: 'Pasta', amount: '200 g' }], steps: ['Koka'] },
        { date: '2026-11-10', title: 'Dubblett', ingredients: [{ name: 'X', amount: '1 st' }], steps: ['Y'] },
        { date: '2026-12-01', title: 'Fel datum', ingredients: [{ name: 'X', amount: '1 st' }], steps: ['Y'] },
        { date: '2026-11-11', title: 'Tom', ingredients: [] },
      ],
    })
    const plan = parseMealPlan(text, ['2026-11-10', '2026-11-11'], 2)
    expect(plan.map((d) => d.title)).toEqual(['Pasta carbonara'])
    expect(plan[0]).toMatchObject({ id: '2026-11-10', portions: 2 })
    expect(() => parseMealPlan('inte json', ['2026-11-10'], 2)).toThrow(/tolka/)
  })

  it('slår ihop det som saknas över veckan och hoppar över det som finns hemma', () => {
    const plan = [
      dinner('2026-11-10', 'Kycklinggryta', [{ name: 'Kycklingfilé', amount: '400 g' }, { name: 'Grädde', amount: '2 dl' }, { name: 'Salt', amount: '1 tsk' }]),
      dinner('2026-11-12', 'Laxpasta', [{ name: 'grädde', amount: '1,5 dl' }, { name: 'Lax', amount: '300 g' }]),
    ]
    expect(missingForPlan(plan, pantry)).toEqual([
      { name: 'Grädde', amount: '3,5 dl', note: 'Veckomeny: Kycklinggryta, Laxpasta' },
      { name: 'Lax', amount: '300 g', note: 'Veckomeny: Laxpasta' },
    ])
  })

  it('börjar idag före 17, annars imorgon, och skickar dagarna till servern', async () => {
    expect(planStart('2026-11-10', '16:59')).toBe('2026-11-10')
    expect(planStart('2026-11-10', '17:00')).toBe('2026-11-11')
    let sent = ''
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = String(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ days: [{ date: '2026-11-10', title: 'Chili con carne', ingredients: [{ name: 'Köttfärs', amount: '500 g' }], steps: ['Bryn'] }] }) } }] }), { status: 200 })
    }) as typeof fetch
    const plan = await fetchMealPlan({ days: [dayContext('2026-11-10', food)], pantry, food: { allergies: '', portions: 4 }, memories: ['Gillar inte svamp'], recent: [], today: '2026-11-10' }, 'gpt-4o-mini', {}, fetchFn)
    expect(plan[0]).toMatchObject({ title: 'Chili con carne', portions: 4 })
    expect(sent).toContain('Gillar inte svamp')
    expect(JSON.parse(sent).response_format).toEqual({ type: 'json_object' })
  })
})

describe('önskemål för veckan', () => {
  it('skickas med till AI:n, och prompten säger att de går före', () => {
    const food = { allergies: '', portions: 2, weekWishes: '  Fredag: något lyxigt. Onsdag: under 30 min  ' }
    const sent = JSON.parse(mealPlanUserContent({ days: [], pantry: [], food, memories: [], recent: [], today: '2026-11-10' }))
    expect(sent.wishes).toBe('Fredag: något lyxigt. Onsdag: under 30 min')
    expect(JSON.parse(mealPlanUserContent({ days: [], pantry: [], food: { allergies: '', portions: 2 }, memories: [], recent: [], today: '2026-11-10' })).wishes).toBe('inga')
    expect(MEAL_PLAN_PROMPT).toMatch(/wishes/)
  })
})
