import { useSyncExternalStore } from 'react'
import { tidyWithAi } from '../ai/shoppingPlan'
import { db } from '../db/db'
import { getAiConfig, getSettings, replaceOpenShopping, saveSettings } from '../db/repo'
import { aliasKey } from '../domain/consume'
import { foodKey } from '../domain/food'
import { mergeRows, mergeShopping, type MergeLine } from '../domain/shoppingMerge'
import { authHeaders } from './auth'
import { showToast } from './undo'

/**
 * Städningen av inköpslistan. Appen gör själv det som går att räkna ut: rensar namnen, slår ihop
 * rader som säkert är samma vara och summerar mängderna. AI:n får sedan bara svara på frågor om
 * det appen inte kan veta (är "Kvisttomater" och "Tomater" samma vara? var står varan i butiken?).
 * AI:n skriver aldrig om listan, så den kan inte ta bort varor.
 *
 * Det sker automatiskt när listan öppnas, men bara när det tillkommit varor sedan förra
 * genomgången. Listan som den såg ut före städningen sparas i ett dygn och går att återställa.
 */

interface TidyState {
  running: boolean
  /** Varför AI:n inte kunde gå igenom listan. */
  message: string
  /** Senaste städningen, så länge listan före den går att återställa. */
  restore: { at: string; from: number; to: number } | null
}

type Keyed = { name: string; amount?: string }
const keyOf = (i: Keyed) => `${foodKey(i.name)}|${(i.amount ?? '').trim().toLowerCase()}`
const toLine = (i: MergeLine): MergeLine => ({ name: i.name, ...(i.amount ? { amount: i.amount } : {}), ...(i.note ? { note: i.note } : {}), ...(i.section ? { section: i.section } : {}) })

/** Listan som den såg ut före senaste städningen. */
interface Snapshot {
  at: string
  items: MergeLine[]
  /** Raderna efter städningen, för att kunna skilja ut varor som lagts till senare. */
  after: string[]
}
const BEFORE_KEY = 'matplanerare-shopping-before-tidy'
const KEEP_MS = 24 * 60 * 60 * 1000

function readSnapshot(now = Date.now()): Snapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(BEFORE_KEY) ?? 'null') as Partial<Snapshot> | null
    if (!s || typeof s.at !== 'string' || !Array.isArray(s.items) || !Array.isArray(s.after)) return null
    const age = now - Date.parse(s.at)
    if (!(age >= 0 && age <= KEEP_MS)) return null
    const items = s.items.filter((i): i is MergeLine => Boolean(i) && typeof i.name === 'string' && i.name.trim() !== '').map(toLine)
    return items.length ? { at: s.at, items, after: s.after.filter((k): k is string => typeof k === 'string') } : null
  } catch {
    return null
  }
}
const restoreInfo = (s: Snapshot | null) => (s ? { at: s.at, from: s.items.length, to: s.after.length } : null)

let state: TidyState = { running: false, message: '', restore: restoreInfo(readSnapshot()) }
const listeners = new Set<() => void>()
function set(patch: Partial<TidyState>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useShoppingTidy(): TidyState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

// v4: mängderna görs om till det man köper (hela styck och förpackningar); gamla listor gås igenom en gång till.
const KEY = 'matplanerare-shopping-tidied-v4'

function tidiedKeys(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Kom ihåg vilka rader som redan är genomgångna. */
export function rememberTidied(lines: Keyed[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines.map(keyOf)))
  } catch {
    /* utan minne körs genomgången om nästa gång, vilket bara kostar ett anrop */
  }
}

