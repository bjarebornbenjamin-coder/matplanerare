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
  s = s.replace(TAIL, '').replace(LEADING_QTY, '').replace(TRAILING_QTY, '').trim()
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
  if (/\b(krm|tsk|msk|nypa|nypor|kvist|kvistar|blad)\b/i.test(a)) return undefined
  const g = /^(\d+(?:[.,]\d+)?)\s*g\b/i.exec(a)
  if (g && Number(g[1].replace(',', '.')) < 25) return undefined
  return a
}
