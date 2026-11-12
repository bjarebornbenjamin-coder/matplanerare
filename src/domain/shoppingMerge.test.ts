import { describe, expect, it } from 'vitest'
import { sameShoppingItem } from './consume'
import { addAmounts, mergeRows, mergeShopping } from './shoppingMerge'

describe('ihopslagning av inköpslistan', () => {
  it('lök på tre ställen blir en rad', () => {
    const r = mergeShopping([
      { name: 'gul lök', amount: '1', note: 'Veckomeny: Morotssoppa med naanbröd' },
      { name: 'gul paprika', amount: '1', note: 'Tomat- och örtbräserad kyckling' },
      { name: 'hackad gul lök', amount: '1 1/2 dl', note: 'Tomat- och örtbräserad kyckling' },
      { name: 'hackad koriander', amount: '1/2 kruka', note: 'Veckomeny: Morots- och ingefärssoppa med jordnötshack' },
      { name: 'Lök', amount: '2 st', note: 'Veckomeny: Morotsoppa med bröd, Köttfärssås med spaghetti' },
      { name: 'Tandkräm' },
    ])
    expect(r.merged).toBe(2)
    expect(r.changed).toBe(true)
    expect(r.lines).toEqual([
      { name: 'Gul lök', amount: '3 st + 1,5 dl', note: 'Morotssoppa med naanbröd, Tomat- och örtbräserad kyckling, Morotsoppa med bröd, Köttfärssås med spaghetti' },
      { name: 'Gul paprika', amount: '1 st', note: 'Tomat- och örtbräserad kyckling' },
      { name: 'Koriander', amount: '1/2 kruka', note: 'Morots- och ingefärssoppa med jordnötshack' },
      { name: 'Tandkräm' },
    ])
  })
  it('rör inte en lista som redan är ren, och inte egna varor', () => {
    const clean = [{ name: 'Gul lök', amount: '3 st', note: 'Pyttipanna' }, { name: 'hackad persilja' }, { name: 'Mjölk', amount: '1 l' }]
    const r = mergeShopping(clean)
    expect(r).toMatchObject({ merged: 0, changed: false })
    expect(r.lines).toEqual(clean)
  })
  it('olika varor hålls isär', () => {
    for (const [a, b] of [['Lök', 'Rödlök'], ['Lök', 'Vitlök'], ['Vispgrädde', 'Matlagningsgrädde'], ['Gul paprika', 'Röd paprika'], ['Tomater', 'Krossade tomater'], ['Mjölk', 'Kokosmjölk']])
      expect([a, b, sameShoppingItem(a, b)]).toEqual([a, b, false])
    for (const [a, b] of [['gul lök', 'Lök'], ['hackad gul lök', 'lök'], ['Tomater', 'tomat'], ['Morötter', 'morot'], ['riven ost', 'Ost'], ['Röda lökar', 'Rödlök'], ['röd lök', 'Rödlök'], ['vitlöksklyftor', 'Vitlök']])
      expect([a, b, sameShoppingItem(a, b)]).toEqual([a, b, true])
  })
  it('lägger ihop mängder i samma enhet', () => {
    expect(addAmounts(['200 g', '300 g', '1 kg'])).toBe('1,5 kg')
    expect(addAmounts(['2 dl', '3 dl'])).toBe('5 dl')
    expect(addAmounts(['1', '2 st', undefined])).toBe('3 st')
    expect(addAmounts(['1 burk', '1 burk', '400 g'])).toBe('400 g + 1 burk')
    expect(addAmounts(['1 bit', ''])).toBeUndefined()
  })
  it('avdelningen från AI:n följer med vid ihopslagning', () => {
    const r = mergeShopping([{ name: 'Röda lökar', amount: '4 st', note: 'Chili sin carne', section: 'Frukt & grönt' }, { name: 'Rödlök', amount: '0,5 st', note: 'Tzatziki' }])
    expect(r.lines).toEqual([{ name: 'Rödlök', amount: '4,5 st', note: 'Chili sin carne, Tzatziki', section: 'Frukt & grönt' }])
  })
  it('reserven utan AI känner igen ätmogna bananer och bladspenat', () => {
    const r = mergeShopping([{ name: 'ätmogna bananer', amount: '3 st', note: 'Smoothie' }, { name: 'Bananer', amount: '2 st', note: 'Pannkakor' }, { name: 'Bladspenat', amount: '65 g', note: 'Laxpasta' }, { name: 'spenat', amount: '100 g', note: 'Äggmuffins' }])
    expect(r.lines.map((l) => [l.name, l.amount])).toEqual([['Bananer', '5 st'], ['Bladspenat', '165 g']])
  })
  it('par som användaren slagit ihop följs sedan av sig själva', () => {
    const items = [{ name: 'Crème fraiche', amount: '2 dl', note: 'Gryta' }, { name: 'Fraiche', amount: '1 dl', note: 'Sås' }, { name: 'Gurka' }]
    expect(mergeShopping(items).merged).toBe(0)
    const r = mergeShopping(items, { fraiche: 'Crème fraiche' })
    expect(r.lines).toEqual([{ name: 'Crème fraiche', amount: '3 dl', note: 'Gryta, Sås' }, { name: 'Gurka' }])
    expect(sameShoppingItem('fraiche', 'crème fraiche', { fraiche: 'Crème fraiche' })).toBe(true)
  })
  it('slår ihop utpekade rader och väljer det kortaste namnet om inget anges', () => {
    const lines = [{ name: 'Ätmogna bananer', amount: '3 st' }, { name: 'Mjölk' }, { name: 'Bananer', amount: '2 st', section: 'Frukt & grönt' }]
    expect(mergeRows(lines, [{ rows: [0, 2] }])).toEqual([{ name: 'Bananer', amount: '5 st', section: 'Frukt & grönt' }, { name: 'Mjölk' }])
    expect(mergeRows(lines, [{ rows: [0] }, { rows: [1, 7] }])).toEqual(lines)
  })
})
