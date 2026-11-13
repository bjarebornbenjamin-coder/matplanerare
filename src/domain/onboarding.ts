import type { Settings } from './types'

/**
 * Frågorna som ställs innan inloggningen: portioner, matpreferenser och allergier. Svaren läggs
 * till i inställningarna utan att ta bort något som redan står där, så att ett konto som redan
 * har allergier sparade aldrig tappar dem.
 */

/** Ett val i en fråga. `text` är det som sparas och skickas till AI:n. */
export interface Choice {
  id: string
  label: string
  text: string
}

/** Kost som menyn måste följa. */
export const DIETS: Choice[] = [
  { id: 'vegetarian', label: 'Vegetariskt', text: 'Vegetariskt' },
  { id: 'vegan', label: 'Veganskt', text: 'Veganskt' },
  { id: 'pescetarian', label: 'Fisk men inte kött', text: 'Pescetariskt (fisk men inget kött)' },
  { id: 'nopork', label: 'Inget fläskkött', text: 'Inget fläskkött' },
]
/** Av de här kan bara en gälla åt gången. */
export const EXCLUSIVE_DIETS = ['vegetarian', 'vegan', 'pescetarian']

/** Sådant man gillar: önskemål, inte krav. */
export const LIKES: Choice[] = [
  { id: 'kids', label: 'Barnvänligt', text: 'Barnvänlig mat' },
  { id: 'quick', label: 'Snabbt och enkelt', text: 'Snabb och enkel vardagsmat' },
  { id: 'cheap', label: 'Billigt', text: 'Billig mat' },
  { id: 'protein', label: 'Proteinrikt', text: 'Proteinrik mat' },
  { id: 'green', label: 'Mycket grönt', text: 'Mycket grönsaker' },
  { id: 'spicy', label: 'Stark mat', text: 'Gillar stark mat' },
  { id: 'classic', label: 'Husmanskost', text: 'Gillar husmanskost' },
  { id: 'world', label: 'Mat från hela världen', text: 'Gillar mat från olika kök i världen' },
]

/** Det vanligaste man inte tål. Texten säger tydligt att det ska undvikas. */
export const ALLERGENS: Choice[] = [
  { id: 'gluten', label: 'Gluten', text: 'Glutenfritt' },
  { id: 'lactose', label: 'Laktos', text: 'Laktosfritt' },
  { id: 'milk', label: 'Mjölkprotein', text: 'Utan mjölkprotein' },
  { id: 'egg', label: 'Ägg', text: 'Utan ägg' },
  { id: 'nuts', label: 'Nötter', text: 'Utan nötter' },
  { id: 'peanuts', label: 'Jordnötter', text: 'Utan jordnötter' },
  { id: 'fish', label: 'Fisk', text: 'Utan fisk' },
  { id: 'shellfish', label: 'Skaldjur', text: 'Utan skaldjur' },
  { id: 'soy', label: 'Soja', text: 'Utan soja' },
  { id: 'sesame', label: 'Sesam', text: 'Utan sesam' },
]

export const MIN_PORTIONS = 1
export const MAX_PORTIONS = 8

export interface Answers {
  /** Portioner per måltid. Saknas om användaren inte ändrade förslaget. */
  portions?: number
  diets: string[]
  likes: string[]
  /** Annat man gillar eller ogillar, i fri text. */
  otherLike: string
  allergens: string[]
  /** Annat man inte tål, i fri text. */
  otherAllergy: string
}

export const emptyAnswers = (): Answers => ({ diets: [], likes: [], otherLike: '', allergens: [], otherAllergy: '' })

const ids = (v: unknown, from: Choice[]) => (Array.isArray(v) ? from.filter((c) => v.includes(c.id)).map((c) => c.id) : [])
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Läser sparade svar. Okända val och konstiga värden kastas bort. */
export function parseAnswers(v: unknown): Answers | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const portions = typeof o.portions === 'number' && Number.isInteger(o.portions) && o.portions >= MIN_PORTIONS && o.portions <= MAX_PORTIONS ? o.portions : undefined
  return {
    ...(portions !== undefined ? { portions } : {}),
    diets: ids(o.diets, DIETS),
    likes: ids(o.likes, LIKES),
    otherLike: text(o.otherLike, 120),
    allergens: ids(o.allergens, ALLERGENS),
    otherAllergy: text(o.otherAllergy, 120),
  }
}

/** Slår av eller på en kost. Vegetariskt, veganskt och fisk men inte kött utesluter varandra. */
export function toggleDiet(diets: string[], id: string): string[] {
  if (diets.includes(id)) return diets.filter((d) => d !== id)
  return [...diets.filter((d) => !(EXCLUSIVE_DIETS.includes(id) && EXCLUSIVE_DIETS.includes(d))), id]
}

const texts = (from: Choice[], chosen: string[]) => from.filter((c) => chosen.includes(c.id)).map((c) => c.text)

/** Det som måste följas: kost och allergier. */
export const mustTexts = (a: Answers) => [...texts(DIETS, a.diets), ...texts(ALLERGENS, a.allergens), ...(a.otherAllergy ? [`Tål inte ${a.otherAllergy}`] : [])]
/** Önskemålen. */
export const likeTexts = (a: Answers) => [...texts(LIKES, a.likes), ...(a.otherLike ? [a.otherLike] : [])]

/** Har användaren svarat något som ska sparas? */
export const hasAnswers = (a: Answers) => a.portions !== undefined || mustTexts(a).length > 0 || likeTexts(a).length > 0

/**
 * Inställningarna med svaren tillagda. Inget tas bort: kost och allergier läggs till efter det
 * som redan står där, önskemål läggs till bland preferenserna, och portionerna ändras bara om
 * användaren själv valde ett antal.
 */
export function withAnswers(s: Settings, a: Answers): Settings {
  const current = s.food.allergies.trim()
  const lower = current.toLowerCase()
  const added = mustTexts(a).filter((t) => !lower.includes(t.toLowerCase()))
  // Ingen avkortning här: en allergi får aldrig falla bort för att texten blev lång.
  const allergies = [current, ...added].filter(Boolean).join(', ')
  const known = new Set(s.memories.map((m) => m.toLowerCase()))
  const memories = [...s.memories, ...likeTexts(a).filter((t) => !known.has(t.toLowerCase()))].slice(0, 30)
  return { ...s, food: { ...s.food, allergies, portions: a.portions ?? s.food.portions }, memories }
}

/** Svaren i korthet, för sammanfattningen före inloggningen: "4 portioner", "Vegetariskt", "Glutenfritt". */
export function answerSummary(a: Answers, defaultPortions: number): string[] {
  const n = a.portions ?? defaultPortions
  return [`${n} ${n === 1 ? 'portion' : 'portioner'}`, ...mustTexts(a).map((t) => t.replace(/ \(.*\)$/, '')), ...likeTexts(a)]
}
