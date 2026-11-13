import { useSyncExternalStore } from 'react'
import { hasAnswers, parseAnswers, type Answers } from '../domain/onboarding'

/**
 * Läget för frågorna före inloggningen. Svaren ligger i webbläsaren tills man loggat in: skrevs
 * de in i inställningarna direkt skulle en ny enhet skriva över inställningarna på ett konto som
 * redan finns. I stället läggs de ovanpå inställningarna när de läses, och sparas på riktigt
 * först när kontots inställningar har hämtats.
 */

interface State {
  /** Frågorna är besvarade eller överhoppade på den här enheten. */
  done: boolean
  /** Svaren, så länge de inte har sparats i inställningarna. */
  answers: Answers | null
}

const KEY = 'matplanerare-onboarding'

function read(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { done?: unknown; answers?: unknown } | null
    return { done: raw?.done === true, answers: parseAnswers(raw?.answers) }
  } catch {
    return { done: false, answers: null }
  }
}

let state: State = read()
const listeners = new Set<() => void>()

function set(next: State): void {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* går inte att spara: frågorna ställs igen nästa gång */
  }
  listeners.forEach((l) => l())
}

export function useOnboarding(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** Svar som väntar på att sparas i inställningarna. */
export const pendingAnswers = (): Answers | null => state.answers

/** Frågorna är klara. `answers` = null när de hoppades över. */
export function finishOnboarding(answers: Answers | null): void {
  const clean = parseAnswers(answers)
  set({ done: true, answers: clean && hasAnswers(clean) ? clean : null })
}

/** Visa frågorna igen (svaren finns kvar ifyllda). */
export function reopenOnboarding(): void {
  set({ ...state, done: false })
}

/** Svaren är sparade i inställningarna och behöver inte längre läggas ovanpå. */
export function clearPendingAnswers(): void {
  if (state.answers) set({ ...state, answers: null })
}
