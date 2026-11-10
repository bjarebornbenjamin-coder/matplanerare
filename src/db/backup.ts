import { DEFAULT_FOOD, DEFAULT_NUTRITION } from './repo'
import type { Backup, PantryItem, PlannedDinner, Settings, ShoppingItem, WaterDay } from '../domain/types'

const fail = (msg: string): never => {
  throw new Error(`Ogiltig säkerhetskopia: ${msg}`)
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isStr = (v: unknown): v is string => typeof v === 'string'
const isDate = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isTime = (v: unknown) => isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

const weekdays = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [])

function parseSettings(v: unknown): Settings {
  if (!isObj(v)) return fail('inställningar saknas')
  const theme = v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system'
  const f = isObj(v.food) ? v.food : {}
  const sh = isObj(f.shopping) ? f.shopping : {}
  const ex = isObj(f.expiry) ? f.expiry : {}
  const food = {
    allergies: isStr(f.allergies) ? f.allergies.slice(0, 500) : DEFAULT_FOOD.allergies,
    portions: typeof f.portions === 'number' && f.portions >= 1 && f.portions <= 12 ? Math.round(f.portions) : DEFAULT_FOOD.portions,
    quickWeekdays: weekdays(f.quickWeekdays),
    trainingWeekdays: weekdays(f.trainingWeekdays),
    shopping: {
      enabled: typeof sh.enabled === 'boolean' ? sh.enabled : DEFAULT_FOOD.shopping.enabled,
      weekday: typeof sh.weekday === 'number' && sh.weekday >= 1 && sh.weekday <= 7 ? sh.weekday : DEFAULT_FOOD.shopping.weekday,
      time: isTime(sh.time) ? (sh.time as string) : DEFAULT_FOOD.shopping.time,
    },
    expiry: { enabled: typeof ex.enabled === 'boolean' ? ex.enabled : DEFAULT_FOOD.expiry.enabled, time: isTime(ex.time) ? (ex.time as string) : DEFAULT_FOOD.expiry.time },
  }
  const nu = isObj(v.nutrition) ? v.nutrition : {}
  const n = (x: unknown, min: number, max: number, d: number) => (typeof x === 'number' && x >= min && x <= max ? Math.round(x) : d)
  const nutrition = {
    waterMl: n(nu.waterMl, 0, 20000, DEFAULT_NUTRITION.waterMl),
    glassMl: n(nu.glassMl, 50, 2000, DEFAULT_NUTRITION.glassMl),
  }
  const memories = Array.isArray(v.memories) ? v.memories.filter((m): m is string => isStr(m) && m.trim() !== '').map((m) => m.trim().slice(0, 200)).slice(0, 30) : []
  return { id: 'main', theme, food, nutrition, memories }
}

const SOURCES = ['manual', 'receipt', 'fridge', 'shopping']

function parsePantry(v: unknown): PantryItem {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !v.name.trim() || !isDate(v.addedAt)) return fail('matvara')
  if (v.expires !== undefined && !isDate(v.expires)) fail('bäst före-datum')
  return {
    id: v.id,
    name: v.name,
    ...(isStr(v.amount) && v.amount ? { amount: v.amount } : {}),
    ...(v.expires !== undefined ? { expires: v.expires as string } : {}),
    addedAt: v.addedAt as string,
    source: SOURCES.includes(v.source as string) ? (v.source as PantryItem['source']) : 'manual',
    updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString(),
  }
}

function parseShopping(v: unknown): ShoppingItem {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !v.name.trim()) return fail('inköpsvara')
  return {
    id: v.id,
    name: v.name,
    ...(isStr(v.amount) && v.amount ? { amount: v.amount } : {}),
    done: v.done === true,
    ...(isStr(v.note) && v.note ? { note: v.note } : {}),
    addedAt: isDate(v.addedAt) ? (v.addedAt as string) : new Date().toISOString().slice(0, 10),
    updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString(),
  }
}

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined)

function parseWater(v: unknown): WaterDay {
  if (!isObj(v) || !isDate(v.date) || v.id !== v.date) return fail('vattenrad')
  const ml = num(v.ml, 0, 20000)
  if (ml === undefined) return fail('vattenmängd')
  return { id: v.date as string, date: v.date as string, ml: Math.round(ml), updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString() }
}

function parseDinner(v: unknown): PlannedDinner {
  if (!isObj(v) || !isDate(v.date) || v.id !== v.date || !isStr(v.title) || !v.title.trim()) return fail('middag i veckomenyn')
  const ingredients = (Array.isArray(v.ingredients) ? v.ingredients : []).filter(isObj).filter((i) => isStr(i.name) && i.name.trim()).map((i) => ({ name: (i.name as string).slice(0, 60), amount: isStr(i.amount) ? i.amount.slice(0, 30) : '' })).slice(0, 30)
  const steps = (Array.isArray(v.steps) ? v.steps : []).filter(isStr).map((s) => s.slice(0, 500)).slice(0, 14)
  const minutes = num(v.minutes, 0, 600)
  return {
    id: v.date as string,
    date: v.date as string,
    title: v.title.slice(0, 100),
    reason: isStr(v.reason) ? v.reason.slice(0, 300) : '',
    portions: num(v.portions, 1, 24) ?? 2,
    minutes: minutes ?? null,
    ingredients,
    steps,
    ...(isStr(v.url) && v.url.startsWith('https://') ? { url: v.url.slice(0, 500), ...(isStr(v.site) ? { site: v.site.slice(0, 60) } : {}) } : {}),
    updatedAt: isStr(v.updatedAt) ? v.updatedAt : new Date().toISOString(),
  }
}

export function parseBackup(json: unknown): Backup {
  if (!isObj(json) || json.app !== 'matplanerare') return fail('filen kommer inte från Matplaneraren')
  if (json.version !== 1) return fail(`okänd version (${String(json.version)})`)
  const list = <T,>(v: unknown, parse: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map(parse) : [])
  return {
    app: 'matplanerare',
    version: 1,
    exportedAt: isStr(json.exportedAt) ? json.exportedAt : new Date().toISOString(),
    settings: json.settings == null ? null : parseSettings(json.settings),
    pantry: list(json.pantry, parsePantry),
    shopping: list(json.shopping, parseShopping),
    water: list(json.water, parseWater),
    mealPlan: list(json.mealPlan, parseDinner),
  }
}
