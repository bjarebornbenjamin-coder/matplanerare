import { foodKey } from './food'
import type { PantryItem, StoragePlace } from './types'

/** Ord som avgör var en vara brukar förvaras. Frys går före kyl; allt annat hamnar i skafferiet. */
const FREEZER = ['fryst', 'frys', 'glass', 'isbit', 'fiskpinn', 'pommes', 'frysta', 'djupfryst']
const FRIDGE = [
  'mjölk', 'fil', 'yoghurt', 'kvarg', 'grädde', 'crème', 'creme', 'smör', 'ost', 'mozzarella', 'fetaost', 'halloumi', 'keso', 'ägg',
  'kyckling', 'kött', 'färs', 'fläsk', 'bacon', 'korv', 'skinka', 'salami', 'lax', 'torsk', 'fisk', 'räk', 'tonfisk i',
  'sallad', 'gurka', 'tomat', 'paprika', 'broccoli', 'blomkål', 'spenat', 'morot', 'morötter', 'zucchini', 'purjo', 'selleri', 'svamp', 'champinjon',
  'bär', 'jordgubb', 'blåbär', 'hallon', 'citron', 'lime', 'druv', 'juice', 'pesto', 'hummus', 'tofu', 'majonnäs', 'dressing', 'sylt', 'kaviar', 'leverpastej',
]

const has = (key: string, words: string[]) => words.some((w) => key.includes(w))

/** Gissar var varan förvaras utifrån namnet. Okänt hamnar i skafferiet. */
export function guessPlace(name: string): StoragePlace {
  const key = foodKey(name)
  if (has(key, FREEZER)) return 'freezer'
  // "Tomatpuré" och "krossade tomater" står i skafferiet trots att de innehåller "tomat".
  if (has(key, ['tomatpuré', 'krossade', 'konserv', 'burk', 'torkad', 'pulver'])) return 'pantry'
  if (has(key, FRIDGE)) return 'fridge'
  return 'pantry'
}

export const placeOf = (item: Pick<PantryItem, 'name' | 'place'>): StoragePlace => item.place ?? guessPlace(item.name)

export const PLACE_LABELS: Record<StoragePlace, string> = { fridge: 'Kylskåp', freezer: 'Frys', pantry: 'Skafferi' }

/** Ikon för varan. Mer specifika ord står först. */
const EMOJI: [string[], string][] = [
  [['glass'], '🍨'],
  [['fiskpinn', 'torsk', 'fisk', 'sej'], '🐟'],
  [['lax'], '🍣'],
  [['räk'], '🦐'],
  [['kyckling'], '🍗'],
  [['bacon'], '🥓'],
  [['korv'], '🌭'],
  [['färs', 'kött', 'fläsk', 'biff', 'entrecote', 'oxfilé'], '🥩'],
  [['ägg'], '🥚'],
  [['mjölk', 'fil', 'grädde'], '🥛'],
  [['yoghurt', 'kvarg'], '🥣'],
  [['smör'], '🧈'],
  [['ost', 'mozzarella', 'halloumi', 'keso'], '🧀'],
  [['tomatpuré', 'krossade', 'konserv', 'burk', 'bönor', 'kikärt', 'linser'], '🥫'],
  [['tomat'], '🍅'],
  [['gurka'], '🥒'],
  [['sallad', 'spenat', 'ruccola'], '🥬'],
  [['broccoli', 'blomkål'], '🥦'],
  [['paprika', 'chili'], '🫑'],
  [['morot', 'morötter'], '🥕'],
  [['svamp', 'champinjon'], '🍄'],
  [['majs'], '🌽'],
  [['vitlök'], '🧄'],
  [['lök', 'purjo'], '🧅'],
  [['potatis', 'pommes'], '🥔'],
  [['avokado'], '🥑'],
  [['citron', 'lime'], '🍋'],
  [['äpple'], '🍎'],
  [['banan'], '🍌'],
  [['apelsin', 'clementin'], '🍊'],
  [['jordgubb', 'hallon'], '🍓'],
  [['blåbär', 'druv'], '🫐'],
  [['spaghetti', 'pasta', 'makaron', 'nudl'], '🍝'],
  [['ris'], '🍚'],
  [['bröd', 'knäcke', 'tortilla'], '🍞'],
  [['havregryn', 'müsli', 'flingor', 'mjöl'], '🌾'],
  [['honung'], '🍯'],
  [['olja', 'vinäger'], '🫒'],
  [['kaffe'], '☕'],
  [['te'], '🍵'],
  [['choklad'], '🍫'],
  [['nötter', 'mandel', 'jordnöt'], '🥜'],
  [['juice'], '🧃'],
  [['salt', 'peppar', 'krydd', 'buljong', 'socker'], '🧂'],
]

export function emojiFor(name: string, place: StoragePlace = guessPlace(name)): string {
  const key = foodKey(name)
  for (const [words, emoji] of EMOJI) if (words.some((w) => (w.length <= 3 ? key.split(/[ ,-]/).some((part) => part === w || part.startsWith(w)) : key.includes(w)))) return emoji
  return place === 'freezer' ? '🧊' : place === 'fridge' ? '🥡' : '🫙'
}
