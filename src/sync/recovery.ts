import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

/**
 * Glömt lösenord. Länken i mejlet från Supabase leder tillbaka hit och loggar in användaren.
 * Då ska sidan för nytt lösenord visas i stället för appen, tills ett nytt lösenord är valt
 * eller steget hoppats över.
 */

interface RecoveryState {
  /** Användaren kom hit via länken och ska välja nytt lösenord. */
  active: boolean
  /** Adressen innehåller en sådan länk, men inloggningen är inte klar än (gäller bara den här sidladdningen). */
  pending: boolean
  /** Länken gick inte att använda (för gammal eller redan använd). */
  linkError: boolean
}

const KEY = 'matplanerare-recovery'

/** Vad adressens fragment säger: en länk för nytt lösenord, en länk som inte gäller längre, eller inget. */
export function readRecoveryLink(hash: string): 'recovery' | 'error' | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.get('error') || params.get('error_code') || params.get('error_description')) return 'error'
  return params.get('type') === 'recovery' && params.get('access_token') ? 'recovery' : null
}

function initial(): RecoveryState {
  let active = false
  let link: ReturnType<typeof readRecoveryLink> = null
  try {
    // Laddas sidan om innan lösenordet är valt ska steget stå kvar.
    active = sessionStorage.getItem(KEY) === '1'
    link = readRecoveryLink(window.location.hash)
    // En länk som inte gäller längre lämnar ett felmeddelande i adressen: ta bort det.
    if (link === 'error') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  } catch {
    /* ingen webbläsare (tester) eller blockerad lagring */
  }
  return { active, pending: link === 'recovery', linkError: link === 'error' }
}

let state: RecoveryState = initial()
const listeners = new Set<() => void>()
function set(patch: Partial<RecoveryState>): void {
  state = { ...state, ...patch }
  try {
    if (state.active) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* utan lagring gäller steget bara tills sidan laddas om */
  }
  listeners.forEach((l) => l())
}

// Supabase säger till när inloggningen via länken är klar. En vanlig inloggning efter en
// länk som inte fungerade ska däremot inte leda till sidan för nytt lösenord.
supabase?.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') set({ active: true, pending: false, linkError: false })
  else if (event === 'SIGNED_IN' && !state.active) set({ pending: false })
})

export function useRecovery(): RecoveryState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** Nytt lösenord är valt, eller steget hoppades över. */
export function endRecovery(): void {
  set({ active: false, pending: false })
}

/** Felmeddelandet om länken är läst. */
export function dismissLinkError(): void {
  if (state.linkError) set({ linkError: false })
}