/** Har det tillkommit varor sedan listan senast gicks igenom? Avbockade och borttagna räknas inte. */
export function needsTidy(open: Keyed[], known: Set<string> = tidiedKeys()): boolean {
  return open.length >= 2 && open.some((i) => !known.has(keyOf(i)))
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** Samma innehåll oavsett ordning? */
const signature = (lines: MergeLine[]) => lines.map((l) => [l.name, l.amount ?? '', l.note ?? '', l.section ?? ''].join('|')).sort().join('\n')

/**
 * Lägger tillbaka listan som den var före senaste städningen. Varor som lagts till efter
 * städningen får vara kvar. Den återställda listan städas inte om av sig själv.
 */
export async function restoreBeforeTidy(): Promise<void> {
  const snap = readSnapshot()
  if (!snap) return
  const open = (await db.shopping.toArray()).filter((i) => !i.done)
  const after = new Set(snap.after)
  const before = new Set(snap.items.map(keyOf))
  const added = open.filter((i) => !after.has(keyOf(i)) && !before.has(keyOf(i))).map(toLine)
  const lines = [...snap.items, ...added]
  await replaceOpenShopping(lines)
  rememberTidied(lines)
  try {
    localStorage.removeItem(BEFORE_KEY)
  } catch {
    /* går inte att rensa: bilden blir ändå för gammal efter ett dygn */
  }
  set({ restore: null, message: '' })
}

/**
 * Går igenom listan. `force` kör genomgången även om inget nytt tillkommit (knappen "Städa med AI").
 * Ändringen går att ångra direkt, och att återställa i ett dygn.
 */
export async function tidyShopping(opts: { force?: boolean } = {}): Promise<void> {
  if (state.running) return
  const open = (await db.shopping.toArray()).filter((i) => !i.done)
  if (open.length < 2 || (!opts.force && !needsTidy(open))) return
  set({ running: true, message: '' })
  try {
    const aliases = (await getSettings()).food.aliases
    // 1. Det appen själv kan avgöra: rena namn, säkra dubbletter, summerade mängder.
    const local = mergeShopping(open, aliases).lines
    // 2. Det AI:n får avgöra: liknande par, okända avdelningar och "satser". Går det inte står steg 1 kvar.
    let lines = local
    let failed = ''
    try {
      const [config, headers] = await Promise.all([getAiConfig(), authHeaders()])
      lines = await tidyWithAi(local, aliases, config.model, headers)
    } catch (e) {
      failed = e instanceof Error ? e.message : 'Försök igen.'
    }
    if (signature(lines) !== signature(open.map(toLine))) {
      const snap: Snapshot = { at: new Date().toISOString(), items: open.map(toLine), after: lines.map(keyOf) }
      await replaceOpenShopping(lines)
      try {
        localStorage.setItem(BEFORE_KEY, JSON.stringify(snap))
      } catch {
        /* utan sparad bild finns Ångra i rutan kvar */
      }
      set({ restore: restoreInfo(snap) })
      const fewer = open.length - lines.length
      showToast(fewer > 0 ? `Listan städades: ${count(open.length, 'rad', 'rader')} blev ${lines.length}` : 'Listan städades', restoreBeforeTidy)
    }
    if (failed) set({ message: `AI:n kunde inte gå igenom listan. ${failed}` })
    else rememberTidied(lines)
  } finally {
    set({ running: false })
  }
}

/**
 * Slår ihop rader som användaren själv pekat ut, och kommer ihåg att de är samma vara så att
 * de slås ihop av sig själva nästa gång (även utan AI). `ids` = de valda raderna, `as` = namnet
 * raden ska få (annars det kortaste av de valda).
 */
export async function mergeByHand(ids: string[], as?: string): Promise<string | null> {
  const open = (await db.shopping.toArray()).filter((i) => !i.done)
  const rows = ids.map((id) => open.findIndex((i) => i.id === id)).filter((r) => r >= 0)
  if (rows.length < 2) return null
  const lines: MergeLine[] = open.map((i) => ({ name: i.name, ...(i.amount ? { amount: i.amount } : {}), ...(i.note ? { note: i.note } : {}), ...(i.section ? { section: i.section } : {}) }))
  const merged = mergeRows(lines, [{ rows, ...(as ? { name: as } : {}) }])
  const name = merged[Math.min(...rows)].name
  const settings = await getSettings()
  const aliases = { ...(settings.food.aliases ?? {}) }
  for (const r of rows) if (aliasKey(lines[r].name) !== aliasKey(name)) aliases[aliasKey(lines[r].name)] = name
  const before = await db.shopping.toArray()
  await replaceOpenShopping(merged)
  await saveSettings({ food: { ...settings.food, aliases } })
  // Ångra tar tillbaka både raderna och det appen lärde sig, så att de inte slås ihop igen direkt.
  showToast(`${rows.length} rader slogs ihop till ${name}`, async () => {
    await db.transaction('rw', db.shopping, async () => {
      await db.shopping.clear()
      await db.shopping.bulkPut(before)
    })
    const now = await getSettings()
    await saveSettings({ food: { ...now.food, aliases: settings.food.aliases ?? {} } })
  })
  // Den nya raden är redan genomgången: den ska inte starta en ny AI-körning.
  rememberTidied([...[...tidiedKeys()].map((k) => ({ name: k.split('|')[0], amount: k.split('|')[1] })), merged[Math.min(...rows)]])
  return name
}
