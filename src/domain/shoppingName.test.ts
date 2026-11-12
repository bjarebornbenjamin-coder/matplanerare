import { describe, expect, it } from 'vitest'
import { cleanName, shoppingAmount, tidyAmount } from './shoppingName'

describe('namn på inköpslistan', () => {
  it('tar bort tillstånd, tillagning och tillägg', () => {
    expect(cleanName('frysta franska örter')).toBe('Franska örter')
    expect(cleanName('potatis, gärna fast')).toBe('Potatis')
    expect(cleanName('gul lök (ca 2 st)')).toBe('Gul lök')
    expect(cleanName('färsk koriander, hackad')).toBe('Koriander')
    expect(cleanName('smält smör')).toBe('Smör')
    expect(cleanName('svartpeppar efter smak')).toBe('Svartpeppar')
    expect(cleanName('riven parmesanost')).toBe('Parmesanost')
    expect(cleanName('Krossade tomater')).toBe('Krossade tomater')
    expect(cleanName('Kycklingfilé')).toBe('Kycklingfilé')
    expect(cleanName('frysta franska örter 3 g')).toBe('Franska örter')
    expect(cleanName('2 dl grädde')).toBe('Grädde')
    expect(cleanName('Ägg 12 st')).toBe('Ägg')
    expect(cleanName('Vetemjöl special')).toBe('Vetemjöl special')
  })
  it('små mängder blir en förpackning utan mängd', () => {
    expect(shoppingAmount('3 g')).toBeUndefined()
    expect(shoppingAmount('1 krm')).toBeUndefined()
    expect(shoppingAmount('2 tsk')).toBeUndefined()
    expect(shoppingAmount('1 msk')).toBeUndefined()
    expect(shoppingAmount('500 g')).toBe('500 g')
    expect(shoppingAmount('2 dl')).toBe('2 dl')
    expect(shoppingAmount('')).toBeUndefined()
  })
  it('vaga mängder som "1 bit" tas bort, riktiga enheter behålls', () => {
    for (const vague of ['1 bit', '2 bitar', 'en bit', 'lite', 'en del', 'några']) expect([vague, tidyAmount(vague)]).toEqual([vague, ''])
    for (const ok of ['500 g', '1 l', '2 st', 'halv förpackning', '1 paket (5 dl)', '']) expect(tidyAmount(ok)).toBe(ok)
    expect(shoppingAmount('1 bit')).toBeUndefined()
  })
})
