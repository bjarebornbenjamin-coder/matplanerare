import { db } from '../db/db'
import { addPantryItems, addShoppingItems, addWater, deleteShoppingItem, getSettings, savePantryItem, saveSettings, saveShoppingItem } from '../db/repo'
import { parseISODate } from '../domain/dates'
import { foodKey } from '../domain/food'
import type { ChatCard } from '../domain/types'

const shortDate = (d: string) => parseISODate(d).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })
const dayLabel = (d: string) => parseISODate(d).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })

export interface CardView {
  kicker: string
  title: string
  lines: string[]
  confirmLabel: string
  doneText: string
  danger?: boolean
}

export function cardView(card: ChatCard): CardView {
  switch (card.type) {
    case 'shopping_update':
      return {
        kicker: 'Förslag: inköpslistan',
        title: [card.bought.length && `Köpt: ${card.bought.join(', ')}`, card.removed.length && `Ta bort: ${card.removed.join(', ')}`].filter(Boolean).join(' · '),
        lines: [],
        confirmLabel: 'Uppdatera listan',
        doneText: 'Inköpslistan är uppdaterad.',
      }
    case 'pantry_update':
      return {
        kicker: 'Förslag: ändra vara i lagret',
        title: card.before,
        lines: [`Blir: ${[card.after.name, card.after.amount, card.after.expires && `bäst före ${shortDate(card.after.expires)}`].filter(Boolean).join(', ')}`],
        confirmLabel: 'Ändra',
        doneText: 'Varan är ändrad.',
      }
    case 'prefs_update':
      return { kicker: 'Förslag: ändra inställningar', title: card.summary.join(' · '), lines: [], confirmLabel: 'Spara', doneText: 'Inställningarna är sparade.' }
    case 'memory_add':
      return { kicker: 'Förslag: kom ihåg', title: card.fact, lines: ['Används i framtida svar. Visas och kan tas bort under Inställningar.'], confirmLabel: 'Kom ihåg', doneText: 'Sparat i minnet.' }
    case 'memory_delete':
      return { kicker: 'Förslag: glöm', title: card.fact, lines: [], confirmLabel: 'Glöm', doneText: 'Borttaget ur minnet.', danger: true }
    case 'water_add':
      return { kicker: 'Förslag: vatten', title: `+${card.ml} ml vatten`, lines: [dayLabel(card.date)], confirmLabel: 'Lägg till', doneText: 'Vattnet är tillagt.' }
    case 'shopping_add':
      return { kicker: 'Förslag: inköpslistan', title: `Lägg på listan: ${card.items.map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name)).join(', ')}`, lines: [], confirmLabel: 'Lägg på listan', doneText: 'Lagt på inköpslistan.' }
    case 'pantry_add':
      return { kicker: 'Förslag: matlagret', title: `Lägg i lagret: ${card.items.map((i) => (i.amount ? `${i.name} (${i.amount})` : i.name)).join(', ')}`, lines: [], confirmLabel: 'Lägg i lagret', doneText: 'Lagt i matlagret.' }
    case 'pantry_remove':
      return { kicker: 'Förslag: matlagret', title: `Ta bort ur lagret: ${card.names.join(', ')}`, lines: [], confirmLabel: 'Ta bort', doneText: 'Borttaget ur lagret.', danger: true }
  }
}

/** Genomför ett förslag som användaren bekräftat. */
export async function applyCard(card: ChatCard): Promise<'done' | 'missing'> {
  switch (card.type) {
    case 'shopping_update': {
      const items = (await db.shopping.bulkGet([...card.boughtIds, ...card.removeIds])).filter(Boolean)
      if (items.length === 0) return 'missing'
      for (const id of card.boughtIds) {
        const i = await db.shopping.get(id)
        if (i) await saveShoppingItem({ ...i, done: true })
      }
      for (const id of card.removeIds) await deleteShoppingItem(id)
      return 'done'
    }
    case 'pantry_update': {
      const p = await db.pantry.get(card.id)
      if (!p) return 'missing'
      const { amount: _a, expires: _e, ...rest } = p
      void _a
      void _e
      await savePantryItem({ ...rest, ...card.after })
      return 'done'
    }
    case 'prefs_update': {
      const s = await getSettings()
      await saveSettings({ food: { ...s.food, ...card.food }, nutrition: { ...s.nutrition, ...card.nutrition } })
      return 'done'
    }
    case 'memory_add': {
      const s = await getSettings()
      if (!s.memories.some((m) => foodKey(m) === foodKey(card.fact))) await saveSettings({ memories: [...s.memories, card.fact].slice(-30) })
      return 'done'
    }
    case 'memory_delete': {
      const s = await getSettings()
      if (!s.memories.includes(card.fact)) return 'missing'
      await saveSettings({ memories: s.memories.filter((m) => m !== card.fact) })
      return 'done'
    }
    case 'water_add':
      await addWater(card.date, card.ml)
      return 'done'
    case 'shopping_add':
      await addShoppingItems(card.items)
      return 'done'
    case 'pantry_add':
      await addPantryItems(card.items, 'manual')
      return 'done'
    case 'pantry_remove': {
      const existing = (await db.pantry.bulkGet(card.ids)).filter(Boolean)
      if (existing.length === 0) return 'missing'
      await db.pantry.bulkDelete(existing.map((p) => p!.id))
      return 'done'
    }
  }
}
