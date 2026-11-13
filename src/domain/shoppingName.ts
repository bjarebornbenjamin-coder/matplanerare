/**
 * Gör om receptsidans ingrediensrad till ett namn som passar på en inköpslista:
 * "frysta franska örter" → "Franska örter", "potatis, gärna fast" → "Potatis",
 * "gul lök (ca 2 st)" → "Gul lök", "färsk koriander, hackad" → "Koriander".
 */

/** Ord som beskriver tillstånd eller tillagning, inte vilken vara man köper. */
const DESCRIPTORS = [
  'frysta', 'fryst', 'djupfrysta', 'djupfryst', 'tinade', 'tinad',
  'färska', 'färskt', 'färsk', 'nyplockade', 'nyplockad',
  'hackade', 'hackad', 'hackat', 'finhackade', 'finhackad', 'grovhackade', 'grovhackad',
  'rivna', 'riven', 'rivet', 'finrivet', 'finriven', 'strimlade', 'strimlad', 'tärnade', 'tärnad',
  'skivade', 'skivad', 'pressade', 'pressad', 'kokta', 'kokt', 'kalla', 'kall',
  'rumsvarma', 'rumsvarmt', 'rumsvarm', 'mjukt', 'mjuk', 'smält', 'smälta', 'skalade', 'skalad',
  'ätmogna', 'ätmogen', 'ätmoget', 'mogna', 'mogen', 'moget',
  'liten', 'litet', 'små', 'stor', 'stort', 'stora', 'medelstor', 'medelstora', 'mellanstor', 'mellanstora', 'normalstor', 'normalstora',
  'urkärnade', 'urkärnad', 'avrunna', 'avrunnen', 'sköljda', 'nymalen', 'nymald', 'gärna', 'ca', 'ca.', 'cirka', 'ev', 'ev.', 'eventuellt', 'ekologisk', 'ekologiska',
]
/** Sist i raden: "efter smak", "till servering" osv. */
const TAIL = /\s+(efter smak|till servering|till garnering|att steka i|till stekning|till pensling|för servering|eller .*)$/i

/** Mängd i början eller slutet av namnet: "3 g", "2 dl", "ca 1 kg", "1/2 st". */
const QTY = String.raw`(?:ca\.?\s*)?\d+(?:[.,/]\d+)?\s*(?:kg|hg|g|l|dl|cl|ml|msk|tsk|krm|st|förp|paket|burk|burkar|påse|påsar|knippe|kruka)?\.?`
const LEADING_QTY = new RegExp(`^${QTY}\\s+`, 'i')
const TRAILING_QTY = new RegExp(`\\s+${QTY}$`, 'i')

const cap = (s: string) => (s ? s[0].toLocaleUpperCase('sv') + s.slice(1) : s)

export function cleanName(raw: string): string {
  let s = raw
    .replace(/\([^)]*\)/g, ' ') // "(ca 2 st)"
    .split(/[,;]/)[0] // "potatis, gärna fast"
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('sv')
  // "à 400 g krossade tomater" (resten av "2 burkar à 400 g …") är bara tomaterna.
  s = s.replace(TAIL, '').replace(/^à\s+/, '').replace(LEADING_QTY, '').replace(TRAILING_QTY, '').trim()
  let changed = true
  while (changed) {
    changed = false
    for (const d of DESCRIPTORS) {
      if (s.startsWith(`${d} `)) {
        s = s.slice(d.length + 1).trim()
        changed = true
      }
      if (s.endsWith(` ${d}`)) {
        s = s.slice(0, -(d.length + 1)).trim()
        changed = true
      }
    }
  }
  return cap(s || raw.trim())
}

/**
 * Vaga mängder säger inget om hur mycket som ska köpas eller finns hemma: "1 bit" ost,
 * "2 bitar", "lite", "en del", "några". Då är det bättre att inte visa någon mängd alls.
 */
export function tidyAmount(amount: string | undefined): string {
  const a = (amount ?? '').trim()
  return /(^|[\s\d])(bit|bitar|bitars|del|delar|lite|litet|några|något|nån|skvätt|klick)(\b|$)/i.test(a) ? '' : a
}

/**
 * Små mängder (kryddor, örter, en msk av något) köper man som en hel förpackning: då är
 * mängden bara i vägen på listan. "3 g", "1 krm", "2 tsk", "1 msk", "en nypa" → ingen mängd.
 */
export function shoppingAmount(amount: string | undefined): string | undefined {
  const a = tidyAmount(amount)
  if (!a) return undefined
  if (/\b(krm|tsk|msk|nypa|nypor|kvist|kvistar|blad|näve|nävar|stjälk|stjälkar|skiva|skivor|tärning|tärningar)\b/i.test(a)) return undefined
  const g = /^(\d+(?:[.,]\d+)?)\s*g\b/i.exec(a)
  if (g && Number(g[1].replace(',', '.')) < 25) return undefined
  return a
}

/** Mått som hamnar först i namnet när receptsidan skriver "0,5 ask ärtskott" eller "12 cm gurka". */
const LEADING_UNITS = new Set([
  'ask', 'askar', 'cm', 'kruka', 'krukor', 'burk', 'burkar', 'brk', 'påse', 'påsar', 'paket', 'pkt', 'förp', 'frp', 'förpackning', 'förpackningar', 'knippe', 'knippen',
  'bit', 'bitar', 'näve', 'nävar', 'tärning', 'tärningar', 'kvist', 'kvistar', 'stjälk', 'stjälkar', 'blad', 'huvud', 'huvuden', 'tub', 'tuber', 'flaska', 'flaskor',
  'st', 'skiva', 'skivor', 'klyfta', 'klyftor', 'nypa', 'nypor',
])

/**
 * Flyttar ett mått som står först i namnet till mängden: "Ask ärtskott" med mängden "0,5" blir
 * "ärtskott" och "0,5 ask", "Cm gurka" med "12 st" blir "gurka" och "12 cm". Mängder som redan
 * har en annan enhet ("200 g") lämnas som de är.
 */
export function unitFromName(name: string, amount?: string): { name: string; amount?: string } {
  const m = /^([a-zåäö]+)\.?\s+(\S.*)$/i.exec(name.trim())
  if (!m || !LEADING_UNITS.has(m[1].toLowerCase())) return { name, ...(amount ? { amount } : {}) }
  const a = (amount ?? '').trim()
  // En ren siffra, eller en siffra som fått "st" för att enheten saknades.
  const n = /^((?:ca\.?\s*)?[\d½¼¾.,/–-]+(?:\s+\d+\/\d+)?)(?:\s*st)?$/i.exec(a)
  if (a && !n) return { name: m[2], amount: a }
  return { name: m[2], amount: `${n ? n[1] : '1'} ${m[1].toLowerCase()}` }
}

