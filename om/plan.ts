import { addDays } from '../src/domain/dates'
import { mergeShopping } from '../src/domain/shoppingMerge'
import { SECTIONS, sectionFor, type Section } from '../src/domain/storeSection'
import type { ISODate } from '../src/domain/types'

/**
 * Exemplet på presentationssidan. Allt som visas räknas fram här, ur datan nedan:
 * vilken dag varje vara i kylen används (det som går ut först används först), och
 * inköpslistan, som slås ihop och sorteras av appens egen kod. Sidan säger på sin
 * yta att det är ett exempel.
 */

export interface FridgeItem {
  id: string
  name: string
  amount: string
  /** Dagar tills varan går ut, räknat från idag. */
  daysLeft: number
}

export interface Dish {
  id: string
  title: string
  minutes: number
  /** Varor ur kylen som rätten använder. */
  uses: string[]
  /** Det som behöver köpas, skrivet som i receptet. */
  buy: { name: string; amount: string }[]
}

export const FRIDGE: FridgeItem[] = [
  { id: 'gradde', name: 'Grädde', amount: '3 dl', daysLeft: 1 },
  { id: 'spenat', name: 'Spenat', amount: '65 g', daysLeft: 1 },
  { id: 'kyckling', name: 'Kycklingfilé', amount: '500 g', daysLeft: 2 },
  { id: 'halloumi', name: 'Halloumi', amount: '1 st', daysLeft: 3 },
  { id: 'paprika', name: 'Paprika', amount: '2 st', daysLeft: 4 },
  { id: 'zucchini', name: 'Zucchini', amount: '1 st', daysLeft: 4 },
  { id: 'feta', name: 'Fetaost', amount: '150 g', daysLeft: 5 },
  { id: 'agg', name: 'Ägg', amount: '6 st', daysLeft: 8 },
  { id: 'morot', name: 'Morötter', amount: '5 st', daysLeft: 10 },
  { id: 'potatis', name: 'Potatis', amount: '1 kg', daysLeft: 14 },
]

/** Rätterna planeraren väljer bland. Ordningen avgör bara när två rätter är lika bra. */
export const DISHES: Dish[] = [
  {
    id: 'pasta', title: 'Krämig pasta med spenat', minutes: 25, uses: ['spenat', 'gradde'],
    buy: [{ name: 'hackad gul lök', amount: '1 st' }, { name: 'vitlöksklyfta', amount: '1' }, { name: 'riven parmesan', amount: '1 dl' }],
  },
  {
    id: 'gryta', title: 'Kycklinggryta med paprika', minutes: 35, uses: ['kyckling', 'paprika', 'gradde'],
    buy: [{ name: 'gul lök', amount: '1 st' }, { name: 'färsk koriander', amount: '1 kruka' }, { name: 'lime', amount: '1 st' }],
  },
  {
    id: 'halloumi', title: 'Halloumi med rostade grönsaker', minutes: 40, uses: ['halloumi', 'zucchini', 'potatis'],
    buy: [{ name: 'rödlök', amount: '1 st' }, { name: 'citron', amount: '1/2 st' }],
  },
  {
    id: 'shakshuka', title: 'Shakshuka med fetaost', minutes: 30, uses: ['agg', 'feta', 'paprika'],
    buy: [{ name: 'lök, hackad', amount: '1 st' }, { name: 'färsk koriander', amount: '1/2 kruka' }, { name: 'krossade tomater', amount: '2 burkar' }],
  },
  {
    id: 'soppa', title: 'Morotssoppa med ingefära', minutes: 30, uses: ['morot', 'potatis'],
    buy: [{ name: 'gul lök', amount: '1' }, { name: 'ingefära', amount: '3 cm' }, { name: 'kokosmjölk', amount: '1 burk' }],
  },
  {
    id: 'tacos', title: 'Tacos med köttfärs', minutes: 30, uses: ['paprika'],
    buy: [{ name: 'köttfärs', amount: '500 g' }, { name: 'tortillabröd', amount: '8 st' }, { name: 'riven ost', amount: '2 dl' }, { name: 'gurka', amount: '1 st' }, { name: 'gräddfil', amount: '2 dl' }],
  },
  {
    id: 'lax', title: 'Ugnsbakad lax med potatis', minutes: 30, uses: ['potatis'],
    buy: [{ name: 'laxfilé', amount: '400 g' }, { name: 'citron', amount: '1 st' }, { name: 'färsk dill', amount: '1 knippe' }, { name: 'crème fraiche', amount: '2 dl' }],
  },
  {
    id: 'pytt', title: 'Pyttipanna med stekt ägg', minutes: 30, uses: ['potatis', 'agg'],
    buy: [{ name: 'gul lök', amount: '2 st' }, { name: 'falukorv', amount: '400 g' }],
  },
  {
    id: 'biffar', title: 'Zucchinibiffar med tzatziki', minutes: 40, uses: ['zucchini', 'agg', 'feta'],
    buy: [{ name: 'gurka', amount: '1/2 st' }, { name: 'turkisk yoghurt', amount: '2 dl' }, { name: 'vitlöksklyfta', amount: '1' }],
  },
]

