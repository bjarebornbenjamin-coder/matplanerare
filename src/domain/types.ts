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
  /** Veckodagar då frukost planeras. */
  breakfastWeekdays: number[]
  /** Veckodagar då lunch planeras (matlåda om det finns ett storkok dagarna före). */
  lunchWeekdays: number[]
  /** Veckodagar med storkok: middagen lagas med extra portioner till matlådor. */
  batchWeekdays: number[]
  /** Portioner per matlåda-lunch. */
  boxPortions: number
  /** Varor användaren själv slagit ihop på inköpslistan, t.ex. { "bladspenat": "Spenat" }. */
  aliases?: Record<string, string>
  /** Önskemål för veckan i fri text, t.ex. "fredag något lyxigt". Skickas med när menyn görs. */
  weekWishes?: string
  /** Notis med inköpslistan en viss veckodag (1 = måndag … 7 = söndag). */
  shopping: { enabled: boolean; weekday: number; time: HHmm }
  /** Notis när mat snart går ut. */
  expiry: { enabled: boolean; time: HHmm }
}

export interface Settings {
  id: 'main'
  theme: Theme
  food: FoodSettings
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
  /** Avdelning i butiken, satt av AI:n. Saknas den gissas den från namnet. */
  section?: string
  addedAt: ISODate
  updatedAt: string
}

export type SideSlot = 'breakfast' | 'lunch'

/**
 * Frukost eller lunch i veckomenyn. id = `${date}:${slot}`. Ligger i en egen samling
 * så att middagarna behåller samma form som i Studieassistenten (som delar synken).
 */
export interface PlannedSide {
  id: string
  date: ISODate
  slot: SideSlot
  title: string
  portions: number
  minutes: number | null
  ingredients: { name: string; amount: string }[]
  /** Matlåda från storkoket det datumet; har inga egna ingredienser. */
  fromBatch?: ISODate
  /** Riktigt recept från nätet; då är ingredienserna receptsidans. */
  url?: string
  site?: string
  /** Markerad med "Jag åt detta": ingredienserna är avdragna från lagret. */
  eaten?: boolean
  updatedAt: string
}

/** Tumme upp eller ner på en rätt. id = rättens namn i normaliserad form, så en rad per rätt. */
export interface DishRating {
  id: string
  title: string
  rating: 1 | -1
  /** Senaste dagen rätten stod på menyn när den betygsattes. */
  date?: ISODate
  url?: string
  site?: string
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
  /** Storkok: antal matlådor som lagas utöver dagens portioner. */
  boxes?: number
  /** Riktigt recept från nätet; då är ingredienserna receptsidans. */
  url?: string
  site?: string
  /** Markerad med "Jag åt detta": ingredienserna är avdragna från lagret. */
  eaten?: boolean
  updatedAt: string
}

/** Sparas bara lokalt och ingår aldrig i export. OpenAI-nyckeln finns bara på servern. */
export interface AiConfig {
  id: 'main'
  /** Lösenord till appens server (api/ai och api/recipes). */
  password: string
  model: string
  /** Senast hämtade modelllista från OpenAI. */
  models?: string[]
}

export interface Backup {
  app: 'matplanerare'
  version: 1
  exportedAt: string
  settings: Settings | null
  pantry: PantryItem[]
  shopping: ShoppingItem[]
  mealPlan: PlannedDinner[]
  sides: PlannedSide[]
  ratings: DishRating[]
}
