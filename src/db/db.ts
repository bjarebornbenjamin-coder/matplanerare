import Dexie, { type Table } from 'dexie'
import type { AiConfig, ChatMessage, PantryItem, PlannedDinner, PlannedSide, Settings, ShoppingItem, WaterDay } from '../domain/types'

export class AppDB extends Dexie {
  settings!: Table<Settings, string>
  aiConfig!: Table<AiConfig, string>
  chat!: Table<ChatMessage, string>
  pantry!: Table<PantryItem, string>
  shopping!: Table<ShoppingItem, string>
  water!: Table<WaterDay, string>
  mealPlan!: Table<PlannedDinner, string>
  /** Frukost och lunch i veckomenyn. */
  sides!: Table<PlannedSide, string>
  /** Lokala, osynkade inställningar per enhet (t.ex. bakgrundsbild). */
  local!: Table<{ key: string; value: string; updatedAt: string }, string>
  /** Synk: innehållets hash vid senaste synk, per post. */
  syncState!: Table<{ key: string; hash: string }, string>
  syncMeta!: Table<{ key: 'main'; userId: string; cursor: string | null }, string>

  constructor(name = 'matplanerare') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      aiConfig: 'id',
      chat: 'id, createdAt',
      pantry: 'id, expires',
      shopping: 'id',
      meals: 'id, date',
      water: 'id',
      mealPlan: 'id, date',
      local: 'key',
      syncState: 'key',
      syncMeta: 'key',
    })
    // Kost-loggningen (kalorier och makron) är borttagen.
    this.version(2).stores({ meals: null })
    this.version(3).stores({ sides: 'id, date' })
  }
}

export const db = new AppDB()
