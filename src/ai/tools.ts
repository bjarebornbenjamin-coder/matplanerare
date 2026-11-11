import { addDays, daysBetween, toISODate } from '../domain/dates'
import { daysLeft, foodKey } from '../domain/food'
import type { ChatCard, DishRating, PantryItem, PlannedDinner, PlannedSide, Settings, ShoppingItem, WaterDay } from '../domain/types'

/** Det chatten kan läsa. */
export interface ToolContext {
  settings: Settings
  pantry: PantryItem[]
  shopping: ShoppingItem[]
  water: WaterDay[]
  mealPlan: PlannedDinner[]
  /** Frukost och lunch i veckomenyn. */
  sides?: PlannedSide[]
  /** Tumme upp/ner på rätter. */
  ratings?: DishRating[]
  /** Dagens datum (sätts av chatten så att svaren följer appens klocka). */
  today?: string
  /** Klockslaget nu, HH:mm. */
  nowTime?: string
}

export interface ToolOutcome {
  result: unknown
  /** Förslag som användaren måste bekräfta innan något händer. */
  card?: ChatCard
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const date = { type: 'string', description: 'Datum som YYYY-MM-DD' }
type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const err = (message: string): ToolOutcome => ({ result: { error: message } })
const strings = (v: unknown, max = 30): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 60)).slice(0, max) : []
const proposed = (card: ChatCard, message = 'Förslaget visas för användaren. Inget är ändrat än.'): ToolOutcome => ({
  result: { status: 'awaiting_user_confirmation', message },
  card,
})
const short = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })

/** Hitta en post på namn: exakt först, annars delsträng. Flera träffar = fråga användaren. */
function findByName<T>(items: T[], name: string, get: (t: T) => string): { hit?: T; error?: string } {
  const q = foodKey(name)
  if (!q) return { error: 'Inget namn angavs.' }
  const exact = items.filter((i) => foodKey(get(i)) === q)
  if (exact.length === 1) return { hit: exact[0] }
  const partial = exact.length ? exact : items.filter((i) => foodKey(get(i)).includes(q))
  if (partial.length === 1) return { hit: partial[0] }
  if (partial.length === 0) return { error: `Hittar inget som heter "${name}".` }
  return { error: `Flera träffar för "${name}": ${partial.slice(0, 6).map(get).join(', ')}. Fråga användaren vilken.` }
}

/** Rensar en lista med varor från modellen. */
function cleanItems(v: unknown, withExpiry = false): { list: { name: string; amount?: string; expires?: string }[] } | { error: string } {
  if (!Array.isArray(v) || v.length === 0) return { error: 'Inga varor angavs.' }
  if (v.length > 40) return { error: 'För många varor på en gång (max 40).' }
  const seen = new Set<string>()
  const list: { name: string; amount?: string; expires?: string }[] = []
  for (const raw of v) {
    const r = (raw ?? {}) as Record<string, unknown>
    const name = str(r.name).slice(0, 60)
    if (!name || seen.has(foodKey(name))) continue
    seen.add(foodKey(name))
    const amount = str(r.amount).slice(0, 30)
    const expires = withExpiry ? str(r.expires) : ''
    if (expires && !DATE.test(expires)) return { error: `Ogiltigt datum för ${name}, använd YYYY-MM-DD.` }
    list.push({ name, ...(amount ? { amount } : {}), ...(expires ? { expires } : {}) })
  }
  return list.length > 0 ? { list } : { error: 'Inga giltiga varor angavs.' }
}