export interface PlannedDay {
  date: ISODate
  dish: Dish
  /** Varor ur kylen som används för första gången den här dagen, de mest brådskande först. */
  arrivals: FridgeItem[]
}

/**
 * Planerar en vecka: varje dag väljs den rätt som använder de mest brådskande varorna som
 * ännu inte har en dag. En vara som går ut om x dagar väger 1/(x+1); en vara som redan
 * har gått ut den dagen kan inte användas. Varje vara landar på den första dag som använder den.
 */
export function planWeek(today: ISODate, fridge: FridgeItem[] = FRIDGE, dishes: Dish[] = DISHES, days = 7): PlannedDay[] {
  const byId = new Map(fridge.map((f) => [f.id, f]))
  const placed = new Set<string>()
  const chosen = new Set<string>()
  const week: PlannedDay[] = []
  for (let d = 0; d < days && chosen.size < dishes.length; d++) {
    const fresh = (dish: Dish) => dish.uses.map((id) => byId.get(id)).filter((f): f is FridgeItem => Boolean(f) && !placed.has(f!.id) && f!.daysLeft >= d)
    const score = (dish: Dish) => fresh(dish).reduce((s, f) => s + 1 / (f.daysLeft - d + 1), 0)
    let best: Dish | null = null
    for (const dish of dishes) {
      if (chosen.has(dish.id)) continue
      if (!best || score(dish) > score(best) + 1e-9 || (Math.abs(score(dish) - score(best)) < 1e-9 && fresh(dish).length > fresh(best).length)) best = dish
    }
    const arrivals = fresh(best!).sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'sv'))
    arrivals.forEach((f) => placed.add(f.id))
    chosen.add(best!.id)
    week.push({ date: addDays(today, d), dish: best!, arrivals })
  }
  return week
}

/** Hur många av kylens varor som får en dag innan de går ut. */
export const usedInTime = (week: PlannedDay[], fridge: FridgeItem[] = FRIDGE) =>
  fridge.filter((f) => week.some((day, d) => d <= f.daysLeft && day.arrivals.some((a) => a.id === f.id))).length

export interface ShoppingResult {
  /** Raderna som de står i recepten, en per ingrediens och rätt. */
  raw: { name: string; amount: string; dish: string }[]
  /** Samma rader efter appens ihopslagning, grupperade efter butikens avdelningar. */
  sections: { section: Section; lines: { name: string; amount?: string }[] }[]
  /** Antal rader efter ihopslagningen. */
  count: number
}

/** Inköpslistan för veckan: det som saknas, ihopslaget och sorterat av appens egen kod. */
export function shoppingFor(week: PlannedDay[]): ShoppingResult {
  const raw = week.flatMap((day) => day.dish.buy.map((b) => ({ ...b, dish: day.dish.title })))
  const merged = mergeShopping(raw.map((r) => ({ name: r.name, amount: r.amount, note: r.dish }))).lines
  const sections = SECTIONS.map((section) => ({
    section,
    lines: merged
      .filter((l) => sectionFor(l) === section)
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map((l) => ({ name: l.name, ...(l.amount ? { amount: l.amount } : {}) })),
  })).filter((s) => s.lines.length > 0)
  return { raw, sections, count: merged.length }
}
