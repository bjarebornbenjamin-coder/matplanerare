import { formatQty, listName, qty, sameShoppingItem, type Aliases } from './consume'
import { shoppingAmount, unitFromName } from './shoppingName'

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

/** Förpackningar man köper hela: ental och flertal. */
const PACKS: [string, string][] = [
  ['burk', 'burkar'], ['kruka', 'krukor'], ['paket', 'paket'], ['förp', 'förp'], ['påse', 'påsar'], ['knippe', 'knippen'],
  ['ask', 'askar'], ['flaska', 'flaskor'], ['tub', 'tuber'], ['port', 'port'],
]
/** Andra sätt att skriva samma mått. */
const SAME_UNIT: Record<string, string> = { pkt: 'paket', frp: 'förp', förpackning: 'förp', förpackningar: 'förp', brk: 'burk', portion: 'port', portioner: 'port', huvuden: 'huvud', klyfta: 'klyftor' }
const unitOf = (word: string) => SAME_UNIT[word] ?? PACKS.find(([one, many]) => one === word || many === word)?.[0] ?? word

/** "0,5 ask" → [0.5, 'ask'], "1 1/2 kruka" → [1.5, 'kruka'], "12 cm" → [12, 'cm']. null om det inte är ett tal följt av ett ord. */
function counted(amount: string): [number, string] | null {
  const m = /^(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?\s*([a-zåäö]+)\.?$/.exec(amount)
  if (!m) return null
  let n = Number(m[1].replace(',', '.'))
  if (m[2] && m[3]) n += Number(m[2]) / Number(m[3])
  else if (m[4]) n /= Number(m[4])
  return Number.isFinite(n) && n > 0 ? [n, unitOf(m[5])] : null
}

/** Färska örter köper man i kruka eller knippe: ett volymmått ("0,5 dl koriander") säger inget i butiken. */
const HERBS = ['basilika', 'koriander', 'persilja', 'dill', 'mynta', 'gräslök', 'timjan', 'rosmarin', 'salvia', 'oregano', 'dragon', 'körvel', 'citronmeliss', 'ärtskott', 'krasse']
/** Hur många centimeter en hel sådan brukar vara, för recept som skriver "12 cm gurka". */
const cmPerPiece = (name: string) => (/purjo/.test(name) ? 40 : 30)
/** Hur många klyftor en hel brukar ge: en vitlök har ungefär tio, en citron eller ett äpple sex till åtta. */
const wedgesPerPiece = (name: string) => (/vitlök/.test(name) ? 10 : 6)

const whole = (n: number) => Math.max(1, Math.ceil(n - 1e-9))

/**
 * Lägger ihop mängder till det man köper. Mängder i samma enhet summeras ("200 g" + "300 g" =
 * "500 g", "1 kruka" + "1/2 kruka" = "2 krukor"), och summan görs om till något som går att
 * lägga i korgen: styck och förpackningar avrundas uppåt till hela ("0,5 st" → "1 st",
 * "0,5 ask" → "1 ask"), centimeter och klyftor blir styck ("12 cm gurka" → "1 st"). `name` är
 * varan mängden gäller, för de omräkningar som beror på vad det är.
 */
export function addAmounts(amounts: (string | undefined)[], name = ''): string | undefined {
  const item = name.toLowerCase()
  const sums = new Map<'g' | 'ml' | 'st', number>()
  const packs = new Map<string, number>()
  const other: string[] = []
  const add = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n)
  for (const raw of amounts) {
    // En redan sammanlagd mängd ("1 kruka + 1/2 kruka") räknas del för del.
    for (const part of (raw ?? '').split(/\s+\+\s+/)) {
      const a = shoppingAmount(part)
      if (!a) continue
      // "2–3 st": ta det större, så att det räcker. "2 burkar à 400 g": räkna burkarna.
      const text = a.toLowerCase().replace(/^ca\.?\s*/, '').replace('½', '1/2').replace('¼', '1/4').replace('¾', '3/4').replace(/^\d+(?:[.,]\d+)?\s*[-–]\s*(?=\d)/, '').replace(/\s+à\s+.*$/, '')
      const q = qty(text)
      const c = q ? null : counted(text)
      if (q) add(sums, q.unit, q.value)
      else if (c && c[1] === 'cm') add(sums, 'st', c[0] / cmPerPiece(item))
      else if (c && c[1] === 'klyftor') add(sums, 'st', c[0] / wedgesPerPiece(item))
      else if (c && c[1] === 'huvud') add(sums, 'st', c[0])
      else if (c && PACKS.some(([one]) => one === c[1])) add(packs, c[1], c[0])
      else if (!other.includes(a)) other.push(a)
    }
  }
  // Örter: finns en kruka eller ett knippe räcker det; annars visas ingen mängd alls.
  if (HERBS.some((h) => item.includes(h))) sums.delete('ml')
  // Det man räknar i butiken (styck och förpackningar) står först, sedan vikt och volym.
  const parts = [
    ...(sums.has('st') ? [`${whole(sums.get('st')!)} st`] : []),
    ...[...packs.entries()].map(([unit, n]) => `${whole(n)} ${whole(n) === 1 ? unit : PACKS.find(([one]) => one === unit)![1]}`),
    ...(['g', 'ml'] as const).filter((u) => sums.has(u)).map((u) => formatQty(sums.get(u)!, u)),
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
export function mergeShopping<T extends MergeLine>(list: T[], aliases?: Aliases): { lines: MergeLine[]; merged: number; changed: boolean } {
  // Mått som hamnat i namnet ("Ask ärtskott", "Cm gurka") flyttas till mängden innan raderna jämförs.
  const items = list.map((i): MergeLine => {
    const { amount: _old, ...rest } = i
    return { ...rest, ...unitFromName(i.name, i.amount) }
  })
  const groups: MergeLine[][] = []
  for (const item of items) {
    const group = groups.find((g) => sameShoppingItem(g[0].name, item.name, aliases))
    if (group) group.push(item)
    else groups.push([item])
  }
  let changed = items.some((it, i) => it.name !== list[i].name || (it.amount ?? '') !== (list[i].amount ?? ''))
  const lines = groups.map((g) => {
    const fromRecipe = g.some((i) => dishes(i.note).length > 0)
    const section = g.find((i) => i.section)?.section
    if (g.length === 1 && !fromRecipe) return { name: g[0].name, ...(g[0].amount ? { amount: g[0].amount } : {}), ...(g[0].note ? { note: g[0].note } : {}), ...(section ? { section } : {}) }
    // Det mest beskrivande namnet: "Gul lök" hellre än "Lök".
    const name = g.map((i) => listName(i.name, aliases)).sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)[0]
    const amount = addAmounts(g.map((i) => i.amount), name)
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
    const amount = addAmounts(members.map((m) => m.amount), name)
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