export const TOOL_DEFINITIONS = [
{
    name: 'list_pantry',
    description: 'Lista vad användaren har hemma i matlagret, med mängd, bäst före-datum och daysLeft (negativt = utgånget). Använd den för matfrågor.',
    parameters: { type: 'object', properties: {} },
  },
{
    name: 'list_shopping',
    description: 'Lista användarens inköpslista (done = redan köpt).',
    parameters: { type: 'object', properties: {} },
  },
{
    name: 'propose_shopping_items',
    description: 'Föreslå varor att lägga på inköpslistan. De läggs INTE dit förrän användaren bekräftat i appen. Varor som redan står på listan hoppas över.',
    parameters: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'string' } }, required: ['name'] } } },
      required: ['items'],
    },
  },
{
    name: 'propose_pantry_add',
    description: 'Föreslå varor att lägga i matlagret (t.ex. efter inköp). Läggs INTE dit förrän användaren bekräftat. expires är bäst före-datum YYYY-MM-DD, valfritt.',
    parameters: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'string' }, expires: date }, required: ['name'] } } },
      required: ['items'],
    },
  },
{
    name: 'propose_pantry_remove',
    description: 'Föreslå att varor tas bort ur matlagret (uppätna eller slut), angivna med namn som i list_pantry. Tas INTE bort förrän användaren bekräftat.',
    parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
  },
{
    name: 'get_water',
    description: 'Hämta hur mycket vatten användaren druckit per dag (ml) för ett datumintervall (max 14 dagar), och vattenmålet.',
    parameters: { type: 'object', properties: { from: date, to: { ...date, description: 'Sista datum, samma som from för en dag' } }, required: ['from'] },
  },
{
    name: 'propose_water',
    description: 'Föreslå att lägga till vatten användaren druckit (ml). Läggs INTE till förrän användaren bekräftat. Ett glas är glassMl från användarens inställningar.',
    parameters: { type: 'object', properties: { ml: { type: 'number' }, date }, required: ['ml'] },
  },
{
    name: 'find_recipes',
    description: 'Söker upp 1–3 riktiga recept på svenska receptsajter (ICA, Köket, Arla m.fl.) och läser ingredienserna från receptsidan. Ger titel, url, vad som finns hemma och vad som saknas. Använd för ALLA receptförslag; skriv aldrig egna recept.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['pantry', 'some', 'any'], description: 'pantry = bara det som finns hemma, some = handla lite, any = handla det som behövs' },
        wish: { type: 'string', description: 'Önskemål, t.ex. "snabbt", "kyckling", "lätt kvällsmål"' },
        dish: { type: 'string', description: 'En bestämd rätt att hitta recept på, valfritt' },
      },
      required: ['mode'],
    },
  },
{
    name: 'get_meal_plan',
    description: 'Veckomenyn: planerade middagar (och frukost/lunch/matlådor om sådana planerats) från och med ett datum (standard idag), med ingredienser och steg. Användaren gör menyn under Mat → Meny.',
    parameters: { type: 'object', properties: { from: date, days: { type: 'integer', description: '1–14, standard 7' } } },
  },
{
    name: 'propose_shopping_update',
    description: 'Föreslå att markera varor på inköpslistan som köpta och/eller ta bort varor från listan (namn som i list_shopping).',
    parameters: { type: 'object', properties: { mark_bought: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } } },
  },
{
    name: 'propose_pantry_update',
    description: 'Föreslå ändring av en vara i matlagret (namn som i list_pantry): ny mängd och/eller nytt bäst före-datum ("" tar bort datumet).',
    parameters: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'string' }, expires: { type: 'string' } }, required: ['name'] },
  },
{
    name: 'propose_preferences',
    description: 'Föreslå ändrade inställningar: allergier/kost (fri text), antal portioner och dagligt vattenmål (ml). Ange bara det som ska ändras.',
    parameters: {
      type: 'object',
      properties: { allergies: { type: 'string' }, portions: { type: 'integer' }, water_ml: { type: 'integer' } },
    },
  },
{
    name: 'remember',
    description: 'Föreslå att komma ihåg en preferens eller ett faktum om användaren som ska påverka framtida svar (t.ex. "gillar inte svamp", "tränar helst på morgonen"). Sparas när användaren bekräftat.',
    parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
  },
{ name: 'forget', description: 'Föreslå att glömma något som sparats med remember.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } }
].map((f) => ({ type: 'function' as const, function: f as { name: string; description: string; parameters: unknown } }))

