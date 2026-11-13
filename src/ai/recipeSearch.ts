import { isRealLunch } from '../domain/lunch'
import { daysLeft, foodKey } from '../domain/food'
import type { FoodSettings, ISODate, PantryItem } from '../domain/types'
import { AiError, describeError } from './errors'

/** Ett riktigt recept från en receptsajt. Ingredienserna är sidans egna. */
export interface FoundRecipe {
  title: string
  url: string
  site: string
  why: string
  ingredients: string[]
  servings?: string
  minutes?: number
  image?: string
}

/** pantry = bara det som finns hemma, some = handla lite, any = handla det som behövs. */
export type RecipeMode = 'pantry' | 'some' | 'any'

export const MODE_LABELS: Record<RecipeMode, string> = {
  pantry: 'Bara det jag har hemma',
  some: 'Det jag har hemma, handla lite',
  any: 'Handla det som behövs',
}

export interface RecipeQuery {
  mode: RecipeMode
  pantry: PantryItem[]
  food: Pick<FoodSettings, 'allergies'>
  memories: string[]
  today: ISODate
  wish?: string
  /** Leta efter en bestämd rätt, t.ex. från veckomenyn. */
  dish?: string
  count?: number
}

export async function findRecipes(q: RecipeQuery, headers: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<FoundRecipe[]> {
  let res: Response
  try {
    res = await fetchFn('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        mode: q.mode,
        pantry: q.pantry.filter((p) => !p.expires || p.expires >= q.today).map((p) => ({ name: p.name, ...(p.amount ? { amount: p.amount } : {}), ...(p.expires ? { daysLeft: daysLeft(p.expires, q.today) } : {}) })),
        allergies: q.food.allergies,
        preferences: q.memories,
        ...(q.wish?.trim() ? { wish: q.wish.trim() } : {}),
        ...(q.dish ? { dish: q.dish } : {}),
        count: q.count ?? 3,
      }),
    })
  } catch {
    throw new AiError('Kunde inte nå servern. Kontrollera internetanslutningen.')
  }
  if (!res.ok) throw new AiError(await describeError(res))
  const data = (await res.json()) as { recipes?: FoundRecipe[] }
  if (!Array.isArray(data.recipes) || data.recipes.length === 0) throw new AiError('Hittade inga recept.')
  return data.recipes
}

/**
 * Ett riktigt recept för rätten. Hittas ingen läsbar receptsida för just den rätten provas en
 * liknande rätt, och då byts namnet mot receptets. null om inget recept alls hittas: då ska
 * rätten inte visas som ett recept. `meal` = 'lunch' godtar bara recept som är riktiga luncher,
 * så att en sallad inte byts mot en fruktsallad.
 */
export async function recipeForDish(dish: string, q: Omit<RecipeQuery, 'mode' | 'dish' | 'count' | 'wish'>, headers: Record<string, string>, fetchFn: typeof fetch = fetch, meal?: 'lunch'): Promise<FoundRecipe | null> {
  const fits = (r: FoundRecipe | undefined) => (r && (meal !== 'lunch' || isRealLunch(r.title)) ? r : null)
  try {
    const exact = fits((await findRecipes({ ...q, mode: 'any', dish, count: 1 }, headers, fetchFn))[0])
    if (exact) return exact
  } catch {
    /* prova en liknande rätt */
  }
  try {
    const wish = meal === 'lunch' ? `${dish}, eller en liknande mättande lunchrätt (inte smoothie, fruktsallad eller efterrätt)` : `${dish}, eller en liknande rätt`
    return fits((await findRecipes({ ...q, mode: 'any', wish, count: 1 }, headers, fetchFn))[0])
  } catch {
    return null
  }
}

// Längre ord först, så att "förpackning" inte läses som "förp" och "stjälk" inte som "st".
const UNIT = '(?:förpackning(?:ar)?|tärning(?:ar)?|portion(?:er)?|stjälk(?:ar)?|flask(?:a|or)|klyft(?:a|or)|skiv(?:a|or)|kruk(?:a|or)|kvist(?:ar)?|huvud(?:en)?|burk(?:ar)?|knippen?|pås(?:e|ar)|ask(?:ar)?|bit(?:ar)?|tub(?:er)?|nyp(?:a|or)|näv(?:e|ar)|paket|förp|blad|port|pkt|frp|brk|msk|tsk|krm|kg|hg|dl|cl|ml|cm|st|g|l)'
const SPLIT = new RegExp(`^((?:ca\\.?\\s*)?[\\d½¼¾⅓⅔.,/–-]+(?:\\s*[\\d½¼¾⅓⅔.,/–-]+)?\\s*(?:${UNIT}\\.?)?)\\s+(.+)$`, 'i')

/** "400 g kycklingfilé, i bitar" → { amount: "400 g", name: "kycklingfilé, i bitar" } */
export function splitIngredient(line: string): { amount: string; name: string } {
  const m = SPLIT.exec(line.trim())
  return m ? { amount: m[1].trim(), name: m[2].trim() } : { amount: '', name: line.trim() }
}

/** Sådant de flesta har hemma. Visas som basvara i stället för att saknas. */
const BASICS = ['salt', 'peppar', 'vatten', 'olja', 'smör', 'socker', 'mjöl', 'buljong', 'fond', 'oregano', 'timjan', 'paprikapulver', 'curry', 'chili', 'kanel', 'spiskummin', 'lagerblad', 'vinäger', 'soja', 'senap', 'ketchup', 'honung', 'bakpulver', 'vaniljsocker', 'muskot', 'ingefära, mald']

export interface IngredientLine {
  line: string
  amount: string
  name: string
  status: 'pantry' | 'staple' | 'missing'
  pantryName?: string
}

/** Jämför sidans ingrediensrader mot lagret. Det är en ordjämförelse, så "kolla själv" gäller. */
export function ingredientStatuses(lines: string[], pantry: PantryItem[]): IngredientLine[] {
  return lines.map((line) => {
    const { amount, name } = splitIngredient(line)
    const key = foodKey(name)
    const hit = pantry.find((p) => {
      const pk = foodKey(p.name)
      return pk.length > 2 && (key.includes(pk) || pk.includes(key.split(/[ ,(]/)[0]))
    })
    if (hit) return { line, amount, name, status: 'pantry', pantryName: hit.name }
    const staple = BASICS.some((b) => key === b || key.startsWith(`${b} `) || key.startsWith(`${b},`) || key.endsWith(` ${b}`) || key.includes(`${b}pulver`) || key.endsWith(b))
    return { line, amount, name, status: staple ? 'staple' : 'missing' }
  })
}
