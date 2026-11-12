import { formatQty, listName, qty, sameShoppingItem, type Aliases } from './consume'
import { tidyAmount } from './shoppingName'

/** En rad på inköpslistan, före eller efter ihopslagning. */
export interface MergeLine {
  name: string
  amount?: string
  note?: string
  section?: string
}

/** Så lång får raden med rätter bli. Den måste rymma alla rätter, eftersom den visar vad som redan är tillagt. */
const NOTE_MAX = 1000

/** Rätterna ur en anteckning: "Veckomeny: Pyttipanna, Laxsoppa" → ["Pyttipanna", "Laxsoppa"]. */
function dishes(note: string | undefined): string[] {
  const text = (note ?? '').replace(/^veckomeny:\s*/i, '').trim()
  if (!text || /^\d+ rätter$/i.test(text)) return []
  return text.split(/,\s+/).map((d) => d.trim()).filter(Boolean)
}

/** Förpackningar och andra mått som går att räkna styckvis: ental och flertal. */
const PACKS: [string, string][] = [
  ['burk', 'burkar'], ['kruka', 'krukor'], ['paket', 'paket'], ['förp', 'förp'], ['förpackning', 'förpackningar'], ['påse', 'påsar'], ['knippe', 'knippen'],
  ['klyfta', 'klyftor'], ['skiva', 'skivor'], ['näve', 'nävar'], ['tärning', 'tärningar'], ['flaska', 'flaskor'], ['ask', 'askar'], ['stjälk', 'stjälkar'], ['port', 'port'], ['portion', 'portioner'], ['tub', 'tuber'], ['huvud', 'huvuden'],
]
/** "2 burkar" → [2, 'burk']. null för det som inte är ett antal förpackningar. */
function packs(amount: string): [number, string] | null {
  const m = /^(\d+(?:[.,]\d+)?)\s+([a-zåäö]+)\.?$/i.exec(amount.trim())
  const unit = m && PACKS.find(([one, many]) => one === m[2].toLowerCase() || many === m[2].toLowerCase())
  return m && unit ? [Number(m[1].replace(',', '.')), unit[0]] : null
}

/**
 * Lägger ihop mängder: de som går att räkna i samma enhet summeras ("1" + "2 st" = "3 st",
 * "1 burk" + "2 burkar" = "3 burkar"), resten står kvar som de är ("3 st + 1 1/2 dl").
 */
export function addAmounts(amounts: (string | undefined)[]): string | undefined {
  const sums = new Map<'g' | 'ml' | 'st', number>()
  const counts = new Map<string, number>()
  const other: string[] = []
  for (const raw of amounts) {
    const a = tidyAmount(raw)
    if (!a) continue
    const q = qty(a)
    const p = q ? null : packs(a)
    if (q) sums.set(q.unit, (sums.get(q.unit) ?? 0) + q.value)
    else if (p) counts.set(p[1], (counts.get(p[1]) ?? 0) + p[0])
    else if (!other.includes(a)) other.push(a)
  }
  const parts = [
    ...[...sums.entries()].map(([unit, value]) => formatQty(value, unit)),
    ...[...counts.entries()].map(([unit, n]) => `${String(Math.round(n * 10) / 10).replace('.', ',')} ${n === 1 ? unit : PACKS.find(([one]) => one === unit)![1]}`),
    ...other,
  ]
  return parts.length ? parts.join(' + ') : undefined
}

/**
 * Slår ihop rader som är samma vara ("gul lök", "hackad gul lök" och "Lök") till en rad med
 * det mest beskrivande namnet, summerad mängd och alla rätter. Namn från recept rensas
 * ("hackad koriander" → "Koriander"); varor användaren skrivit själv (utan rätt) lämnas som de är
 * så länge de inte slås ihop med något. `merged` = hur många rader som försvann.
 */
