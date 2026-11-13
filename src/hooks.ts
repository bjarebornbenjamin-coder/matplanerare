import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from './db/db'
import { getAiConfig, withDefaults } from './db/repo'
import { withAnswers } from './domain/onboarding'
import { useOnboarding } from './lib/onboarding'
import type { AiConfig, DishRating, PantryItem, PlannedDinner, PlannedSide, Settings, ShoppingItem } from './domain/types'

/** undefined medan data läses från IndexedDB. */
export function useSettings(): Settings | undefined {
  const stored = useLiveQuery(async () => withDefaults(await db.settings.get('main')), [])
  // Svaren från frågorna före inloggningen gäller direkt, även innan de hunnit sparas.
  const { answers } = useOnboarding()
  return useMemo(() => (stored && answers ? withAnswers(stored, answers) : stored), [stored, answers])
}


export function usePantry(): PantryItem[] | undefined {
  return useLiveQuery(() => db.pantry.toArray(), [])
}
export function useShopping(): ShoppingItem[] | undefined {
  return useLiveQuery(() => db.shopping.toArray(), [])
}
export function useMealPlan(): PlannedDinner[] | undefined {
  return useLiveQuery(() => db.mealPlan.toArray(), [])
}
export function useRatings(): DishRating[] | undefined {
  return useLiveQuery(() => db.ratings.toArray(), [])
}
export function useSides(): PlannedSide[] | undefined {
  return useLiveQuery(() => db.sides.toArray(), [])
}
export function useAiConfig(): AiConfig | undefined {
  return useLiveQuery(() => getAiConfig(), [])
}

/** Aktuell tid, uppdateras varje minut. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Ett felmeddelande kopplat till ett fält; försvinner när det fältet ändras. */
export function useFieldError() {
  const [state, setState] = useState<{ field: string; message: string } | null>(null)
  const fail = useCallback((field: string, message: string) => setState({ field, message }), [])
  const touch = useCallback((field: string) => setState((e) => (e && e.field === field ? null : e)), [])
  return { error: state?.message ?? '', fail, touch }
}

