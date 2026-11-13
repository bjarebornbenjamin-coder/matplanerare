import { DEFAULT_MODEL } from '../ai/models'
import { toISODate } from '../domain/dates'
import { foodKey } from '../domain/food'
import { sameShoppingItem } from '../domain/consume'
import { isSection } from '../domain/storeSection'
import type { AiConfig, Backup, FoodSettings, PantryItem, Settings, ShoppingItem } from '../domain/types'
import { db } from './db'
import { withAnswers } from '../domain/onboarding'
import { clearPendingAnswers, pendingAnswers } from '../lib/onboarding'

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

export async function getAiConfig(): Promise<AiConfig> {
  return (await db.aiConfig.get('main')) ?? { id: 'main', password: '', model: DEFAULT_MODEL }
}

export async function saveAiConfig(patch: Partial<Omit<AiConfig, 'id'>>): Promise<void> {
  await db.aiConfig.put({ ...(await getAiConfig()), ...patch })
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
  /** Avdelning i butiken (från AI:n). */
  section?: string
}

export async function addShoppingItems(drafts: ShoppingDraft[], today = toISODate(new Date())): Promise<{ added: number; skipped: number }> {
  return db.transaction('rw', db.shopping, async () => {
    // Samma vara under ett annat namn ("Lök" när "Gul lök" redan står där) läggs inte till igen.
    const open = (await db.shopping.toArray()).filter((i) => !i.done).map((i) => i.name)
    let added = 0
    let skipped = 0
    for (const d of drafts) {
      const name = d.name.trim()
      if (!name || open.some((o) => foodKey(o) === foodKey(name) || sameShoppingItem(o, name))) {
        skipped++
        continue
      }
      open.push(name)
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

/** Lägger till rader utan att jämföra med listan. Samma vara slås ihop när listan städas. */
export async function appendShoppingItems(drafts: ShoppingDraft[], today = toISODate(new Date())): Promise<number> {
  const stamp = new Date().toISOString()
  const items = drafts
    .filter((d) => d.name.trim())
    .map((d) => ({
      id: newId(),
      name: d.name.trim(),
      ...(d.amount?.trim() ? { amount: d.amount.trim() } : {}),
      ...(d.note?.trim() ? { note: d.note.trim() } : {}),
      ...(isSection(d.section) ? { section: d.section } : {}),
      done: false,
      addedAt: today,
      updatedAt: stamp,
    }))
  await db.shopping.bulkAdd(items)
  return items.length
}

/**
 * Ersätter det som inte är köpt med en ny, sammanslagen lista. Köpta varor rörs inte. En vara
 * som finns kvar behåller sitt id (och när den lades till), så att synken inte ser den som ny.
 */
export async function replaceOpenShopping(lines: ShoppingDraft[], today = toISODate(new Date())): Promise<number> {
  return db.transaction('rw', db.shopping, async () => {
    const open = (await db.shopping.toArray()).filter((i) => !i.done)
    const byKey = new Map(open.map((i) => [foodKey(i.name), i]))
    const keep = new Set<string>()
    const stamp = new Date().toISOString()
    for (const l of lines) {
      const name = l.name.trim()
      if (!name) continue
      const old = byKey.get(foodKey(name))
      const item = {
        id: old && !keep.has(old.id) ? old.id : newId(),
        name,
        ...(l.amount?.trim() ? { amount: l.amount.trim() } : {}),
        ...(l.note?.trim() ? { note: l.note.trim() } : {}),
        ...(isSection(l.section) ? { section: l.section } : {}),
        done: false,
        addedAt: old?.addedAt ?? today,
        updatedAt: stamp,
      }
      keep.add(item.id)
      await db.shopping.put(item)
    }
    await db.shopping.bulkDelete(open.filter((i) => !keep.has(i.id)).map((i) => i.id))
    return keep.size
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

export function defaultSettings(): Settings {
  return { id: 'main', theme: 'system', food: DEFAULT_FOOD, memories: [] }
}

/** Äldre sparade inställningar saknar fält som tillkommit senare. */
export function withDefaults(stored: Settings | undefined): Settings {
  const d = defaultSettings()
  if (!stored) return d
  const food = stored.food ?? DEFAULT_FOOD
  return {
    ...d,
    ...stored,
    memories: Array.isArray(stored.memories) ? stored.memories : [],
    food: { ...DEFAULT_FOOD, ...food, shopping: { ...DEFAULT_FOOD.shopping, ...(food.shopping ?? {}) }, expiry: { ...DEFAULT_FOOD.expiry, ...(food.expiry ?? {}) } },
  }
}

/** Inställningarna, med svaren från frågorna före inloggningen ovanpå så länge de inte är sparade. */
export async function getSettings(): Promise<Settings> {
  const stored = withDefaults(await db.settings.get('main'))
  const answers = pendingAnswers()
  return answers ? withAnswers(stored, answers) : stored
}

export async function saveSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ ...(await getSettings()), ...patch })
  })
  // Svaren följde med in i det som sparades, och ska inte läggas ovanpå en gång till.
  clearPendingAnswers()
}

/**
 * Sparar svaren från frågorna före inloggningen i inställningarna. Anropas när kontots
 * inställningar har hämtats (eller direkt, när appen körs utan konto), så att svaren läggs
 * till det som redan finns i stället för att ersätta det.
 */
export async function savePendingAnswers(): Promise<void> {
  if (pendingAnswers()) await saveSettings({})
}

export async function exportAll(): Promise<Backup> {
  return {
    app: 'matplanerare',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: (await db.settings.get('main')) ?? null,
    pantry: await db.pantry.toArray(),
    shopping: await db.shopping.toArray(),
    mealPlan: await db.mealPlan.toArray(),
    sides: await db.sides.toArray(),
    ratings: await db.ratings.toArray(),
  }
}

/** Ersätter all data med innehållet i säkerhetskopian. */
export async function importAll(backup: Backup): Promise<void> {
  await db.transaction('rw', [db.settings, db.pantry, db.shopping, db.mealPlan, db.sides, db.ratings], async () => {
    await Promise.all([db.settings.clear(), db.pantry.clear(), db.shopping.clear(), db.mealPlan.clear(), db.sides.clear(), db.ratings.clear()])
    if (backup.settings) await db.settings.put(backup.settings)
    await db.pantry.bulkPut(backup.pantry)
    await db.shopping.bulkPut(backup.shopping)
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

export interface PantryChange {
  id: string
  /** Ny mängd, eller remove när varan tagit slut. */
  amount?: string
  remove?: boolean
}

/**
 * "Jag åt detta": drar av det som gått åt ur lagret och markerar rätten som uppäten.
 * Körs i en transaktion så att lagret och menyn alltid hänger ihop.
 */
export async function markEaten(target: { table: 'mealPlan' | 'sides'; id: string }, changes: PantryChange[], eaten = true): Promise<void> {
  const stamp = new Date().toISOString()
  await db.transaction('rw', db.pantry, db.mealPlan, db.sides, async () => {
    for (const c of changes) {
      if (c.remove) await db.pantry.delete(c.id)
      else if (c.amount) await db.pantry.update(c.id, { amount: c.amount, updatedAt: stamp })
    }
    if (target.table === 'mealPlan') await db.mealPlan.update(target.id, { eaten, updatedAt: stamp })
    else await db.sides.update(target.id, { eaten, updatedAt: stamp })
  })
}
