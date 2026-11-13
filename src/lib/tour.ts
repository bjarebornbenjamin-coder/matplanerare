import { useSyncExternalStore } from 'react'

/**
 * Rundturen som visas första gången man kommer in i appen: de viktigaste delarna lyses upp en
 * i taget med en kort förklaring. Att den är visad sparas i webbläsaren. Den går att starta
 * igen från Inställningar.
 */

interface TourState {
  active: boolean
  /** Rundturen är visad (eller överhoppad) på den här enheten. */
  done: boolean
}

const KEY = 'matplanerare-tour-done'

function wasShown(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let state: TourState = { active: false, done: wasShown() }
const listeners = new Set<() => void>()
function set(next: TourState): void {
  state = next
  listeners.forEach((l) => l())
}

export function useTour(): TourState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export function startTour(): void {
  set({ ...state, active: true })
}

/** Rundturen är klar eller överhoppad: den visas inte av sig själv igen. */
export function endTour(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* går inte att spara: rundturen visas en gång till nästa gång */
  }
  set({ active: false, done: true })
}
