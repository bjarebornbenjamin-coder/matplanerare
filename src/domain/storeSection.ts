import { foodKey } from './food'

/** Avdelningar i den ordning man brukar gå genom en svensk matbutik. */
export const SECTIONS = ['Frukt & grönt', 'Bröd', 'Kött, fisk & chark', 'Mejeri & ägg', 'Skafferi', 'Fryst', 'Dryck', 'Övrigt'] as const
export type Section = (typeof SECTIONS)[number]

/**
 * Ord som avgör avdelningen. Ordningen spelar roll: det mest specifika står först, så att
 * "frysta ärtor" hamnar i frysen, "krossade tomater" i skafferiet och "kycklingfilé" bland
 * köttet (inte bland mejerierna för att "fil" råkar ingå).
 */
const RULES: [Section, string[]][] = [
  ['Fryst', ['fryst', 'frysta', 'djupfryst', 'glass', 'fiskpinn', 'pommes', 'isbit']],
  ['Skafferi', ['krossade tomater', 'passerade tomater', 'tomatpuré', 'tomatsås', 'ketchup', 'soltorkade', 'kokosmjölk', 'kokosgrädde', 'tacokrydd', 'tacosås', 'chilisås', 'sweet chili', 'fisksås', 'buljong', 'jordnötssmör', 'pulver', 'flakes', 'kakao']],
  ['Dryck', ['juice', 'läsk', 'saft', 'mineralvatten', 'kolsyrat', 'cola', 'öl', 'cider', 'energidryck']],
  ['Bröd', ['bröd', 'limpa', 'fralla', 'frallor', 'tortilla', 'baguette', 'bullar', 'toast', 'naan']],
  ['Kött, fisk & chark', ['kyckling', 'kött', 'färs', 'fläsk', 'bacon', 'korv', 'skinka', 'salami', 'lax', 'torsk', 'fisk', 'räk', 'sej', 'biff', 'entrecote', 'karré', 'kotlett', 'kalkon', 'chorizo', 'leverpastej', 'tonfisk', 'sill', 'kassler', 'filé']],
  ['Mejeri & ägg', ['mjölk', 'filmjölk', 'yoghurt', 'kvarg', 'grädde', 'crème', 'creme', 'smör', 'margarin', 'ost', 'mozzarella', 'feta', 'halloumi', 'keso', 'ägg', 'gräddfil', 'parmesan', 'kesella', 'fil']],
  ['Frukt & grönt', [
    'äpple', 'äpplen', 'banan', 'apelsin', 'citron', 'lime', 'päron', 'druv', 'bär', 'jordgubb', 'hallon', 'melon', 'avokado', 'mango', 'kiwi', 'clementin',
    'tomat', 'gurka', 'sallad', 'spenat', 'ruccola', 'paprika', 'lök', 'purjo', 'morot', 'morötter', 'potatis', 'broccoli', 'blomkål', 'zucchini', 'aubergine',
    'svamp', 'champinjon', 'kål', 'selleri', 'ingefära', 'chili', 'majs', 'rödbet', 'palsternacka', 'squash', 'sparris',
    'basilika', 'koriander', 'persilja', 'dill', 'gräslök', 'mynta',
  ]],
  ['Skafferi', [
    'pasta', 'spaghetti', 'makaron', 'penne', 'ris', 'nudl', 'bulgur', 'couscous', 'quinoa', 'mjöl', 'socker', 'havregryn', 'müsli', 'flingor', 'gryn',
    'bönor', 'linser', 'kikärt', 'konserv', 'burk', 'olja', 'vinäger', 'krydd', 'örter', 'salt', 'peppar', 'curry', 'oregano', 'timjan', 'kanel', 'kummin', 'paprikapulver',
    'soja', 'ketchup', 'senap', 'majonnäs', 'sås', 'pesto', 'sylt', 'honung', 'kaffe', 'te', 'nötter', 'mandel', 'choklad', 'kex', 'chips', 'kakao', 'bakpulver', 'jäst', 'russin', 'ströbröd',
  ]],
]

/**
 * Långa ord får ingå var som helst ("kyckling" i "kycklingfilé"). Ord på tre bokstäver måste
 * stå först eller sist i ett ord ("ost" i "parmesanost", "lök" i "vitlök", men inte "ris" i
 * "grissini"), och ord på två bokstäver måste vara hela ordet ("te", "öl": inte "vetemjöl").
 */
function hit(key: string, word: string): boolean {
  if (word.length > 3) return key.includes(word)
  return key.split(/[\s,-]+/).some((part) => (word.length <= 2 ? part === word : part.startsWith(word) || part.endsWith(word)))
}

/** Är texten en av avdelningarna? */
export const isSection = (s: unknown): s is Section => typeof s === 'string' && (SECTIONS as readonly string[]).includes(s)

/** Varans avdelning: den AI:n satt om den finns, annars en gissning från namnet. */
export const sectionFor = (item: { name: string; section?: string }): Section => (isSection(item.section) ? item.section : sectionOf(item.name))

/** Vilken avdelning varan brukar stå i. Okänt (t.ex. tandkräm) hamnar under Övrigt. */
export function sectionOf(name: string): Section {
  const key = foodKey(name)
  for (const [section, words] of RULES) if (words.some((w) => hit(key, w))) return section
  return 'Övrigt'
}
