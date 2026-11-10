import { describe, expect, it } from 'vitest'
import { BOX_DAYS, INSPIRATION, MEAL_PLAN_PROMPT, boxSides, fetchVariedMealPlan, pickInspiration, repeats, sameDish, dayContext, fetchMealPlan, mealPlanUserContent, parseSides, planDays, missingForPlan, parseMealPlan, planStart } from './mealPlan'
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
    expect(plan.dinners[0]).toMatchObject({ title: 'Chili con carne', portions: 4 })
    expect(plan.sides).toEqual([])
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

describe('frukost, lunch och storkok', () => {
  // 2026-11-08 är en söndag (7), 2026-11-09 måndag (1) osv.
  const week = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
  const base = { quickWeekdays: [], trainingWeekdays: [], portions: 2 }

  it('storkok på söndag ger matlådor till vardagsluncherna inom fyra dagar', () => {
    const { days, boxes } = planDays(week, { ...base, lunchWeekdays: [1, 2, 3, 4, 5], batchWeekdays: [7], breakfastWeekdays: [6, 7], boxPortions: 1 })
    expect(boxes.map((b) => b.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
    expect(boxes.every((b) => b.from === '2026-11-08')).toBe(true)
    expect(BOX_DAYS).toBe(4)
    const sun = days.find((d) => d.date === '2026-11-08')!
    expect(sun).toMatchObject({ portions: 6, batchBoxes: 4, breakfast: true, lunch: false })
    // Fredagens lunch är för långt från söndagen: AI:n planerar den.
    expect(days.find((d) => d.date === '2026-11-13')).toMatchObject({ lunch: true, portions: 2 })
    expect(days.find((d) => d.date === '2026-11-09')).toMatchObject({ lunch: false, breakfast: false })
  })

  it('ett nytt storkok tar över, och fler portioner per låda ger större storkok', () => {
    const { boxes, days } = planDays(week, { ...base, lunchWeekdays: [1, 2, 3, 4, 5], batchWeekdays: [7, 3], boxPortions: 2 })
    expect(boxes.map((b) => `${b.date}<${b.from}`)).toEqual(['2026-11-09<2026-11-08', '2026-11-10<2026-11-08', '2026-11-11<2026-11-08', '2026-11-12<2026-11-11', '2026-11-13<2026-11-11'])
    expect(days.find((d) => d.date === '2026-11-08')).toMatchObject({ portions: 8, batchBoxes: 6 })
    expect(days.find((d) => d.date === '2026-11-11')).toMatchObject({ portions: 6, batchBoxes: 4 })
  })

  it('utan lunchdagar blir det inga matlådor', () => {
    const { boxes, days } = planDays(week, { ...base, batchWeekdays: [7] })
    expect(boxes).toEqual([])
    expect(days.every((d) => d.portions === 2 && !d.batchBoxes && !d.lunch && !d.breakfast)).toBe(true)
  })

  it('läser frukost och lunch ur svaret, bara för begärda dagar', () => {
    const text = JSON.stringify({ days: [
      { date: '2026-11-09', title: 'Chili', ingredients: [{ name: 'Bönor', amount: '1 burk' }], breakfast: { title: 'Gröt', minutes: 10, ingredients: [{ name: 'Havregryn', amount: '2 dl' }] }, lunch: { title: 'Ska inte med' } },
      { date: '2026-11-10', title: 'Pasta', ingredients: [{ name: 'Pasta', amount: '200 g' }], lunch: { title: '  ', ingredients: [] } },
    ] })
    const sides = parseSides(text, [{ date: '2026-11-09', slot: 'breakfast' }, { date: '2026-11-10', slot: 'lunch' }], 2)
    expect(sides).toEqual([{ id: '2026-11-09:breakfast', date: '2026-11-09', slot: 'breakfast', title: 'Gröt', portions: 2, minutes: 10, ingredients: [{ name: 'Havregryn', amount: '2 dl' }], updatedAt: '' }])
  })

  it('matlådorna får storkokets rätt, och storkoket får rätt portioner', async () => {
    const dinners = [{ id: '2026-11-08', date: '2026-11-08', title: 'Kycklinggryta', reason: '', portions: 6, minutes: 40, ingredients: [], steps: [], updatedAt: '' }]
    const boxes = boxSides([{ date: '2026-11-09', from: '2026-11-08' }, { date: '2026-11-10', from: '2026-11-07' }], dinners, 1)
    expect(boxes).toEqual([{ id: '2026-11-09:lunch', date: '2026-11-09', slot: 'lunch', title: 'Kycklinggryta', portions: 1, minutes: null, ingredients: [], fromBatch: '2026-11-08', updatedAt: '' }])

    const { days } = planDays(['2026-11-08', '2026-11-09'], { ...base, lunchWeekdays: [1], batchWeekdays: [7], breakfastWeekdays: [1] })
    let sent = ''
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent = String(init.body)
      const content = JSON.stringify({ days: [
        { date: '2026-11-08', title: 'Kycklinggryta', ingredients: [{ name: 'Kyckling', amount: '900 g' }] },
        { date: '2026-11-09', title: 'Pannkakor', ingredients: [{ name: 'Mjöl', amount: '3 dl' }], breakfast: { title: 'Yoghurt med müsli', minutes: 5, ingredients: [{ name: 'Yoghurt', amount: '5 dl' }] } },
      ] })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    }) as typeof fetch
    const r = await fetchMealPlan({ days, pantry: [], food: { allergies: '', portions: 2 }, memories: [], recent: [], today: '2026-11-08' }, 'm', {}, fetchFn)
    expect(r.dinners.map((d) => [d.title, d.portions, d.boxes])).toEqual([['Kycklinggryta', 3, 1], ['Pannkakor', 2, undefined]])
    expect(r.sides.map((x) => x.id)).toEqual(['2026-11-09:breakfast'])
    const user = JSON.parse(JSON.parse(sent).messages[1].content)
    expect(user.days[0]).toMatchObject({ portions: 3, batchBoxes: 1 })
    expect(user.basePortions).toBe(2)
  })
})

