import { DEFAULT_MODEL } from '../ai/models'
import { toISODate } from '../domain/dates'
import { foodKey } from '../domain/food'
import type { AiConfig, Backup, ChatMessage, FoodSettings, NutritionSettings, PantryItem, Settings, ShoppingItem } from '../domain/types'
import { db } from './db'

export const newId = () => crypto.randomUUID()

export const DEFAULT_FOOD: FoodSettings = {
  allergies: '',
  portions: 2,
  weekWishes: '',
  quickWeekdays: [],
  trainingWeekdays: [],
  breakfastWeekdays: [],
  lunchWeekdays: [],
  batchWeekdays: [],
  boxPortions: 1,
  shopping: { enabled: true, weekday: 5, time: '16:00' },
  expiry: { enabled: true, time: '08:00' },
}

export const DEFAULT_NUTRITION: NutritionSettings = { waterMl: 2000, glassMl: 250 }

export async function getAiConfig(): Promise<AiConfig> {
  return (await db.aiConfig.get('main')) ?? { id: 'main', password: '', model: DEFAULT_MODEL }
}

export async function saveAiConfig(patch: Partial<Omit<AiConfig, 'id'>>): Promise<void> {
  await db.aiConfig.put({ ...(await getAiConfig()), ...patch })
}

export async function addChatMessage(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<string> {
  const id = newId()
  // Strikt stigande tidsstämplar, så att meddelanden som skapas på samma millisekund behåller sin ordning.
  const last = await db.chat.orderBy('createdAt').last()
  let at = Date.now()
  if (last && at <= new Date(last.createdAt).getTime()) at = new Date(last.createdAt).getTime() + 1
  await db.chat.add({ ...m, id, createdAt: new Date(at).toISOString() })
  return id
}

export async function setCardStatus(id: string, cardStatus: NonNullable<ChatMessage['cardStatus']>): Promise<void> {
  await db.chat.update(id, { cardStatus })
}

export async function clearChat(): Promise<void> {
  await db.chat.clear()
}

export async function savePantryItem(item: PantryItem): Promise<void> {
  await db.pantry.put({ ...item, updatedAt: new Date().toISOString() })
}

export async function deletePantryItem(id: string): Promise<void> {
  await db.pantry.delete(id)
}

export async function saveShoppingItem(item: ShoppingItem): Promise<void> {
  await db.shopping.put({ ...item, updatedAt: new Date().toISOString() })
}

export async function deleteShoppingItem(id: string): Promise<void> {
  await db.shopping.delete(id)
}

export interface PantryDraft {
  name: string
  amount?: string
  expires?: string
}

export async function addPantryItems(
  drafts: PantryDraft[],
  source: PantryItem['source'],
  opts: { clearFromList?: boolean; today?: string } = {},
): Promise<{ added: number; removedFromList: number }> {
  const today = opts.today ?? toISODate(new Date())
  return db.transaction('rw', db.pantry, db.shopping, async () => {
    let added = 0
    for (const d of drafts) {
      const name = d.name.trim()
      if (!name) continue
      await db.pantry.add({
        id: newId(),
        name,
        ...(d.amount?.trim() ? { amount: d.amount.trim() } : {}),
        ...(d.expires ? { expires: d.expires } : {}),
        addedAt: today,
        source,
        updatedAt: new Date().toISOString(),
      })
      added++
    }
    let removedFromList = 0
    if (opts.clearFromList) {
      const names = new Set(drafts.map((d) => foodKey(d.name)))
      const hits = (await db.shopping.toArray()).filter((i) => !i.done && names.has(foodKey(i.name)))
      await db.shopping.bulkDelete(hits.map((i) => i.id))
      removedFromList = hits.length
    }
    return { added, removedFromList }
  })
}

export interface ShoppingDraft {
  name: string
  amount?: string
  note?: string
}

export async function addShoppingItems(drafts: ShoppingDraft[], today = toISODate(new Date())): Promise<{ added: number; skipped: number }> {
  return db.transaction('rw', db.shopping, async () => {
    const open = new Set((await db.shopping.toArray()).filter((i) => !i.done).map((i) => foodKey(i.name)))
    let added = 0
    let skipped = 0
    for (const d of drafts) {
      const name = d.name.trim()
      if (!name || open.has(foodKey(name))) {
        skipped++
        continue
      }
      open.add(foodKey(name))
      await db.shopping.add({
        id: newId(),
        name,
        ...(d.amount?.trim() ? { amount: d.amount.trim() } : {}),
        ...(d.note?.trim() ? { note: d.note.trim() } : {}),
        done: false,
        addedAt: today,
        updatedAt: new Date().toISOString(),
      })
      added++
    }
    return { added, skipped }
  })
}

export async function moveBoughtToPantry(today = toISODate(new Date())): Promise<number> {
  return db.transaction('rw', db.shopping, db.pantry, async () => {
    const bought = (await db.shopping.toArray()).filter((i) => i.done)
    for (const i of bought) {
      await db.pantry.add({
        id: newId(),
        name: i.name,
        ...(i.amount ? { amount: i.amount } : {}),
        addedAt: today,
        source: 'shopping',
        updatedAt: new Date().toISOString(),
      })
      await db.shopping.delete(i.id)
    }
    return bought.length
  })
}

export async function clearBought(): Promise<void> {
  const ids = (await db.shopping.toArray()).filter((i) => i.done).map((i) => i.id)
  await db.shopping.bulkDelete(ids)
}

export async function runOut(pantryId: string, addToList: boolean): Promise<void> {
  const item = await db.pantry.get(pantryId)
  if (!item) return
  if (addToList) await addShoppingItems([{ name: item.name, amount: item.amount }])
  await db.pantry.delete(pantryId)
}

export async function addWater(date: string, deltaMl: number): Promise<number> {
  return db.transaction('rw', db.water, async () => {
    const current = (await db.water.get(date))?.ml ?? 0
    const ml = Math.max(0, Math.min(20_000, Math.round(current + deltaMl)))
    await db.water.put({ id: date, date, ml, updatedAt: new Date().toISOString() })
    return ml
  })
}

export function defaultSettings(): Settings {
  return { id: 'main', theme: 'system', food: DEFAULT_FOOD, nutrition: DEFAULT_NUTRITION, memories: [] }
}

/** Äldre sparade inställningar saknar fält som tillkommit senare. */
export function withDefaults(stored: Settings | undefined): Settings {
  const d = defaultSettings()
  if (!stored) return d
  const food = stored.food ?? DEFAULT_FOOD
  return {
    ...d,
    ...stored,
    nutrition: { ...DEFAULT_NUTRITION, ...(stored.nutrition ?? {}) },
    memories: Array.isArray(stored.memories) ? stored.memories : [],
    food: { ...DEFAULT_FOOD, ...food, shopping: { ...DEFAULT_FOOD.shopping, ...(food.shopping ?? {}) }, expiry: { ...DEFAULT_FOOD.expiry, ...(food.expiry ?? {}) } },
  }
}

export async function getSettings(): Promise<Settings> {
  return withDefaults(await db.settings.get('main'))
}

export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ ...(await getSettings()), ...patch })
  })
}

