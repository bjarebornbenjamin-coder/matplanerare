import { describe, expect, it } from 'vitest'
import { BOX_DAYS, INSPIRATION, LUNCH_PROMPT, MEAL_PLAN_PROMPT, parseLunches, swapDinner, swapSide, boxSides, fetchVariedMealPlan, pickInspiration, repeats, sameDish, dayContext, fetchMealPlan, mealPlanUserContent, parseSides, planDays, missingForPlan, parseMealPlan, planStart } from './mealPlan'
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

  it('tar bara begärda datum, ett per dag; ingredienser behövs inte (de kommer från receptet)', () => {
    const text = JSON.stringify({
      days: [
        { date: '2026-11-10', title: 'Pasta carbonara', ingredients: [{ name: 'Pasta', amount: '200 g' }], steps: ['Koka'] },
        { date: '2026-11-10', title: 'Dubblett', ingredients: [{ name: 'X', amount: '1 st' }], steps: ['Y'] },
        { date: '2026-12-01', title: 'Fel datum', ingredients: [{ name: 'X', amount: '1 st' }], steps: ['Y'] },
        { date: '2026-11-11', title: 'Tom', ingredients: [] },
      ],
    })
    const plan = parseMealPlan(text, ['2026-11-10', '2026-11-11'], 2)
    expect(plan.map((d) => d.title)).toEqual(['Pasta carbonara', 'Tom'])
    expect(plan[1]).toMatchObject({ ingredients: [], steps: [] })
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

  it('reserven utan AI rensar namnen och slår ihop samma vara', () => {
    const plan = [
      dinner('2026-11-10', 'Laxsoppa', [{ name: 'frysta franska örter', amount: '3 g' }, { name: 'potatis', amount: '400 g' }]),
      dinner('2026-11-11', 'Pyttipanna', [{ name: 'Potatis, gärna fast', amount: '600 g' }, { name: 'franska örter', amount: '1 tsk' }]),
    ]
    expect(missingForPlan(plan, [])).toEqual([
      { name: 'Franska örter', note: 'Veckomeny: Laxsoppa, Pyttipanna' },
      { name: 'Potatis', amount: '1 kg', note: 'Veckomeny: Laxsoppa, Pyttipanna' },
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

describe('tumme upp och ner', () => {
  it('skickas med, och ogillade rätter räknas som upprepningar', async () => {
    const sent: Record<string, unknown>[] = []
    const answers = [['Fisksoppa', 'Lasagne'], ['Thaicurry', 'Lasagne']]
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(JSON.parse(String(init.body)).messages[1].content))
      const content = JSON.stringify({ days: ['2026-11-10', '2026-11-11'].map((date, i) => ({ date, title: answers[sent.length - 1][i] })) })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
    }) as typeof fetch
    const days = [dayContext('2026-11-10', food), dayContext('2026-11-11', food)]
    const r = await fetchVariedMealPlan({ days, pantry, food: { allergies: '', portions: 2 }, memories: [], recent: ['Lasagne'], disliked: ['Fisksoppa'], liked: ['Tacos'], today: '2026-11-10' }, 'm', {}, fetchFn)
    expect(sent[0]).toMatchObject({ liked: ['Tacos'], disliked: ['Fisksoppa'] })
    expect(sent).toHaveLength(2)
    expect(r.dinners.map((d) => d.title)).toEqual(['Thaicurry', 'Lasagne'])
    expect(MEAL_PLAN_PROMPT).toMatch(/disliked/)
  })
})

describe('lunchen ska vara en riktig lunch', () => {
  const days = ['2026-11-14', '2026-11-15', '2026-11-16'].map((d) => ({ ...dayContext(d, food), lunch: true }))
  const input = { days, pantry, food: { allergies: 'Vegetariskt', portions: 2 }, memories: ['Gillar stark mat'], recent: [], today: '2026-11-14' }
  const plan = (lunches: string[]) => JSON.stringify({ days: days.map((d, i) => ({ date: d.date, title: ['Lasagne', 'Fiskgratäng', 'Tacos'][i], minutes: 40, lunch: { title: lunches[i], minutes: 15 } })) })
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

  it('instruktionen säger vad en lunch är och vad den inte får vara', () => {
    expect(MEAL_PLAN_PROMPT).toMatch(/RIKTIG lunch som man blir mätt på/)
    expect(MEAL_PLAN_PROMPT).toMatch(/ALDRIG smoothie, fruktsallad/)
    expect(MEAL_PLAN_PROMPT).not.toMatch(/enkel, snabb lunch/)
    expect(LUNCH_PROMPT).toMatch(/ALDRIG smoothie, fruktsallad/)
  })

  it('smoothie och fruktsallad byts mot riktiga luncher, och bara för de dagarna', async () => {
    const sent: { system: string; user: Record<string, unknown> }[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const m = JSON.parse(String(init.body)).messages
      sent.push({ system: m[0].content, user: JSON.parse(m[1].content) })
      if (m[0].content === MEAL_PLAN_PROMPT) return reply(plan(['Fruktsallad med mango och ananas', 'Linssoppa med bröd', 'Green smoothie med kiwi och spenat']))
      return reply(JSON.stringify({ lunches: [{ date: '2026-11-14', title: 'Halloumisallad', minutes: 20 }, { date: '2026-11-16', title: 'Omelett med ost', minutes: 10 }, { date: '2026-11-15', title: 'Ska inte användas', minutes: 5 }] }))
    }) as typeof fetch
    const r = await fetchVariedMealPlan(input, 'm', {}, fetchFn)
    expect(r.sides.map((x) => [x.date, x.title, x.minutes])).toEqual([['2026-11-14', 'Halloumisallad', 20], ['2026-11-15', 'Linssoppa med bröd', 15], ['2026-11-16', 'Omelett med ost', 10]])
    expect(sent).toHaveLength(2)
    expect(sent[1].system).toBe(LUNCH_PROMPT)
    expect(sent[1].user).toMatchObject({ dates: ['2026-11-14', '2026-11-16'], allergies: 'Vegetariskt', preferences: ['Gillar stark mat'] })
    expect(sent[1].user.avoid).toEqual(expect.arrayContaining(['Lasagne', 'Linssoppa med bröd', 'Green smoothie med kiwi och spenat']))
  })

  it('är alla luncher riktiga ställs ingen extra fråga', async () => {
    let calls = 0
    const fetchFn = (async () => { calls++; return reply(plan(['Kycklingsallad', 'Tomatsoppa', 'Wrap med bönor'])) }) as typeof fetch
    const r = await fetchVariedMealPlan(input, 'm', {}, fetchFn)
    expect(calls).toBe(1)
    expect(r.sides.map((x) => x.title)).toEqual(['Kycklingsallad', 'Tomatsoppa', 'Wrap med bönor'])
  })

  it('kommer ingen riktig lunch andra gången heller tas lunchen bort den dagen', async () => {
    const again = (async (_u: string, init: RequestInit) => {
      const system = JSON.parse(String(init.body)).messages[0].content
      return system === MEAL_PLAN_PROMPT ? reply(plan(['Smoothie bowl', 'Pastasallad', 'Yoghurt med granola'])) : reply(JSON.stringify({ lunches: [{ date: '2026-11-14', title: 'Bärsmoothie' }, { date: '2026-11-16', title: 'Räkmacka', minutes: 10 }] }))
    }) as typeof fetch
    expect((await fetchVariedMealPlan(input, 'm', {}, again)).sides.map((x) => x.title)).toEqual(['Pastasallad', 'Räkmacka'])
    const down = (async (_u: string, init: RequestInit) => (JSON.parse(String(init.body)).messages[0].content === MEAL_PLAN_PROMPT ? reply(plan(['Smoothie bowl', 'Pastasallad', 'Kycklingwrap'])) : new Response('', { status: 504 }))) as typeof fetch
    const r = await fetchVariedMealPlan(input, 'm', {}, down)
    expect(r.sides.map((x) => x.title)).toEqual(['Pastasallad', 'Kycklingwrap'])
    expect(r.dinners).toHaveLength(3) // middagarna påverkas inte
  })

  it('svaret med nya luncher läses säkert', () => {
    const dates = ['2026-11-14', '2026-11-15']
    expect(parseLunches(JSON.stringify({ lunches: [{ date: '2026-11-14', title: ' Tonfisksallad ', minutes: 15 }, { date: '2026-11-14', title: 'Dubblett' }, { date: '2026-12-01', title: 'Fel datum' }, { date: '2026-11-15', title: 'Fruktsallad' }, null] }), dates)).toEqual([{ date: '2026-11-14', title: 'Tonfisksallad', minutes: 15 }])
    expect(parseLunches('inte json', dates)).toEqual([])
    expect(parseLunches('{}', dates)).toEqual([])
  })

  it('frukost och middag berörs inte av lunchkontrollen', async () => {
    const both = [{ ...dayContext('2026-11-14', food), lunch: true, breakfast: true }]
    const fetchFn = (async () => reply(JSON.stringify({ days: [{ date: '2026-11-14', title: 'Lasagne', lunch: { title: 'Kycklingsallad', minutes: 15 }, breakfast: { title: 'Smoothie bowl med hallon', minutes: 5 } }] }))) as typeof fetch
    const r = await fetchVariedMealPlan({ ...input, days: both }, 'm', {}, fetchFn)
    expect(r.sides.map((x) => [x.slot, x.title])).toEqual([['breakfast', 'Smoothie bowl med hallon'], ['lunch', 'Kycklingsallad']])
  })
})

describe('byta en enskild rätt', () => {
  const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 })
  const input = { pantry, food: { allergies: 'Vegetariskt', portions: 2, weekWishes: 'fredag något lyxigt' }, memories: ['Gillar stark mat'], recent: ['Lasagne', 'Tacos'], replacing: ['Kycklinggryta med curry'], today: '2026-11-14', disliked: ['Fisksoppa'] }
  const day = { ...dayContext('2026-11-15', food), portions: 6, batchBoxes: 4 }

  it('middagen byts för just den dagen, med samma portioner och matlådor, utan frukost och lunch', async () => {
    const sent: Record<string, unknown>[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(JSON.parse(String(init.body)).messages[1].content))
      return reply({ days: [{ date: '2026-11-15', title: 'Linsgryta med kokosmjölk', reason: 'Storkok till matlådor', minutes: 40, lunch: { title: 'Ska inte användas' } }] })
    }) as typeof fetch
    const next = await swapDinner(day, input, 'm', {}, fetchFn, () => 0.5)
    expect(next).toMatchObject({ id: '2026-11-15', date: '2026-11-15', title: 'Linsgryta med kokosmjölk', portions: 6, boxes: 4 })
    expect(sent).toHaveLength(1)
    expect(sent[0].days).toHaveLength(1)
    expect((sent[0].days as Record<string, unknown>[])[0]).toMatchObject({ date: '2026-11-15', breakfast: false, lunch: false, portions: 6, batchBoxes: 4 })
    expect(sent[0]).toMatchObject({ replacing: ['Kycklinggryta med curry'], allergies: 'Vegetariskt', wishes: 'fredag något lyxigt' })
    expect(JSON.stringify(sent[0])).toMatch(/Lasagne/) // veckans övriga rätter ska undvikas
  })

  it('föreslår AI:n samma rätt igen frågas en gång till, och blir det ändå samma byts inget', async () => {
    let calls = 0
    const same = (async () => { calls++; return reply({ days: [{ date: '2026-11-15', title: 'Kycklinggryta med curry och ris' }] }) }) as typeof fetch
    expect(await swapDinner(day, input, 'm', {}, same)).toBeNull()
    expect(calls).toBe(2)
    const second = (async () => reply({ days: [{ date: '2026-11-15', title: ++calls === 3 ? 'Kycklinggryta med curry' : 'Halloumiburgare' }] })) as typeof fetch
    expect((await swapDinner(day, input, 'm', {}, second))?.title).toBe('Halloumiburgare')
  })

  it('lunchen byts mot en riktig lunch som inte redan finns i veckan', async () => {
    const sent: { system: string; user: Record<string, unknown> }[] = []
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const m = JSON.parse(String(init.body)).messages
      sent.push({ system: m[0].content, user: JSON.parse(m[1].content) })
      return reply({ lunches: [{ date: '2026-11-15', title: 'Halloumisallad', minutes: 15 }] })
    }) as typeof fetch
    expect(await swapSide('lunch', day, { ...input, replacing: ['Pastasallad'] }, 'm', {}, fetchFn)).toEqual({ title: 'Halloumisallad', minutes: 15 })
    expect(sent[0].system).toBe(LUNCH_PROMPT)
    expect(sent[0].user).toMatchObject({ dates: ['2026-11-15'], allergies: 'Vegetariskt' })
    expect(sent[0].user.avoid).toEqual(expect.arrayContaining(['Pastasallad', 'Lasagne', 'Fisksoppa']))
    // En smoothie eller samma lunch igen godtas inte.
    const smoothie = (async () => reply({ lunches: [{ date: '2026-11-15', title: 'Grön smoothie' }] })) as typeof fetch
    expect(await swapSide('lunch', day, { ...input, replacing: ['Pastasallad'] }, 'm', {}, smoothie)).toBeNull()
    const again = (async () => reply({ lunches: [{ date: '2026-11-15', title: 'Pastasallad med pesto' }] })) as typeof fetch
    expect(await swapSide('lunch', day, { ...input, replacing: ['Pastasallad'] }, 'm', {}, again)).toBeNull()
  })

  it('frukosten byts mot en ny frukost', async () => {
    let asked: Record<string, unknown> = {}
    const fetchFn = (async (_u: string, init: RequestInit) => {
      asked = JSON.parse(JSON.parse(String(init.body)).messages[1].content)
      return reply({ days: [{ date: '2026-11-15', title: 'Lasagne', breakfast: { title: 'Äggmuffins med spenat', minutes: 20 } }] })
    }) as typeof fetch
    expect(await swapSide('breakfast', day, { ...input, replacing: ['Overnight oats med blåbär'] }, 'm', {}, fetchFn)).toEqual({ title: 'Äggmuffins med spenat', minutes: 20 })
    expect((asked.days as Record<string, unknown>[])[0]).toMatchObject({ breakfast: true, lunch: false })
    const none = (async () => reply({ days: [{ date: '2026-11-15', title: 'Lasagne' }] })) as typeof fetch
    expect(await swapSide('breakfast', day, input, 'm', {}, none)).toBeNull()
  })
})

