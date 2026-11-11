import { addDays } from '../domain/dates'
import { foodKey } from '../domain/food'
import type { ISODate, PantryItem, ShoppingItem } from '../domain/types'
import { AiError } from './errors'
import { callVision } from './vision'

export type ScanKind = 'receipt' | 'fridge'

export interface ScanRow {
  key: string
  name: string
  amount: string
  /** ISO-datum eller tom sträng. För kvitton en uppskattning från modellen. */
  expires: string
  include: boolean
}

export const RECEIPT_PROMPT = [
  'Du läser av ett svenskt kvitto (foto eller skärmdump) och returnerar matvarorna som JSON. Svara ENDAST med JSON, ingen annan text.',
  'Format: {"items":[{"name":"Mjölk","amount":"1 l","shelf_life_days":7}]}',
  'Ta bara med mat och dryck. Hoppa över pant, bärkassar, rabatter, summor, moms, betalinformation, presentkort och icke-livsmedel som städ och hygien.',
  'Skriv ut butikens förkortningar som vanliga svenska namn utan märke och storlek i namnet, t.ex. "KAFFE ZOEGAS 450G" blir name "Kaffe", amount "450 g"; "LÄTTMJ 1,5%" blir "Lättmjölk".',
  'amount: mängd eller vikt endast om den syns (t.ex. "2 st", "450 g"), annars tom sträng. Samma vara flera gånger: slå ihop och skriv antalet.',
  'shelf_life_days: din uppskattning av hur många dagar varan typiskt håller sig från inköp, ouppäten och rätt förvarad (färsk fisk 2, mjölk 7, ägg 28, bröd 5, torrvaror 365). null om du är osäker.',
  'Hitta inte på varor som inte syns. Ta inte med kortnummer, namn eller annan personlig information.',
].join('\n')

export const FRIDGE_PROMPT = [
  'Du tittar på ett foto av ett kylskåp, en frys eller ett skafferi och listar de matvaror du tydligt kan identifiera. Svara ENDAST med JSON, ingen annan text.',
  'Format: {"items":[{"name":"Mjölk","amount":"1 förpackning"}]}',
  'Ta bara med varor du är rimligt säker på. Gissa inte på det som är skymt eller oläsligt. Använd vanliga svenska namn.',
  'amount: ungefärlig mängd (t.ex. "2 st", "halv förpackning"), tom sträng om du är osäker. Slå ihop identiska varor.',
].join('\n')

const MAX_ITEMS = 100

/** Tolkar modellens svar. Ogiltiga rader och dubbletter hoppas över. */
export function parseScanResponse(text: string, kind: ScanKind, today: ISODate): { rows: ScanRow[]; skipped: number } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    throw new AiError('Kunde inte tolka svaret från AI:n. Försök igen med en skarpare bild.')
  }
  const list = Array.isArray(data) ? data : (data as { items?: unknown })?.items
  if (!Array.isArray(list)) throw new AiError('Svaret innehöll inga varor.')
  const rows: ScanRow[] = []
  const seen = new Set<string>()
  let skipped = 0
  list.slice(0, MAX_ITEMS * 2).forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 60 || seen.has(foodKey(name)) || rows.length >= MAX_ITEMS) return void skipped++
    seen.add(foodKey(name))
    const amount = typeof r.amount === 'string' ? r.amount.trim().slice(0, 30) : ''
    const days = r.shelf_life_days
    const expires = kind === 'receipt' && typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 730 ? addDays(today, days) : ''
    rows.push({ key: `r${i}`, name, amount, expires, include: true })
  })
  return { rows, skipped }
}

export async function scanImage(kind: ScanKind, image: string, model: string, headers: Record<string, string>, fetchFn: typeof fetch = fetch): Promise<string> {
  return callVision(
    {
      system: kind === 'receipt' ? RECEIPT_PROMPT : FRIDGE_PROMPT,
      text: kind === 'receipt' ? 'Läs av det här kvittot.' : 'Vilka matvaror ser du?',
      image,
      model,
      headers,
    },
    fetchFn,
  )
}

/** Vilka rader finns redan i lagret (för varning), och vilka inköpslistevaror kvittot motsvarar. */
export function matchExisting(pantry: PantryItem[], shopping: ShoppingItem[]) {
  const inPantry = new Map<string, PantryItem>()
  for (const p of pantry) inPantry.set(foodKey(p.name), p)
  const onList = new Map<string, ShoppingItem>()
  for (const s of shopping) if (!s.done) onList.set(foodKey(s.name), s)
  return {
    pantryHit: (r: ScanRow) => inPantry.get(foodKey(r.name)),
    listHit: (r: ScanRow) => onList.get(foodKey(r.name)),
  }
}
