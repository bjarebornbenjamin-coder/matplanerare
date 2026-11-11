import { describe, expect, it } from 'vitest'
import { emojiFor, guessPlace, placeOf } from './storage'

describe('förvaring', () => {
  it('gissar kyl, frys eller skafferi från namnet', () => {
    expect(guessPlace('Mjölk')).toBe('fridge')
    expect(guessPlace('Kycklingfilé')).toBe('fridge')
    expect(guessPlace('Frysta ärtor')).toBe('freezer')
    expect(guessPlace('Vaniljglass')).toBe('freezer')
    expect(guessPlace('Krossade tomater')).toBe('pantry')
    expect(guessPlace('Tomatpuré')).toBe('pantry')
    expect(guessPlace('Tomater')).toBe('fridge')
    expect(guessPlace('Spaghetti')).toBe('pantry')
    expect(guessPlace('Något okänt')).toBe('pantry')
  })
  it('en vald plats går före gissningen', () => {
    expect(placeOf({ name: 'Bröd', place: 'freezer' })).toBe('freezer')
    expect(placeOf({ name: 'Bröd' })).toBe('pantry')
  })
  it('ger en ikon utifrån namnet, annars efter plats', () => {
    expect(emojiFor('Ägg')).toBe('🥚')
    expect(emojiFor('Kycklingfilé')).toBe('🍗')
    expect(emojiFor('Lök')).toBe('🧅')
    expect(emojiFor('Vitlök')).toBe('🧄')
    expect(emojiFor('Krossade tomater')).toBe('🥫')
    expect(emojiFor('Ris')).toBe('🍚')
    expect(emojiFor('Riven ost')).toBe('🧀')
    expect(emojiFor('Te')).toBe('🍵')
    expect(emojiFor('Tacokrydda')).toBe('🧂')
    expect(emojiFor('Okänd sak', 'fridge')).toBe('🥡')
  })
})