export function runTool(name: string, args: Args, ctx: ToolContext): ToolOutcome {
  switch (name) {
    case 'list_pantry': {
      const today = ctx.today ?? toISODate(new Date())
      return {
        result: {
          today,
          items: ctx.pantry
            .slice()
            .sort((a, b) => (a.expires ?? '9999').localeCompare(b.expires ?? '9999') || a.name.localeCompare(b.name, 'sv'))
            .map((p) => ({
              name: p.name,
              amount: p.amount,
              expires: p.expires,
              daysLeft: p.expires ? daysLeft(p.expires, today) : undefined,
            })),
        },
      }
    }

    case 'list_shopping':
      return { result: { items: ctx.shopping.map((i) => ({ name: i.name, amount: i.amount, done: i.done })) } }

    case 'propose_shopping_items': {
      const items = cleanItems(args.items)
      if ('error' in items) return err(items.error)
      const onList = new Set(ctx.shopping.filter((i) => !i.done).map((i) => foodKey(i.name)))
      const fresh = items.list.filter((i) => !onList.has(foodKey(i.name)))
      if (fresh.length === 0) return err('Allt det här står redan på inköpslistan.')
      return {
        result: {
          status: 'awaiting_user_confirmation',
          message: 'Förslaget visas för användaren. Inget är tillagt än.',
          ...(fresh.length < items.list.length ? { note: 'Några varor stod redan på listan och utelämnades.' } : {}),
        },
        card: { type: 'shopping_add', items: fresh },
      }
    }

    case 'propose_pantry_add': {
      const items = cleanItems(args.items, true)
      if ('error' in items) return err(items.error)
      return {
        result: { status: 'awaiting_user_confirmation', message: 'Förslaget visas för användaren. Inget är tillagt än.' },
        card: { type: 'pantry_add', items: items.list },
      }
    }

    case 'propose_pantry_remove': {
      const names = Array.isArray(args.names) ? args.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 30) : []
      if (names.length === 0) return err('Inga varor angavs.')
      const found: PantryItem[] = []
      const unknown: string[] = []
      for (const n of names) {
        const hit = ctx.pantry.find((p) => foodKey(p.name) === foodKey(n) && !found.includes(p)) ?? ctx.pantry.find((p) => foodKey(p.name).includes(foodKey(n)) && !found.includes(p))
        if (hit) found.push(hit)
        else unknown.push(n)
      }
      if (found.length === 0) return err(`Hittar ingen av varorna i lagret: ${unknown.join(', ')}. Kontrollera namnen med list_pantry.`)
      return {
        result: {
          status: 'awaiting_user_confirmation',
          message: 'Borttagningen visas för användaren. Inget är borttaget än.',
          ...(unknown.length ? { note: `Hittade inte: ${unknown.join(', ')}` } : {}),
        },
        card: { type: 'pantry_remove', ids: found.map((p) => p.id), names: found.map((p) => p.name) },
      }
    }

    case 'get_water': {
      const from = str(args.from)
      const to = str(args.to) || from
      if (!DATE.test(from) || !DATE.test(to)) return err('Ogiltigt datum, använd YYYY-MM-DD.')
      const span = daysBetween(from, to)
      if (span < 0 || span > 13) return err('Intervallet måste vara 1–14 dagar.')
      const byDate = new Map(ctx.water.map((w) => [w.date, w.ml]))
      const days = Array.from({ length: span + 1 }, (_, i) => addDays(from, i)).map((d) => ({ date: d, ml: byDate.get(d) ?? 0 }))
      return { result: { goalMl: ctx.settings.nutrition.waterMl, glassMl: ctx.settings.nutrition.glassMl, days } }
    }

    case 'propose_water': {
      const ml = typeof args.ml === 'number' ? Math.round(args.ml) : NaN
      const date = str(args.date) || (ctx.today ?? toISODate(new Date()))
      if (!Number.isFinite(ml) || ml < 1 || ml > 5000) return err('Mängden måste vara 1–5000 ml.')
      if (!DATE.test(date)) return err('Ogiltigt datum, använd YYYY-MM-DD.')
      return {
        result: { status: 'awaiting_user_confirmation', message: 'Förslaget visas för användaren. Inget är tillagt än.' },
        card: { type: 'water_add', date, ml },
      }
    }

    case 'find_recipes':
      return err('Receptsökningen körs av appen.')

    case 'get_meal_plan': {
      const from = str(args.from) || (ctx.today ?? toISODate(new Date()))
      if (!DATE.test(from)) return err('Ogiltigt datum, använd YYYY-MM-DD.')
      const days = args.days === undefined ? 7 : Number(args.days)
      if (!Number.isInteger(days) || days < 1 || days > 14) return err('days måste vara 1–14.')
      const to = addDays(from, days - 1)
      const list = ctx.mealPlan.filter((d) => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date))
      return {
        result: {
          dinners: list.map((d) => ({ date: d.date, title: d.title, reason: d.reason || undefined, minutes: d.minutes ?? undefined, portions: d.portions, ...(d.boxes ? { batchCookBoxes: d.boxes } : {}), ingredients: d.ingredients, steps: d.steps })),
          ...(ctx.ratings?.length ? { liked: ctx.ratings.filter((r) => r.rating === 1).map((r) => r.title), disliked: ctx.ratings.filter((r) => r.rating === -1).map((r) => r.title) } : {}),
          breakfastsAndLunches: (ctx.sides ?? []).filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.id.localeCompare(b.id)).map((x) => ({ date: x.date, meal: x.slot === 'breakfast' ? 'frukost' : 'lunch', title: x.title, ...(x.fromBatch ? { lunchBoxFrom: x.fromBatch } : {}), minutes: x.minutes ?? undefined, ingredients: x.ingredients.length ? x.ingredients : undefined })),
          ...(list.length === 0 ? { note: 'Ingen veckomeny för perioden. Användaren kan göra en under Mat → Meny.' } : {}),
        },
      }
    }

    case 'propose_shopping_update': {
      const open = ctx.shopping.filter((i) => !i.done)
      const pick = (names: string[]) => names.map((n) => open.find((i) => foodKey(i.name) === foodKey(n))).filter((x): x is (typeof open)[number] => Boolean(x))
      const bought = pick(strings(args.mark_bought))
      const removed = pick(strings(args.remove)).filter((i) => !bought.includes(i))
      if (bought.length === 0 && removed.length === 0) return err('Hittade inga av varorna på inköpslistan. Kontrollera namnen med list_shopping.')
      return proposed({ type: 'shopping_update', boughtIds: bought.map((i) => i.id), removeIds: removed.map((i) => i.id), bought: bought.map((i) => i.name), removed: removed.map((i) => i.name) })
    }

    case 'propose_pantry_update': {
      const f = findByName(ctx.pantry, str(args.name), (p) => p.name)
      if (!f.hit) return err(f.error!)
      const p = f.hit
      const amount = args.amount === undefined ? p.amount : str(args.amount).slice(0, 30) || undefined
      const expires = args.expires === undefined ? p.expires : str(args.expires) || undefined
      if (expires && !DATE.test(expires)) return err('Ogiltigt datum, använd YYYY-MM-DD eller "" för att ta bort.')
      if (amount === p.amount && expires === p.expires) return err('Inga ändringar jämfört med nuvarande vara.')
      return proposed({
        type: 'pantry_update',
        id: p.id,
        before: [p.name, p.amount, p.expires && `bäst före ${short(p.expires)}`].filter(Boolean).join(', '),
        after: { name: p.name, ...(amount ? { amount } : {}), ...(expires ? { expires } : {}) },
      })
    }

    case 'propose_preferences': {
      const food: { allergies?: string; portions?: number } = {}
      const nutrition: Record<string, number> = {}
      const summary: string[] = []
      const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null)
      if (args.allergies !== undefined) {
        food.allergies = str(args.allergies).slice(0, 500)
        summary.push(`Allergier/kost: ${food.allergies || 'inga'}`)
      }
      if (args.portions !== undefined) {
        const v = int(args.portions, 1, 12)
        if (v === null) return err('Portioner måste vara 1–12.')
        food.portions = v
        summary.push(`Portioner: ${v}`)
      }
      for (const [key, field, label, max] of [
        ['water_ml', 'waterMl', 'Vatten', 20000],
      ] as const) {
        if (args[key] === undefined) continue
        const v = int(args[key], 0, max)
        if (v === null) return err(`${label}: ogiltigt värde.`)
        nutrition[field] = v
        summary.push(`${label}: ${v} ml per dag`)
      }
      if (summary.length === 0) return err('Inget att ändra.')
      return proposed({ type: 'prefs_update', food, nutrition, summary })
    }

    case 'remember': {
      const fact = str(args.fact).slice(0, 200)
      if (!fact) return err('Inget att komma ihåg.')
      if (ctx.settings.memories.some((m) => foodKey(m) === foodKey(fact))) return err('Det kommer jag redan ihåg.')
      if (ctx.settings.memories.length >= 30) return err('Minnet är fullt (30 saker). Be användaren ta bort något först.')
      return proposed({ type: 'memory_add', fact })
    }

    case 'forget': {
      const f = findByName(ctx.settings.memories, str(args.fact), (m) => m)
      if (!f.hit) return err(f.error!)
      return proposed({ type: 'memory_delete', fact: f.hit })
    }
  }
  return err(`Okänt verktyg: ${name}`)
}
