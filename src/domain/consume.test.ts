import { describe, expect, it } from 'vitest'
import { consumption, formatQty, qty, sameProduct } from './consume'
import type { PantryItem } from './types'

const item = (id: string, name: string, amount?: string): PantryItem => ({ id, name, ...(amount ? { amount } : {}), addedAt: '2026-11-01', source: 'manual', updatedAt: '' })

describe('vad som går åt ur lagret', () => {
  it('tolkar mängder, och bara sådana som går att räkna med', () => {
    expect(qty('400 g')).toEqual({ value: 400, unit: 'g' })
    expect(qty('1,5 kg')).toEqual({ value: 1500, unit: 'g' })
    expect(qty('2 dl')).toEqual({ value: 200, unit: 'ml' })
    expect(qty('1/2 dl')).toEqual({ value: 50, unit: 'ml' })
    expect(qty('1 1/2 dl')).toEqual({ value: 150, unit: 'ml' })
    expect(qty('½ l')).toEqual({ value: 500, unit: 'ml' })
    expect(qty('3')).toEqual({ value: 3, unit: 'st' })
    expect(qty('ca 2 st')).toEqual({ value: 2, unit: 'st' })
    for (const odd of ['2 klyftor', '1 burk', 'halv förpackning', '', undefined, '1 bit']) expect(qty(odd)).toBeNull()
    expect([formatQty(1500, 'g'), formatQty(250, 'ml'), formatQty(1200, 'ml'), formatQty(40, 'ml'), formatQty(2, 'st')]).toEqual(['1,5 kg', '2,5 dl', '1,2 l', '40 ml', '2 st'])
  })
  it('känner igen samma vara men inte en annan med liknande namn', () => {
    for (const [a, b] of [['potatis, gärna fast', 'Potatis'], ['gul lök', 'Lök'], ['tomater', 'Tomat'], ['ägg', 'Ägg'], ['riven ost', 'Ost'], ['mjölk', 'Mellanmjölk'], ['matlagningsgrädde', 'Grädde'], ['kycklingfilé', 'Kyckling'], ['paprikor', 'Paprika'], ['morötter', 'Morot']])
      expect([a, b, sameProduct(a, b)]).toEqual([a, b, true])
    for (const [a, b] of [['lök', 'Vitlök'], ['mjölk', 'Kokosmjölk'], ['tomater', 'Krossade tomater'], ['pasta', 'Pastasås'], ['tomat', 'Tomatpuré'], ['smör', 'Jordnötssmör'], ['kyckling', 'Kycklingbuljong'], ['ris', 'Risoni'], ['gul lök', 'Rödlök']])
      expect([a, b, sameProduct(a, b)]).toEqual([a, b, false])
  })
  it('minskar mängden, tar bort det som tar slut och låter användaren avgöra resten', () => {
    const pantry = [item('k', 'Kycklingfilé', '600 g'), item('g', 'Grädde', '2 dl'), item('l', 'Lök', '3 st'), item('r', 'Ris', '1 kg'), item('v', 'Vitlök', '1 st'), item('s', 'Smör')]
    const used = consumption(
      [{ name: 'kycklingfilé', amount: '400 g' }, { name: 'matlagningsgrädde', amount: '2 dl' }, { name: 'gul lök', amount: '1 st' }, { name: 'lök, hackad', amount: '1 st' }, { name: 'ris', amount: '3 dl' }, { name: 'vitlök', amount: '2 klyftor' }, { name: 'smör', amount: '1 msk' }, { name: 'curry', amount: '1 msk' }],
      pantry,
    )
    expect(used.map((u) => [u.item.name, u.need, u.kind, u.left])).toEqual([
      ['Kycklingfilé', '400 g', 'reduce', '200 g'],
      ['Grädde', '2 dl', 'remove', undefined],
      ['Lök', '1 st + 1 st', 'reduce', '1 st'],
      ['Ris', '3 dl', 'unknown', undefined],
      ['Vitlök', '2 klyftor', 'unknown', undefined],
      ['Smör', '1 msk', 'unknown', undefined],
    ])
    expect(consumption([{ name: 'lax', amount: '400 g' }], pantry)).toEqual([])
  })
})
