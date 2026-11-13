import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../db/repo'
import { answerSummary, emptyAnswers, hasAnswers, parseAnswers, toggleDiet, withAnswers } from './onboarding'

const base = defaultSettings()

describe('frågorna före inloggningen', () => {
  it('svaren hamnar i inställningarna: portioner, kost och allergier som krav, önskemål som preferenser', () => {
    const s = withAnswers(base, { portions: 4, diets: ['vegetarian'], likes: ['kids', 'spicy'], otherLike: 'Ogillar svamp', allergens: ['gluten', 'nuts'], otherAllergy: 'selleri' })
    expect(s.food.portions).toBe(4)
    expect(s.food.allergies).toBe('Vegetariskt, Glutenfritt, Utan nötter, Tål inte selleri')
    expect(s.memories).toEqual(['Barnvänlig mat', 'Gillar stark mat', 'Ogillar svamp'])
  })
  it('inget som redan finns på kontot tas bort', () => {
    const account = { ...base, food: { ...base.food, portions: 5, allergies: 'Laktosfritt, inga nötter, ogillar koriander', aliases: { bladspenat: 'Spenat' }, quickWeekdays: [1, 3] }, memories: ['Äter inte fisk på måndagar'] }
    const s = withAnswers(account, { ...emptyAnswers(), allergens: ['lactose', 'egg'], likes: ['cheap'] })
    expect(s.food.allergies).toBe('Laktosfritt, inga nötter, ogillar koriander, Utan ägg') // laktos stod redan där
    expect(s.food.portions).toBe(5) // användaren rörde inte portionerna
    expect(s.food.aliases).toEqual({ bladspenat: 'Spenat' })
    expect(s.food.quickWeekdays).toEqual([1, 3])
    expect(s.memories).toEqual(['Äter inte fisk på måndagar', 'Billig mat'])
  })
  it('att lägga på samma svar två gånger ändrar ingenting', () => {
    const a = { portions: 3, diets: ['vegan'], likes: ['green'], otherLike: 'Mycket soppa', allergens: ['soy'], otherAllergy: 'senap' }
    const once = withAnswers(base, a)
    expect(withAnswers(once, a)).toEqual(once)
  })
  it('tomma svar lämnar inställningarna som de är', () => {
    expect(withAnswers(base, emptyAnswers())).toEqual(base)
    expect(hasAnswers(emptyAnswers())).toBe(false)
    expect(hasAnswers({ ...emptyAnswers(), portions: 2 })).toBe(true)
    expect(hasAnswers({ ...emptyAnswers(), otherAllergy: 'selleri' })).toBe(true)
  })
  it('vegetariskt, veganskt och fisk men inte kött utesluter varandra', () => {
    expect(toggleDiet(['vegetarian'], 'vegan')).toEqual(['vegan'])
    expect(toggleDiet(['vegan', 'nopork'], 'pescetarian')).toEqual(['nopork', 'pescetarian'])
    expect(toggleDiet(['vegetarian'], 'nopork')).toEqual(['vegetarian', 'nopork'])
    expect(toggleDiet(['vegetarian', 'nopork'], 'vegetarian')).toEqual(['nopork'])
  })
  it('sparade svar läses säkert: okända val och konstiga värden kastas bort', () => {
    expect(parseAnswers({ portions: 99, diets: ['vegan', 'kött', 7], likes: 'kids', otherLike: '  Gillar   soppa \n', allergens: ['nuts', '<script>'], otherAllergy: 'x'.repeat(500) })).toEqual({
      diets: ['vegan'], likes: [], otherLike: 'Gillar soppa', allergens: ['nuts'], otherAllergy: 'x'.repeat(120),
    })
    expect(parseAnswers({ portions: 6 })).toEqual({ portions: 6, diets: [], likes: [], otherLike: '', allergens: [], otherAllergy: '' })
    expect(parseAnswers(null)).toBeNull()
    expect(parseAnswers('ja')).toBeNull()
  })
  it('sammanfattningen visar valen i korthet', () => {
    expect(answerSummary({ ...emptyAnswers(), diets: ['pescetarian'], allergens: ['gluten'], likes: ['quick'] }, 2)).toEqual(['2 portioner', 'Pescetariskt', 'Glutenfritt', 'Snabb och enkel vardagsmat'])
    expect(answerSummary({ ...emptyAnswers(), portions: 1 }, 2)).toEqual(['1 portion'])
  })
  it('ingen allergi faller bort även när texten blir lång', () => {
    const long = { ...base, food: { ...base.food, allergies: 'Tål inte ' + 'kiwi, '.repeat(60) + 'kiwi' } }
    const all = withAnswers(long, { portions: 2, diets: ['pescetarian', 'nopork'], likes: [], otherLike: '', allergens: ['gluten', 'lactose', 'milk', 'egg', 'nuts', 'peanuts', 'fish', 'shellfish', 'soy', 'sesame'], otherAllergy: 'x'.repeat(120) })
    expect(all.food.allergies).toMatch(/Utan sesam, Tål inte x{120}$/)
    expect(all.food.allergies.length).toBeLessThanOrEqual(1000) // det servern och säkerhetskopian tar emot
  })
})
