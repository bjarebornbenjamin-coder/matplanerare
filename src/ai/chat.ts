import { goalKcal } from '../domain/nutrition'
import { WEEKDAYS_LONG, toHHmm, toISODate, weekdayOf } from '../domain/dates'
import type { ChatCard, ChatMessage } from '../domain/types'
import { DEFAULT_MODEL } from './models'
import { TOOL_DEFINITIONS, runTool, type ToolContext, type ToolOutcome } from './tools'
import { findRecipes, ingredientStatuses } from './recipeSearch'
import { toISODate as isoDate } from '../domain/dates'

const API_URL = '/api/chat'
const MAX_ROUNDS = 10
const HISTORY_LIMIT = 20

type ApiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export class ChatError extends Error {}

/** Receptsökningen går via servern och är därför asynkron, till skillnad från övriga verktyg. */
async function recipeTool(args: Record<string, unknown>, ctx: ToolContext, headers: Record<string, string>, fetchFn: typeof fetch, allowed: Set<string>): Promise<ToolOutcome> {
  const mode = args.mode === 'pantry' || args.mode === 'any' ? args.mode : 'some'
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 150) : '')
  try {
    const found = await findRecipes(
      { mode, pantry: ctx.pantry, food: ctx.settings.food, memories: ctx.settings.memories, today: ctx.today ?? isoDate(new Date()), wish: str(args.wish), ...(str(args.dish) ? { dish: str(args.dish) } : {}) },
      headers,
      fetchFn,
    )
    for (const r of found) allowed.add(r.url)
    return {
      result: {
        recipes: found.map((r) => {
          const lines = ingredientStatuses(r.ingredients, ctx.pantry)
          return { title: r.title, url: r.url, site: r.site, why: r.why || undefined, minutes: r.minutes, servings: r.servings, haveAtHome: lines.filter((l) => l.status === 'pantry').map((l) => l.name), missing: lines.filter((l) => l.status === 'missing').map((l) => l.line) }
        }),
      },
    }
  } catch (e) {
    return { result: { error: e instanceof Error ? e.message : 'Receptsökningen misslyckades.' } }
  }
}

/** Länkar i svaret behålls bara om adressen kom från ett verktyg; andra blir vanlig text så att inga adresser är påhittade. */
export function keepLinks(text: string, allowed: Set<string>): string {
  return text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (all, label: string, url: string) => (allowed.has(url) ? all : label))
}

function memoryPrompt(ctx: ToolContext): string {
  const m = ctx.settings.memories
  return [
    'Minne: när användaren berättar en bestående preferens om mat (något hen inte äter, favoriter, hur mycket tid hen har på vardagar, budget, hushållets storlek), föreslå att komma ihåg det med remember. Spara inte tillfälliga saker.',
    m.length ? `Saker användaren bett dig komma ihåg (följ dem i alla svar):\n${m.map((x) => `- ${x}`).join('\n')}` : 'Inget sparat i minnet än.',
  ].join('\n')
}

function foodPrompt(ctx: ToolContext): string {
  const f = ctx.settings.food
  const n = ctx.settings.nutrition
  return [
    'Veckomeny: frågar användaren vad det blir till middag, eller vad hen ska äta en dag, anropa först get_meal_plan och utgå från den om något är planerat.',
    'Matlager och inköp: du ser lagret med list_pantry och inköpslistan med list_shopping. På "vad ska jag äta?" eller "vad kan jag laga?": hämta list_pantry och get_nutrition för idag och väg ihop: (1) använd i första hand varor som snart går ut (daysLeft 0–2), aldrig utgångna (negativt daysLeft; nämn dem kort), (2) håll dig inom det som återstår av dagens mål om något är loggat, (3) ta hänsyn till klockslaget: sent på kvällen är det ett kvällsmål eller mellanmål, inte en full middag. Räkna inte upp hela lagret; nämn bara de varor du använder.',
    'Recept: skriv ALDRIG egna recept med ingredienser och steg. Anropa find_recipes, som söker upp riktiga recept på nätet och läser ingredienserna från receptsidan: mode "pantry" om användaren vill använda det som finns hemma, "any" om hen gärna handlar, annars "some"; skicka med önskemål i wish (t.ex. "snabbt", "kyckling", "billigt"). Presentera 1–3 träffar kort: namn, varför det passar, vad som saknas, och en egen rad [Öppna receptet](URL) med exakt den url som verktyget gav. Skriv aldrig andra webbadresser. Erbjud propose_shopping_items för det som saknas. Gissa aldrig vad användaren har: är lagret tomt, säg det och föreslå att lägga in varor eller skanna ett kvitto.',
    `Standard är ${f.portions} portioner.${f.allergies.trim() ? ` Allergier/kostönskemål som du måste respektera: ${f.allergies.trim()}.` : ''}`,
    `Kost: användarens dagliga mål är protein ${n.proteinG} g, kolhydrater ${n.carbsG} g, fett ${n.fatG} g (ca ${goalKcal(n)} kcal) och vatten ${n.waterMl} ml; ett glas är ${n.glassMl} ml. Frågor om hur mycket användaren ätit eller druckit, eller vad som återstår: anropa get_nutrition och räkna ut skillnaden mot målen. Berättar användaren vad hen ätit: uppskatta näringsvärdena för hela måltiden, säg att det är en uppskattning, och föreslå loggning med propose_meal. Berättar hen att hen druckit vatten ("2 glas"): använd propose_water i ml. Det här är bara riktvärden: ge inga medicinska råd.`,
  ].join('\n')
}

