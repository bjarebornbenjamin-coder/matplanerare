/**
 * Är rätten en riktig lunch, alltså något man blir mätt på? AI:n och receptsökningen föreslår
 * ibland en smoothie, en fruktsallad eller ett bakverk som lunch. Sådant underkänns här, så att
 * det kan bytas mot en riktig rätt.
 */

/** Sådant som aldrig är en lunch, var det än står i namnet. */
const NEVER = [
  'smoothie', 'fruktsallad', 'milkshake', 'proteinshake', 'dessert', 'efterrätt', 'mellanmål', 'chiapudding', 'chia pudding', 'overnight oats',
  'kladdkaka', 'cheesecake', 'pannacotta', 'panna cotta', 'tiramisu', 'brownie', 'cupcake', 'glasstårta', 'açaí', 'acai',
]

/** Sådant som inte är en lunch när det är själva rätten ("Yoghurt med bär"), men som går bra som tillbehör ("Kyckling med yoghurtsås"). */
const NOT_AS_MAIN = [
  'gröt', 'müsli', 'musli', 'granola', 'yoghurt', 'kvarg', 'juice', 'lemonad', 'sorbet', 'muffin', 'kanelbull', 'vetebull', 'kardemummabull', 'saffransbull',
  'lussekatt', 'semla', 'semlor', 'scones', 'våffl', 'chokladboll', 'energiboll', 'rawboll', 'morotskaka', 'sockerkaka', 'chokladkaka', 'ostkaka', 'småkakor',
  'äppelpaj', 'smulpaj', 'bärpaj', 'blåbärspaj', 'rabarberpaj', 'hallonpaj', 'citronpaj', 'chokladpaj', 'fruktspett', 'fruktfat', 'fruktsoppa', 'nyponsoppa',
  'blåbärssoppa', 'chokladmousse', 'popcorn', 'godis', 'french toast', 'frukost', 'tårta',
]
/** Undantag: matiga rätter som råkar innehålla ett av orden ovan. */
const SAVOURY = ['smörgåstårta', 'äggmuffin', 'matmuffin']

/** Hela ord som inte är en lunch (korta ord, som annars träffar "saftig" eller "glasnudlar"). */
const WORDS = ['glass', 'saft', 'dryck', 'fika', 'bars', 'kakor', 'bullar', 'shake']

/** Frukt och bär: en rätt som bara är frukt är inte en lunch. */
const FRUIT = ['frukt', 'frukter', 'bär', 'jordgubbar', 'hallon', 'blåbär', 'björnbär', 'äpple', 'äpplen', 'banan', 'bananer', 'mango', 'ananas', 'melon', 'vattenmelon', 'päron', 'persika', 'persikor', 'apelsin', 'apelsiner', 'kiwi', 'druvor']
const FRUIT_WORDS = new Set([...FRUIT, 'färsk', 'färska', 'grillad', 'grillade', 'bakad', 'bakade', 'stekt', 'stekta', 'blandad', 'blandade'])

const words = (s: string) => s.split(/[^a-zåäöéèüç]+/).filter(Boolean)

export function isRealLunch(title: string): boolean {
  const t = title.trim().toLowerCase()
  if (!t) return false
  if (NEVER.some((w) => t.includes(w))) return false
  if (words(t).some((w) => WORDS.includes(w))) return false
  // Själva rätten: det som står före "med", "i", "på" och liknande.
  const main = t.split(/\s+(?:med|i|på|till|och|à la)\s+|,/)[0].trim()
  if (NOT_AS_MAIN.some((w) => main.includes(w)) && !SAVOURY.some((w) => main.includes(w))) return false
  const mainWords = words(main)
  if (mainWords.length > 0 && mainWords.every((w) => FRUIT_WORDS.has(w)) && mainWords.some((w) => FRUIT.includes(w))) return false
  return true
}
