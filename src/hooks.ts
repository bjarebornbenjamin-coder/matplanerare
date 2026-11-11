import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { db } from './db/db'
import { getAiConfig, withDefaults } from './db/repo'
import type { AiConfig, ChatMessage, DishRating, PantryItem, PlannedDinner, PlannedSide, Settings, ShoppingItem, WaterDay } from './domain/types'

/** undefined medan data läses från IndexedDB. */
export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => withDefaults(await db.settings.get('main')), [])
}


export function usePantry(): PantryItem[] | undefined {
  return useLiveQuery(() => db.pantry.toArray(), [])
}
export function useShopping(): ShoppingItem[] | undefined {
  return useLiveQuery(() => db.shopping.toArray(), [])
}
export function useWater(): WaterDay[] | undefined {
  return useLiveQuery(() => db.water.toArray(), [])
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
export function useChat(): ChatMessage[] | undefined {
  return useLiveQuery(() => db.chat.orderBy('createdAt').toArray(), [])
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

