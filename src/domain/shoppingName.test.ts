import { describe, expect, it } from 'vitest'
import { cleanName, shoppingAmount, tidyAmount, unitFromName } from './shoppingName'

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
  it('mått först i namnet flyttas till mängden', () => {
    expect(unitFromName('ask ärtskott', '0,5')).toEqual({ name: 'ärtskott', amount: '0,5 ask' })
    expect(unitFromName('Cm gurka', '12 st')).toEqual({ name: 'gurka', amount: '12 cm' })
    expect(unitFromName('kruka basilika', '1/2')).toEqual({ name: 'basilika', amount: '1/2 kruka' })
    expect(unitFromName('Burk kokosmjölk')).toEqual({ name: 'kokosmjölk', amount: '1 burk' })
    expect(unitFromName('pkt bacon', '200 g')).toEqual({ name: 'bacon', amount: '200 g' }) // mängden har redan en enhet
    // Vanliga namn rörs inte, inte heller de som bara börjar likadant.
    expect(unitFromName('Askgratinerad lax', '1')).toEqual({ name: 'Askgratinerad lax', amount: '1' })
    expect(unitFromName('Burkmajs', '1 st')).toEqual({ name: 'Burkmajs', amount: '1 st' })
    expect(unitFromName('Paket')).toEqual({ name: 'Paket' })
    expect(unitFromName('Gurka', '1 st')).toEqual({ name: 'Gurka', amount: '1 st' })
  })
  it('storlek hör inte till namnet, och "à 400 g" är inte en vara', () => {
    expect(cleanName('liten gul lök')).toBe('Gul lök')
    expect(cleanName('stora champinjoner')).toBe('Champinjoner')
    expect(cleanName('à 400 g krossade tomater')).toBe('Krossade tomater')
    expect(shoppingAmount('4 skivor')).toBeUndefined()
    expect(shoppingAmount('1 näve')).toBeUndefined()
    expect(shoppingAmount('2 burkar')).toBe('2 burkar')
  })
})
