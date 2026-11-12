import { describe, expect, it } from 'vitest'
import { needsTidy } from './shoppingTidy'

describe('när AI:n ska gå igenom inköpslistan', () => {
  const known = new Set(['rödlök|5 st', 'gurka|', 'mjölk|1 l'])
  it('när något har tillkommit sedan sist', () => {
    expect(needsTidy([{ name: 'Rödlök', amount: '5 st' }, { name: 'Gurka' }, { name: 'Röda lökar', amount: '4 st' }], known)).toBe(true)
    expect(needsTidy([{ name: 'Rödlök', amount: '6 st' }, { name: 'Gurka' }], known)).toBe(true) // ändrad mängd
  })
  it('inte när listan är oförändrad eller bara har blivit kortare', () => {
    expect(needsTidy([{ name: 'Rödlök', amount: '5 st' }, { name: 'Gurka' }, { name: 'Mjölk', amount: '1 l' }], known)).toBe(false)
    expect(needsTidy([{ name: 'rödlök', amount: '5 ST' }, { name: 'Gurka' }], known)).toBe(false) // avbockat eller borttaget
  })
  it('inte för en lista med färre än två varor', () => {
    expect(needsTidy([{ name: 'Ny vara' }], known)).toBe(false)
    expect(needsTidy([], known)).toBe(false)
  })
})
