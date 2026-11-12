import { useSyncExternalStore } from 'react'
import { planShopping } from '../ai/shoppingPlan'
import { db } from '../db/db'
import { getAiConfig, replaceOpenShopping } from '../db/repo'
import { foodKey } from '../domain/food'
import { mergeShopping } from '../domain/shoppingMerge'
import { authHeaders } from './auth'
import { undoable } from './undo'

/**
 * AI:n går igenom inköpslistan: slår ihop samma vara ("Röda lökar" och "Rödlök"), rensar namnen,
 * räknar om mängderna och sorterar till butikens avdelningar. Det sker automatiskt när listan
 * öppnas, men bara när det tillkommit varor sedan förra genomgången, så att AI:n inte anropas i
 * onödan. Går AI:n inte att nå slås åtminstone säkra dubbletter ihop direkt i appen.
 */

interface TidyState {
  running: boolean
  /** Felmeddelande när "Städa med AI" inte gick att köra. Lyckade genomgångar visas i rutan med Ångra. */
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

const KEY = 'matplanerare-shopping-tidied'
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
  const local = async () => {
    const r = mergeShopping(open)
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
    const lines = await planShopping({ needs: [], pantry, current: open }, config.model, headers)
    const fewer = open.length - lines.length
    const text = fewer > 0 ? `AI:n gick igenom listan: ${count(open.length, 'rad', 'rader')} blev ${lines.length}.` : 'AI:n gick igenom listan.'
    await undoable(text, ['shopping'], () => replaceOpenShopping(lines))
    rememberTidied(lines)
  } catch (e) {
    // AI:n gick inte att nå: slå åtminstone ihop det som säkert är samma vara.
    await local()
    set({ message: opts.force ? (e instanceof Error ? e.message : 'Kunde inte städa listan.') : '' })
  } finally {
    set({ running: false })
  }
}
