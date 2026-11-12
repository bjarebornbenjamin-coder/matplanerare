import { describe, expect, it } from 'vitest'
import { DEDUPE_PROMPT, SHOPPING_PROMPT, parseGroups, parseShopping, planShopping, removeDuplicates, shoppingUserContent } from './shoppingPlan'

const current = [{ name: 'Tandkräm' }, { name: 'potatis', amount: '1 kg' }, { name: 'Potatis' }]

describe('inköpslista med AI', () => {
  it('skickar veckans ingredienser per rätt, lagret och listan, och ber om köpbara mängder', async () => {
    let sent: { messages: { content: string }[]; response_format: unknown } | null = null
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent ??= JSON.parse(String(init.body)) // första anropet är genomgången, det andra kontrollfrågan
      const content = JSON.stringify({ items: [{ name: 'Potatis', amount: '2 kg', note: 'Pyttipanna, Ugnslax' }, { name: 'Franska örter', amount: '', note: 'Laxsoppa' }, { name: 'Tandkräm', amount: '', note: '' }] })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    }) as unknown as typeof fetch
    const needs = [{ name: 'potatis', amount: '800 g', dish: 'Pyttipanna' }, { name: 'potatis, fast', amount: '600 g', dish: 'Ugnslax' }, { name: 'frysta franska örter', amount: '3 g', dish: 'Laxsoppa' }]
    const lines = await planShopping({ needs, pantry: [{ id: 'p', name: 'Potatis', amount: '500 g', addedAt: '2026-11-01', source: 'manual', updatedAt: '' }], current }, 'gpt-4o-mini', {}, fetchFn)
    expect(lines).toEqual([{ name: 'Potatis', amount: '2 kg', note: 'Pyttipanna, Ugnslax' }, { name: 'Franska örter', note: 'Laxsoppa' }, { name: 'Tandkräm' }])
    const user = JSON.parse(sent!.messages[1].content)
    expect(user.needs).toHaveLength(3)
    expect(user.pantry).toEqual([{ name: 'Potatis', amount: '500 g' }])
    expect(user.current).toHaveLength(3)
    expect(sent!.response_format).toEqual({ type: 'json_object' })
    expect(SHOPPING_PROMPT).toMatch(/Avrunda uppåt/)
    expect(SHOPPING_PROMPT).toMatch(/ta aldrig bort något/)
  })
  it('slår ihop dubbletter och lägger tillbaka egna varor som AI:n tappat', () => {
    const text = JSON.stringify({ items: [{ name: 'frysta franska örter 3 g' }, { name: 'Potatis', amount: '2 kg' }, { name: 'potatis', amount: '1 kg' }] })
    const lines = parseShopping(text, current)
    expect(lines.map((l) => l.name)).toEqual(['Franska örter', 'Potatis', 'Tandkräm'])
  })
  it('ogiltigt svar ger ett begripligt fel', () => {
    expect(() => parseShopping('inte json', [])).toThrow(/tolka/)
    expect(() => parseShopping('{"x":1}', [])).toThrow(/ingen inköpslista/)
    expect(JSON.parse(shoppingUserContent({ needs: [], pantry: [], current: [] }))).toEqual({ needs: [], pantry: [], sameAs: [], current: [] })
    expect(JSON.parse(shoppingUserContent({ needs: [], pantry: [], current: [], aliases: { bladspenat: 'Spenat' } })).sameAs).toEqual(['bladspenat = Spenat'])
  })
  it('tar med avdelningen från AI:n, men bara om den är en av butikens', () => {
    const text = JSON.stringify({ items: [{ name: 'Rödlök', amount: '5 st', note: 'Chili sin carne', section: 'Frukt & grönt' }, { name: 'Gurka', section: 'Hittepå' }] })
    expect(parseShopping(text, [])).toEqual([{ name: 'Rödlök', amount: '5 st', note: 'Chili sin carne', section: 'Frukt & grönt' }, { name: 'Gurka' }])
    expect(SHOPPING_PROMPT).toMatch(/"Röda lökar" och "Rödlök"/)
    expect(SHOPPING_PROMPT).toMatch(/sats/)
    expect(SHOPPING_PROMPT).toMatch(/section/)
  })
  it('räknar inte en vara dubbelt när AI:n slagit ihop den under ett annat namn', () => {
    const before = [{ name: 'Röda lökar', amount: '4 st', note: 'Chili sin carne' }, { name: 'Rödlök', amount: '0,5 st', note: 'Tzatziki' }, { name: 'Sats gurka med chili', note: 'Tzatziki' }, { name: 'Tandkräm' }]
    const text = JSON.stringify({ items: [{ name: 'Rödlök', amount: '5 st', note: 'Chili sin carne, Tzatziki' }, { name: 'Gurka', note: 'Tzatziki' }, { name: 'Chili', note: 'Tzatziki' }] })
    expect(parseShopping(text, before)).toEqual([
      { name: 'Rödlök', amount: '5 st', note: 'Chili sin carne, Tzatziki' },
      { name: 'Gurka', note: 'Tzatziki' },
      { name: 'Chili', note: 'Tzatziki' },
      { name: 'Tandkräm' }, // egen vara som AI:n tappade: läggs tillbaka
    ])
  })
  it('kontrollfrågan: AI:n pekar ut rader som är samma vara, och appen slår ihop dem', async () => {
    const lines = [{ name: 'Ätmogna bananer', amount: '3 st', note: 'Smoothie' }, { name: 'Spenat', amount: '100 g', note: 'Äggmuffins' }, { name: 'Bananer', amount: '2 st', note: 'Pannkakor' }, { name: 'Bladspenat', amount: '65 g', note: 'Laxpasta' }, { name: 'Mjölk', amount: '1 l' }]
    let asked = ''
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      asked = body.messages[1].content
      expect(body.messages[0].content).toBe(DEDUPE_PROMPT)
      const content = JSON.stringify({ groups: [{ rows: [1, 3], name: 'Bananer' }, { rows: [2, 4], name: 'Spenat' }] })
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    }) as unknown as typeof fetch
    expect(await removeDuplicates(lines, 'm', {}, fetchFn)).toEqual([
      { name: 'Bananer', amount: '5 st', note: 'Smoothie, Pannkakor' },
      { name: 'Spenat', amount: '165 g', note: 'Äggmuffins, Laxpasta' },
      { name: 'Mjölk', amount: '1 l' },
    ])
    expect(asked).toBe('1. Ätmogna bananer\n2. Spenat\n3. Bananer\n4. Bladspenat\n5. Mjölk')
    expect(DEDUPE_PROMPT).toMatch(/ätmogna bananer/)
    expect(DEDUPE_PROMPT).toMatch(/bladspenat/)
  })
  it('kontrollfrågan tål konstiga svar och fel: då lämnas listan som den är', async () => {
    expect(parseGroups('{"groups":[{"rows":[1],"name":"X"},{"rows":[2,"3",4]},{"rows":[5,6],"name":"hackad lök"}]}')).toEqual([{ rows: [1, 3] }, { rows: [4, 5], name: 'Lök' }])
    expect(parseGroups('inte json')).toEqual([])
    const lines = [{ name: 'A' }, { name: 'B' }]
    const down = (async () => new Response('', { status: 504 })) as unknown as typeof fetch
    expect(await removeDuplicates(lines, 'm', {}, down)).toBe(lines)
    const odd = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"groups":[{"rows":[1,99]},{"rows":[1,2]},{"rows":[2,1]}]}' } }] }))) as unknown as typeof fetch
    expect(await removeDuplicates(lines, 'm', {}, odd)).toEqual([{ name: 'A' }])
  })
  it('rader som får samma namn efter rensningen läggs ihop, inte bort', () => {
    const text = JSON.stringify({ items: [{ name: 'Ätmogna bananer', amount: '3 st', note: 'Smoothie' }, { name: 'Bananer', amount: '2 st', note: 'Pannkakor' }, { name: 'hackad lök', amount: '1 st', note: 'Soppa' }, { name: 'Lök', amount: '2 st', note: 'Gryta' }] })
    expect(parseShopping(text, [])).toEqual([
      { name: 'Bananer', amount: '5 st', note: 'Smoothie, Pannkakor' },
      { name: 'Lök', amount: '3 st', note: 'Soppa, Gryta' },
    ])
  })
})
