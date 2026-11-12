import { foodKey } from './food'
import { cleanName } from './shoppingName'
import type { PantryItem } from './types'

/**
 * Vad som går åt ur lagret när en rätt lagas ("Jag åt detta"). För varje vara i lagret som
 * receptet använder räknas vad som blir kvar. Går mängderna inte att jämföra (olika enheter,
 * eller ingen mängd i lagret) lämnas det åt användaren att avgöra om varan är slut.
 */

type Unit = 'g' | 'ml' | 'st'
const UNITS: Record<string, [number, Unit]> = {
  kg: [1000, 'g'], hg: [100, 'g'], g: [1, 'g'],
  l: [1000, 'ml'], liter: [1000, 'ml'], dl: [100, 'ml'], cl: [10, 'ml'], ml: [1, 'ml'], msk: [15, 'ml'], tsk: [5, 'ml'], krm: [1, 'ml'],
  st: [1, 'st'], stycken: [1, 'st'],
}

/**
 * "400 g" → 400 g, "1,5 kg" → 1500 g, "2 dl" → 200 ml, "1/2 dl" → 50 ml, "3" → 3 st.
 * null för mängder som inte går att räkna med ("2 klyftor", "1 burk", "halv förpackning").
 */
export function qty(text: string | undefined): { value: number; unit: Unit } | null {
  const t = (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/^ca\.?\s*/, '')
    .replace('½', '1/2')
    .replace('¼', '1/4')
    .replace('¾', '3/4')
  const m = /^(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?\s*([a-zåäö]+)?\.?$/.exec(t)
  if (!m) return null
  let n = Number(m[1].replace(',', '.'))
  if (m[2] && m[3]) n += Number(m[2]) / Number(m[3]) // "1 1/2"
  else if (m[4]) n /= Number(m[4]) // "1/2"
  const u = UNITS[m[5] ?? 'st']
  return u && Number.isFinite(n) && n > 0 ? { value: n * u[0], unit: u[1] } : null
}

const sv = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

/** Skriver en mängd i en enhet som är lätt att läsa: 1500 g → "1,5 kg", 250 ml → "2,5 dl". */
export function formatQty(value: number, unit: Unit): string {
  if (unit === 'g') return value >= 1000 ? `${sv(value / 1000)} kg` : `${Math.round(value)} g`
  if (unit === 'ml') return value >= 1000 ? `${sv(value / 1000)} l` : value >= 100 ? `${sv(value / 100)} dl` : `${Math.round(value)} ml`
  return `${sv(value)} st`
}

/** Ord som inte ändrar vilken vara det är: "gul lök" är lök, "fast potatis" är potatis. */
const NEUTRAL = new Set(['gul', 'gula', 'stor', 'stora', 'liten', 'små', 'fast', 'fasta', 'mjölig', 'mjöliga', 'mogen', 'mogna', 'hel', 'hela', 'svensk', 'svenska', 'vanlig', 'vanliga'])

/** Vanliga varianter som räknas som samma vara i lagret. */
const SAME: Record<string, string> = {
  mellanmjölk: 'mjölk', lättmjölk: 'mjölk', standardmjölk: 'mjölk', minimjölk: 'mjölk',
  vispgrädde: 'grädde', matlagningsgrädde: 'grädde', matgrädde: 'grädde',
  vetemjöl: 'mjöl', strösocker: 'socker', nötfärs: 'köttfärs', blandfärs: 'köttfärs',
  hushållsost: 'ost', herrgårdsost: 'ost', prästost: 'ost', grevéost: 'ost',
  kycklingfilé: 'kyckling', kycklingbröst: 'kyckling', kycklingbröstfilé: 'kyckling', kycklinglårfilé: 'kyckling', kycklinglår: 'kyckling',
  laxfilé: 'lax', torskfilé: 'torsk', morötter: 'morot',
}

/** Oregelbundna böjningar som inte fångas av ändelserna. */
const FORMS: Record<string, string> = { morötter: 'morot', lökar: 'lök', ägg: 'ägg', tomater: 'tomat' }

/** Varor som skrivs isär eller ihop: "röda lökar" och "röd lök" är rödlök. */
const PHRASES: [RegExp, string][] = [
  [/^röda? lök(ar)?$/, 'rödlök'],
  [/^rödlökar$/, 'rödlök'],
  [/^vitlöksklyft(a|or)$/, 'vitlök'],
  [/^klyft(a|or) vitlök$/, 'vitlök'],
  [/^salladslökar$/, 'salladslök'],
]
const phrase = (key: string) => PHRASES.find(([re]) => re.test(key))?.[1] ?? key

/** Namnet som det ska stå på listan: "röda lökar" → "Rödlök", "hackad gul lök" → "Gul lök". */
export function listName(name: string): string {
  const clean = cleanName(name)
  const canon = phrase(foodKey(clean))
  return canon === foodKey(clean) ? clean : canon[0].toLocaleUpperCase('sv') + canon.slice(1)
}

const words = (s: string, variants = true) =>
  phrase(foodKey(cleanName(s)))
    .split(/[\s-]+/)
    .filter((w) => w && !NEUTRAL.has(w))
    .map((w) => FORMS[w] ?? (variants ? (SAME[w] ?? w) : w))
    .sort()

const ENDINGS = ['er', 'ar', 'or', 'n', 'en', 'et', 'na', 'r', 'erna', 'arna', 'orna']

/** Samma ord, eller böjning av det: tomat/tomater, ägg/äggen, paprika/paprikor. Inte sammansättningar. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [x, y] = a.length <= b.length ? [a, b] : [b, a]
  if (ENDINGS.some((e) => y === x + e)) return true
  return x.endsWith('a') && y === `${x.slice(0, -1)}or`
}

/**
 * Är receptets ingrediens samma vara som den i lagret? Strängare än jämförelsen som visar
 * "har hemma", eftersom ett fel här drar av fel vara: "lök" är inte "vitlök", "mjölk" inte
 * "kokosmjölk", "tomater" inte "krossade tomater" och "pasta" inte "pastasås".
 */
export function sameProduct(ingredient: string, pantryName: string): boolean {
  const a = words(ingredient)
  const b = words(pantryName)
  return a.length > 0 && a.length === b.length && a.every((w, i) => sameWord(w, b[i]))
}

/**
 * Samma vara på inköpslistan: "hackad gul lök", "gul lök" och "Lök" är en och samma. Här räknas
 * däremot inte varianter som samma (vispgrädde och matlagningsgrädde är olika varor i butiken).
 */
export function sameShoppingItem(a: string, b: string): boolean {
  const x = words(a, false)
  const y = words(b, false)
  return x.length > 0 && x.length === y.length && x.every((w, i) => sameWord(w, y[i]))
}

export interface Consumption {
  item: PantryItem
  /** Vad receptet använder av varan, som text: "400 g" eller "2 dl + 1 msk". */
  need: string
  /** reduce = mängden minskar, remove = varan tar slut, unknown = går inte att räkna. */
  kind: 'reduce' | 'remove' | 'unknown'
  /** Vad som blir kvar när kind är reduce. */
  left?: string
}

/** Vad receptets ingredienser tar ur lagret. En vara som används flera gånger räknas ihop. */
export function consumption(ingredients: { name: string; amount: string }[], pantry: PantryItem[]): Consumption[] {
  const used = new Map<string, { item: PantryItem; needs: string[] }>()
  for (const ing of ingredients) {
    const item = pantry.find((p) => sameProduct(ing.name, p.name))
    if (!item) continue
    const row = used.get(item.id) ?? { item, needs: [] }
    row.needs.push(ing.amount)
    used.set(item.id, row)
  }
  return [...used.values()].map(({ item, needs }) => {
    const need = needs.filter(Boolean).join(' + ')
    const have = qty(item.amount)
    const parsed = needs.map(qty)
    if (!have || parsed.some((q) => !q || q.unit !== have.unit)) return { item, need, kind: 'unknown' as const }
    const left = have.value - parsed.reduce((s, q) => s + q!.value, 0)
    // Mindre än två procent kvar räknas som slut (avrundning i recept och förpackningar).
    return left <= have.value * 0.02 ? { item, need, kind: 'remove' as const } : { item, need, kind: 'reduce' as const, left: formatQty(left, have.unit) }
  })
}
