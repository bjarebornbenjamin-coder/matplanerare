import { describe, expect, it } from 'vitest'
import { SECTIONS, sectionOf } from './storeSection'

describe('butikens avdelningar', () => {
  it('sorterar varor till rätt avdelning', () => {
    const cases: [string, string][] = [
      ['Potatis', 'Frukt & grönt'], ['Gul lök', 'Frukt & grönt'], ['Vitlök', 'Frukt & grönt'], ['Bananer', 'Frukt & grönt'], ['Blåbär', 'Frukt & grönt'], ['Tomater', 'Frukt & grönt'], ['Koriander', 'Frukt & grönt'],
      ['Bröd', 'Bröd'], ['Korvbröd', 'Bröd'], ['Tortillabröd', 'Bröd'],
      ['Kycklingfilé', 'Kött, fisk & chark'], ['Laxfilé', 'Kött, fisk & chark'], ['Köttfärs', 'Kött, fisk & chark'], ['Räkor', 'Kött, fisk & chark'], ['Bacon', 'Kött, fisk & chark'],
      ['Mjölk', 'Mejeri & ägg'], ['Matlagningsgrädde', 'Mejeri & ägg'], ['Ägg', 'Mejeri & ägg'], ['Parmesanost', 'Mejeri & ägg'], ['Riven ost', 'Mejeri & ägg'], ['Smör', 'Mejeri & ägg'], ['Filmjölk', 'Mejeri & ägg'],
      ['Spaghetti', 'Skafferi'], ['Krossade tomater', 'Skafferi'], ['Tomatpuré', 'Skafferi'], ['Kokosmjölk', 'Skafferi'], ['Franska örter', 'Skafferi'], ['Jasminris', 'Skafferi'], ['Vetemjöl', 'Skafferi'], ['Te', 'Skafferi'], ['Vitlökspulver', 'Skafferi'], ['Kycklingbuljong', 'Skafferi'], ['Ketchup', 'Skafferi'],
      ['Frysta ärtor', 'Fryst'], ['Vaniljglass', 'Fryst'], ['Frysta franska örter', 'Fryst'],
      ['Apelsinjuice', 'Dryck'], ['Öl', 'Dryck'],
      ['Tandkräm', 'Övrigt'], ['Diskmedel', 'Övrigt'],
    ]
    for (const [name, section] of cases) expect([name, sectionOf(name)]).toEqual([name, section])
    expect(SECTIONS[0]).toBe('Frukt & grönt')
    expect(SECTIONS[SECTIONS.length - 1]).toBe('Övrigt')
  })
})