export async function exportAll(): Promise<Backup> {
  return {
    app: 'matplanerare',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: (await db.settings.get('main')) ?? null,
    pantry: await db.pantry.toArray(),
    shopping: await db.shopping.toArray(),
    water: await db.water.toArray(),
    mealPlan: await db.mealPlan.toArray(),
    sides: await db.sides.toArray(),
    ratings: await db.ratings.toArray(),
  }
}

/** Ersätter all data med innehållet i säkerhetskopian. */
export async function importAll(backup: Backup): Promise<void> {
  await db.transaction('rw', [db.settings, db.pantry, db.shopping, db.water, db.mealPlan, db.sides, db.ratings], async () => {
    await Promise.all([db.settings.clear(), db.pantry.clear(), db.shopping.clear(), db.water.clear(), db.mealPlan.clear(), db.sides.clear(), db.ratings.clear()])
    if (backup.settings) await db.settings.put(backup.settings)
    await db.pantry.bulkPut(backup.pantry)
    await db.shopping.bulkPut(backup.shopping)
    await db.water.bulkPut(backup.water)
    await db.mealPlan.bulkPut(backup.mealPlan)
    await db.sides.bulkPut(backup.sides)
    await db.ratings.bulkPut(backup.ratings)
  })
}

/** Nyckel för en rätt, så att "Pasta Carbonara" och "pasta carbonara" blir samma. */
export const dishId = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100)

/** Sätter tumme upp/ner på en rätt; samma tumme igen tar bort betyget. */
export async function rateDish(dish: { title: string; date?: string; url?: string; site?: string }, rating: 1 | -1): Promise<void> {
  const id = dishId(dish.title)
  if (!id) return
  const existing = await db.ratings.get(id)
  if (existing?.rating === rating) {
    await db.ratings.delete(id)
    return
  }
  await db.ratings.put({
    id,
    title: dish.title.trim().slice(0, 100),
    rating,
    ...(dish.date ? { date: dish.date } : {}),
    ...(dish.url ? { url: dish.url, ...(dish.site ? { site: dish.site } : {}) } : {}),
    updatedAt: new Date().toISOString(),
  })
}
