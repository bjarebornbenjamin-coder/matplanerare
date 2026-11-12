import { useSyncExternalStore } from 'react'
import { planShopping } from '../ai/shoppingPlan'
import { db } from '../db/db'
import { getAiConfig, getSettings, replaceOpenShopping, saveSettings } from '../db/repo'
import { aliasKey } from '../domain/consume'
import { foodKey } from '../domain/food'
import { mergeRows, mergeShopping, type MergeLine } from '../domain/shoppingMerge'
import { authHeaders } from './auth'
import { showToast, undoable } from './undo'

/**
 * AI:n går igenom inköpslistan: slår ihop samma vara ("Röda lökar" och "Rödlök"), rensar namnen,
 * räknar om mängderna och sorterar till butikens avdelningar. Det sker automatiskt när listan
 * öppnas, men bara när det tillkommit varor sedan förra genomgången, så att AI:n inte anropas i
 * onödan. Går AI:n inte att nå slås åtminstone säkra dubbletter ihop direkt i appen.
 */

interface TidyState {
  running: boolean
  /** Varför AI:n inte kunde gå igenom listan. Lyckade genomgångar visas i rutan med Ångra. */
  message: string
}

let state: TidyState = { running: false, message: '' }
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

// v2: genomgången fick en kontrollfråga om dubbletter, så listor som redan gåtts igenom tas en gång till.
const KEY = 'matplanerare-shopping-tidied-v2'
type Keyed = { name: string; amount?: string }
const keyOf = (i: Keyed) => `${foodKey(i.name)}|${(i.amount ?? '').trim().toLowerCase()}`

function tidiedKeys(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Kom ihåg vilka rader AI:n redan gått igenom. */
export function rememberTidied(lines: Keyed[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines.map(keyOf)))
  } catch {
    /* utan minne körs genomgången om nästa gång, vilket bara kostar ett anrop */
  }
}

/** Har det tillkommit varor sedan AI:n senast gick igenom listan? Avbockade och borttagna räknas inte. */
export function needsTidy(open: Keyed[], known: Set<string> = tidiedKeys()): boolean {
  return open.length >= 2 && open.some((i) => !known.has(keyOf(i)))
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Går igenom listan. `force` kör AI:n även om inget nytt tillkommit (knappen "Städa med AI").
 * Ändringen går att ångra.
 */
export async function tidyShopping(opts: { force?: boolean } = {}): Promise<void> {
  if (state.running) return
  const open = (await db.shopping.toArray()).filter((i) => !i.done)
  const aliases = (await getSettings()).food.aliases
  const local = async () => {
    const r = mergeShopping(open, aliases)
    if (r.changed) await undoable(r.merged > 0 ? `${count(r.merged, 'dubblett', 'dubbletter')} på inköpslistan slogs ihop` : 'Inköpslistan städades', ['shopping'], () => replaceOpenShopping(r.lines))
    return r
  }
  if (open.length < 2 || (!opts.force && !needsTidy(open))) {
    await local()
    return
  }
  set({ running: true, message: '' })
  try {
    const [pantry, config, headers] = await Promise.all([db.pantry.toArray(), getAiConfig(), authHeaders()])
    const lines = await planShopping({ needs: [], pantry, current: open, aliases }, config.model, headers)
    const fewer = open.length - lines.length
    const text = fewer > 0 ? `AI:n gick igenom listan: ${count(open.length, 'rad', 'rader')} blev ${lines.length}.` : 'AI:n gick igenom listan.'
    await undoable(text, ['shopping'], () => replaceOpenShopping(lines))
    rememberTidied(lines)
  } catch (e) {
    // AI:n gick inte att nå: slå åtminstone ihop det som säkert är samma vara, och säg varför
    // så att det inte ser ut som att AI:n gått igenom listan utan att hitta något.
    await local()
    set({ message: `AI:n kunde inte gå igenom listan. ${e instanceof Error ? e.message : 'Försök igen.'}` })
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