describe('variation', () => {
  it('känner igen samma eller nästan samma rätt', () => {
    expect(sameDish('Kycklinggryta med ris', 'kycklinggryta med curry')).toBe(true)
    expect(sameDish('Pasta carbonara', 'Pasta Carbonara!')).toBe(true)
    expect(sameDish('Tacos', 'Fisktacos')).toBe(true)
    expect(sameDish('Pasta carbonara', 'Pasta pesto')).toBe(false)
    expect(sameDish('Kycklingwok', 'Kycklinggryta')).toBe(false)
    expect(repeats(['Tacos', 'Laxpasta', 'Pyttipanna'], ['tacos', 'Pyttipanna med ägg'])).toBe(2)
  })

  it('slumpar tre olika inspirationer', () => {
    const picked = pickInspiration(() => 0)
    expect(picked).toEqual(INSPIRATION.slice(0, 3))
    expect(new Set(pickInspiration()).size).toBe(3)
  })

  it('skickar med de ersatta rätterna, och frågar igen om svaret är för likt', async () => {
    const answers = [['Kycklinggryta med ris', 'Tacos'], ['Thaicurry med räkor', 'Grekisk moussaka']]
    const sent: { replacing: string[]; inspiration: string[] }[] = []
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(JSON.parse(String(init.body)).messages[1].content))
      const titles = answers[sent.length - 1]
      const content = JSON.stringify({ days: ['2026-11-10', '2026-11-11'].map((date, i) => ({ date, title: titles[i], ingredients: [{ name: 'X', amount: '1 st' }] })) })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    }) as typeof fetch
    const days = [dayContext('2026-11-10', food), dayContext('2026-11-11', food)]
    const r = await fetchVariedMealPlan({ days, pantry, food: { allergies: '', portions: 2 }, memories: [], recent: [], replacing: ['Kycklinggryta med curry', 'Tacos'], today: '2026-11-10' }, 'm', {}, fetchFn, () => 0.5)
    expect(sent).toHaveLength(2)
    expect(sent[0].replacing).toEqual(['Kycklinggryta med curry', 'Tacos'])
    expect(sent[0].inspiration).toHaveLength(3)
    expect(sent[1].replacing).toContain('Kycklinggryta med ris')
    expect(r.dinners.map((d) => d.title)).toEqual(['Thaicurry med räkor', 'Grekisk moussaka'])
  })

  it('frågar bara en gång när svaret är nytt', async () => {
    let calls = 0
    const fetchFn = (async () => {
      calls++
      const content = JSON.stringify({ days: [{ date: '2026-11-10', title: 'Fiskgratäng', ingredients: [{ name: 'Torsk', amount: '400 g' }] }] })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    }) as typeof fetch
    await fetchVariedMealPlan({ days: [dayContext('2026-11-10', food)], pantry, food: { allergies: '', portions: 2 }, memories: [], recent: ['Tacos'], replacing: ['Pasta carbonara'], today: '2026-11-10' }, 'm', {}, fetchFn)
    expect(calls).toBe(1)
  })
})
