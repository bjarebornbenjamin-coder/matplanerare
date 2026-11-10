import { useSyncExternalStore } from 'react'
import type { Table } from 'dexie'
import { db } from '../db/db'

interface Toast {
  id: number
  message: string
  undo?: () => Promise<void>
}

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function showToast(message: string, undo?: () => Promise<void>): void {
  clearTimeout(timer)
  current = { id: Date.now(), message, undo }
  emit()
  timer = setTimeout(() => {
    current = null
    emit()
  }, 6000)
}

export function hideToast(): void {
  clearTimeout(timer)
  current = null
  emit()
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

type TableName = 'pantry' | 'shopping' | 'meals' | 'mealPlan'

/**
 * Kör en ändring och visar en ruta med "Ångra". Ångra återställer de berörda tabellerna
 * till hur de såg ut precis före ändringen (datan är liten, så en kopia är billig och säker).
 */
export async function undoable(message: string, tables: TableName[], action: () => Promise<unknown>): Promise<void> {
  const before = await Promise.all(tables.map((t) => (db[t] as Table<{ id: string }, string>).toArray()))
  await action()
  showToast(message, async () => {
    await db.transaction('rw', tables.map((t) => db[t]), async () => {
      for (let i = 0; i < tables.length; i++) {
        const table = db[tables[i]] as Table<{ id: string }, string>
        await table.clear()
        await table.bulkPut(before[i])
      }
    })
  })
}