export function mergeShopping<T extends MergeLine>(items: T[], aliases?: Aliases): { lines: MergeLine[]; merged: number; changed: boolean } {
  const groups: T[][] = []
  for (const item of items) {
    const group = groups.find((g) => sameShoppingItem(g[0].name, item.name, aliases))
    if (group) group.push(item)
    else groups.push([item])
  }
  let changed = false
  const lines = groups.map((g) => {
    const fromRecipe = g.some((i) => dishes(i.note).length > 0)
    const section = g.find((i) => i.section)?.section
    if (g.length === 1 && !fromRecipe) return { name: g[0].name, ...(g[0].amount ? { amount: g[0].amount } : {}), ...(g[0].note ? { note: g[0].note } : {}), ...(section ? { section } : {}) }
    // Det mest beskrivande namnet: "Gul lök" hellre än "Lök".
    const name = g.map((i) => listName(i.name, aliases)).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)[0]
    const amount = addAmounts(g.map((i) => i.amount))
    const note = [...new Set(g.flatMap((i) => dishes(i.note)))].join(', ').slice(0, NOTE_MAX)
    const line = { name, ...(amount ? { amount } : {}), ...(note ? { note } : {}), ...(section ? { section } : {}) }
    if (g.length > 1 || line.name !== g[0].name || (line.amount ?? '') !== (g[0].amount ?? '') || (line.note ?? '') !== (g[0].note ?? '')) changed = true
    return line
  })
  return { lines, merged: items.length - lines.length, changed }
}

/**
 * Slår ihop utpekade rader (nummer i listan, från noll): varje grupp blir en rad med angivet
 * namn, summerad mängd och alla rätter. Används när AI:n eller användaren pekar ut dubbletter.
 * Ogiltiga nummer och rader som redan ingår i en annan grupp hoppas över.
 */
export function mergeRows(lines: MergeLine[], groups: { rows: number[]; name?: string }[]): MergeLine[] {
  const taken = new Set<number>()
  const mergedAt = new Map<number, MergeLine>()
  for (const g of groups) {
    const rows = [...new Set(g.rows)].filter((r) => Number.isInteger(r) && r >= 0 && r < lines.length && !taken.has(r))
    if (rows.length < 2) continue
    rows.forEach((r) => taken.add(r))
    const members = rows.map((r) => lines[r])
    // Utan angivet namn: det kortaste, som brukar vara det allmänna ("Bananer" hellre än "Ätmogna bananer").
    const name = g.name?.trim() || [...members].sort((a, b) => a.name.length - b.name.length)[0].name
    const amount = addAmounts(members.map((m) => m.amount))
    const note = [...new Set(members.flatMap((m) => dishes(m.note)))].join(', ').slice(0, NOTE_MAX)
    const section = members.find((m) => m.section)?.section
    mergedAt.set(Math.min(...rows), { name, ...(amount ? { amount } : {}), ...(note ? { note } : {}), ...(section ? { section } : {}) })
  }
  return lines.flatMap((line, i) => (mergedAt.has(i) ? [mergedAt.get(i)!] : taken.has(i) ? [] : [line]))
}

/** Står rätten redan på raden? Äldre rader ("3 rätter") säger inte vilka: de räknas som täckta, så att inget dubbleras. */
const covers = (note: string | undefined, dish: string) => {
  const n = (note ?? '').toLowerCase()
  // En avkortad rad kan ha tappat rätten på slutet: räkna den som täckt hellre än att lägga till dubbelt.
  return n.includes(dish.trim().toLowerCase()) || /\d+ rätter$/.test(n) || n.length >= NOTE_MAX
}

/**
 * Det ur menyn som inte redan står på listan. Ett behov (vara + rätt) är täckt om listan har
 * samma vara med den rätten angiven: då har det lagts till förut, och ska inte räknas en gång
 * till. Resten slås ihop per vara, med summerad mängd och alla rätter.
 */
export function uncoveredNeeds(needs: { name: string; amount?: string; dish: string }[], list: { name: string; note?: string }[], aliases?: Aliases): MergeLine[] {
  const open = needs.filter((n) => !list.some((row) => covers(row.note, n.dish) && sameShoppingItem(row.name, n.name, aliases)))
  return mergeShopping(open.map((n) => ({ name: n.name, ...(n.amount ? { amount: n.amount } : {}), note: n.dish })), aliases).lines
}
