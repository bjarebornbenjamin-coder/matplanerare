import { describe, expect, it } from 'vitest'
import { SHOPPING_PROMPT, parseShopping, planShopping, shoppingUserContent } from './shoppingPlan'

const current = [{ name: 'Tandkräm' }, { name: 'potatis', amount: '1 kg' }, { name: 'Potatis' }]

describe('inköpslista med AI', () => {
  it('skickar veckans ingredienser per rätt, lagret och listan, och ber om köpbara mängder', async () => {
    let sent: { messages: { content: string }[]; response_format: unknown } | null = null
    const fetchFn = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
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
    expect(JSON.parse(shoppingUserContent({ needs: [], pantry: [], current: [] }))).toEqual({ needs: [], pantry: [], current: [] })
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
})
