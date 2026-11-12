import { formatQty, listName, qty, sameShoppingItem } from './consume'
import { tidyAmount } from './shoppingName'

/** En rad på inköpslistan, före eller efter ihopslagning. */
export interface MergeLine {
  name: string
  amount?: string
  note?: string
  section?: string
}

/** Rätterna ur en anteckning: "Veckomeny: Pyttipanna, Laxsoppa" → ["Pyttipanna", "Laxsoppa"]. */
function dishes(note: string | undefined): string[] {
  const text = (note ?? '').replace(/^veckomeny:\s*/i, '').trim()
  if (!text || /^\d+ rätter$/i.test(text)) return []
  return text.split(/,\s+/).map((d) => d.trim()).filter(Boolean)
}

/**
 * Lägger ihop mängder: de som går att räkna i samma enhet summeras ("1" + "2 st" = "3 st"),
 * resten står kvar som de är ("3 st + 1 1/2 dl").
 */
export function addAmounts(amounts: (string | undefined)[]): string | undefined {
  const sums = new Map<'g' | 'ml' | 'st', number>()
  const other: string[] = []
  for (const raw of amounts) {
    const a = tidyAmount(raw)
    if (!a) continue
    const q = qty(a)
    if (q) sums.set(q.unit, (sums.get(q.unit) ?? 0) + q.value)
    else if (!other.includes(a)) other.push(a)
  }
  const parts = [...[...sums.entries()].map(([unit, value]) => formatQty(value, unit)), ...other]
  return parts.length ? parts.join(' + ') : undefined
}

/**
 * Slår ihop rader som är samma vara ("gul lök", "hackad gul lök" och "Lök") till en rad med
 * det mest beskrivande namnet, summerad mängd och alla rätter. Namn från recept rensas
 * ("hackad koriander" → "Koriander"); varor användaren skrivit själv (utan rätt) lämnas som de är
 * så länge de inte slås ihop med något. `merged` = hur många rader som försvann.
 */
export function mergeShopping<T extends MergeLine>(items: T[]): { lines: MergeLine[]; merged: number; changed: boolean } {
  const groups: T[][] = []
  for (const item of items) {
    const group = groups.find((g) => sameShoppingItem(g[0].name, item.name))
    if (group) group.push(item)
    else groups.push([item])
  }
  let changed = false
  const lines = groups.map((g) => {
    const fromRecipe = g.some((i) => dishes(i.note).length > 0)
    const section = g.find((i) => i.section)?.section
    if (g.length === 1 && !fromRecipe) return { name: g[0].name, ...(g[0].amount ? { amount: g[0].amount } : {}), ...(g[0].note ? { note: g[0].note } : {}), ...(section ? { section } : {}) }
    // Det mest beskrivande namnet: "Gul lök" hellre än "Lök".
    const name = g.map((i) => listName(i.name)).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)[0]
    const amount = addAmounts(g.map((i) => i.amount))
    const note = [...new Set(g.flatMap((i) => dishes(i.note)))].join(', ').slice(0, 120)
    const line = { name, ...(amount ? { amount } : {}), ...(note ? { note } : {}), ...(section ? { section } : {}) }
    if (g.length > 1 || line.name !== g[0].name || (line.amount ?? '') !== (g[0].amount ?? '') || (line.note ?? '') !== (g[0].note ?? '')) changed = true
    return line
  })
  return { lines, merged: items.length - lines.length, changed }
}
