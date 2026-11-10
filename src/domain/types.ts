export type ISODate = string // "YYYY-MM-DD", lokal tid
export type HHmm = string // "HH:mm", lokal tid

export type Theme = 'system' | 'light' | 'dark'

export interface FoodSettings {
  /** Allergier och kostönskemål i fri text, skickas med när recept och menyer tas fram. */
  allergies: string
  portions: number
  /** Veckodagar med ont om tid (1 = måndag … 7 = söndag): då föreslås snabba middagar. */
  quickWeekdays: number[]
  /** Veckodagar när man tränar: då föreslås proteinrika middagar. */
  trainingWeekdays: number[]
  /** Önskemål för veckan i fri text, t.ex. "fredag något lyxigt". Skickas med när menyn görs. */
  weekWishes?: string
  /** Notis med inköpslistan en viss veckodag (1 = måndag … 7 = söndag). */
  shopping: { enabled: boolean; weekday: number; time: HHmm }
  /** Notis när mat snart går ut. */
  expiry: { enabled: boolean; time: HHmm }
}

/** Vattenmål. Fältet heter nutrition av historiska skäl (synkas med samma namn). */
export interface NutritionSettings {
  waterMl: number
  /** Storlek på ett glas vatten för snabbknappen. */
  glassMl: number
}

export interface Settings {
  id: 'main'
  theme: Theme
  food: FoodSettings
  nutrition: NutritionSettings
  /** Saker användaren bett assistenten komma ihåg (preferenser). */
  memories: string[]
}

export interface PantryItem {
  id: string
  name: string
  /** Fri text, t.ex. "2 st" eller "500 g". */
  amount?: string
  expires?: ISODate
  addedAt: ISODate
  source: 'manual' | 'receipt' | 'fridge' | 'shopping'
  updatedAt: string
}

export interface ShoppingItem {
  id: string
  name: string
  amount?: string
  done: boolean
  /** Varifrån varan kom, t.ex. receptets namn. */
  note?: string
  addedAt: ISODate
  updatedAt: string
}

/** Dagens vatten. id = datum, så en rad per dag. */
export interface WaterDay {
  id: ISODate
  date: ISODate
  ml: number
  updatedAt: string
}

/** En middag i veckomenyn. id = datum, så en middag per dag. */
export interface PlannedDinner {
  id: ISODate
  date: ISODate
  title: string
  /** Varför rätten passar just den dagen. */
  reason: string
  portions: number
  minutes: number | null
  ingredients: { name: string; amount: string }[]
  steps: string[]
  /** Riktigt recept från nätet; då är ingredienserna receptsidans. */
  url?: string
  site?: string
  updatedAt: string
}

/** Sparas bara lokalt och ingår aldrig i export. OpenAI-nyckeln finns bara på servern. */
export interface AiConfig {
  id: 'main'
  /** Lösenord till appens server (api/chat). */
  password: string
  model: string
  /** Senast hämtade modelllista från OpenAI. */
  models?: string[]
}

export type ChatCard =
  | { type: 'shopping_update'; boughtIds: string[]; removeIds: string[]; bought: string[]; removed: string[] }
  | { type: 'pantry_update'; id: string; before: string; after: Pick<PantryItem, 'name'> & Partial<Pick<PantryItem, 'amount' | 'expires'>> }
  | { type: 'prefs_update'; food: Partial<Pick<FoodSettings, 'allergies' | 'portions'>>; nutrition: Partial<NutritionSettings>; summary: string[] }
  | { type: 'memory_add'; fact: string }
  | { type: 'memory_delete'; fact: string }
  | { type: 'water_add'; date: ISODate; ml: number }
  | { type: 'shopping_add'; items: { name: string; amount?: string }[] }
  | { type: 'pantry_add'; items: { name: string; amount?: string; expires?: ISODate }[] }
  | { type: 'pantry_remove'; ids: string[]; names: string[] }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  card?: ChatCard
  /** Status för kortet: väntar på ditt svar, genomfört eller avvisat. */
  cardStatus?: 'pending' | 'done' | 'dismissed' | 'missing'
}

export interface Backup {
  app: 'matplanerare'
  version: 1
  exportedAt: string
  settings: Settings | null
  pantry: PantryItem[]
  shopping: ShoppingItem[]
  water: WaterDay[]
  mealPlan: PlannedDinner[]
}