export function systemPrompt(now: Date, ctx: ToolContext): string {
  const today = toISODate(now)
  return [
    'Du är matassistenten i Matplaneraren, en app för att planera veckans mat, hålla koll på det som finns hemma och handla smart. Svara ALLTID på svenska, även rubriker; använd aldrig engelska ord eller verktygens fältnamn. Var kortfattad: sällan mer än 8 rader om användaren inte ber om mer. Numrerade listor numreras 1, 2, 3.',
    `Idag är ${WEEKDAYS_LONG[weekdayOf(today) - 1]} ${today}, klockan ${toHHmm(now)}. Räkna ut datum själv ("imorgon", "på fredag") och skicka dem som YYYY-MM-DD.`,
    'Hämta alltid lager, inköpslista, meny och kost med verktygen och gissa aldrig.',
    'Du kan inte lägga in, ändra eller ta bort något direkt: propose_*-verktygen visar bara ett förslag som användaren själv bekräftar. Säg tydligt att det är ett förslag som väntar på användaren, inte att det är gjort. Samla gärna flera förslag i samma svar.',
    foodPrompt(ctx),
    'Du kan bara hjälpa till med mat: planering, recept, lager, inköp och kost. Frågar användaren om annat, säg vänligt att Matplaneraren bara hanterar mat.',
    'Om något saknas för att kunna svara, fråga i stället för att hitta på.',
    memoryPrompt(ctx),
  ].join('\n')
}

interface RunOptions {
  /** Autentiseringsrubriker till appens server. */
  headers: Record<string, string>
  model: string
  history: Pick<ChatMessage, 'role' | 'content'>[]
  userText: string
  now: Date
  loadContext: () => Promise<ToolContext>
  fetchFn?: typeof fetch
}

export interface ChatResult {
  reply: string
  cards: ChatCard[]
  /** Satt om vi föll tillbaka på standardmodellen. */
  notice?: string
}

export async function describeError(res: Response): Promise<string> {
  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* svaret var inte JSON */
  }
  if (res.status === 401) return `${detail || 'Fel lösenord.'} Kontrollera lösenordet i Inställningar.`
  if (res.status === 403) return detail || 'Du har inte åtkomst.'
  if (res.status === 429) return detail || 'För många anrop eller slut på tegoder hos OpenAI.'
  if (res.status === 404) return `Modellen hittades inte. Kontrollera modellnamnet i Inställningar.${detail ? ` ${detail}` : ''}`
  return detail ? `Servern svarade med fel ${res.status}: ${detail}` : `Servern svarade med fel ${res.status} utan förklaring. Kontrollera Vercel → Logs och att miljövariablerna är satta.`
}

export async function runChat(o: RunOptions): Promise<ChatResult> {
  const fetchFn = o.fetchFn ?? fetch
  const ctx = { ...(await o.loadContext()), today: toISODate(o.now), nowTime: toHHmm(o.now) }
  const messages: ApiMessage[] = [
    { role: 'system', content: systemPrompt(o.now, ctx) },
    ...o.history.slice(-HISTORY_LIMIT).map((m) => ({ role: m.role, content: m.content }) as ApiMessage),
    { role: 'user', content: o.userText },
  ]
  const cards: ChatCard[] = []
  const allowedLinks = new Set<string>()
  let model = o.model
  let notice: string | undefined
  let retriedEmpty = false

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let res: Response
    try {
      res = await fetchFn(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...o.headers },
        body: JSON.stringify({ model, messages, tools: TOOL_DEFINITIONS }),
      })
    } catch {
      throw new ChatError('Kunde inte nå servern. Kontrollera internetanslutningen.')
    }
    if (res.status === 404 && model !== DEFAULT_MODEL) {
      notice = `Modellen ${model} hittades inte, så jag använde ${DEFAULT_MODEL}. Byt modell i Inställningar.`
      model = DEFAULT_MODEL
      round--
      continue
    }
    if (!res.ok) throw new ChatError(await describeError(res))

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]
    }
    const msg = data.choices?.[0]?.message
    if (!msg) throw new ChatError('Oväntat svar från OpenAI.')

    if (!msg.tool_calls?.length) {
      const text = (msg.content ?? '').trim()
      if (!text && !retriedEmpty) {
        // Modellen svarade tomt (t.ex. efter tomma verktygsresultat). Be den svara i text, en gång.
        retriedEmpty = true
        messages.push({ role: 'user', content: 'Svara i text på min fråga utifrån det du fått från verktygen. Om inget finns, säg det tydligt.' })
        continue
      }
      return { reply: keepLinks(text, allowedLinks) || 'Jag fick inget svar den här gången. Försök igen.', cards, notice }
    }

    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}')
      } catch {
        /* ogiltiga argument ger ett fel från verktyget */
      }
      const outcome = call.function.name === 'find_recipes' ? await recipeTool(args, ctx, o.headers, fetchFn, allowedLinks) : runTool(call.function.name, args, ctx)
      if (outcome.card) cards.push(outcome.card)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) })
    }
  }
  throw new ChatError('Assistenten fastnade i en loop. Försök formulera om frågan.')
}
