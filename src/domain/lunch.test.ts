import { describe, expect, it } from 'vitest'
import { isRealLunch } from './lunch'

describe('vad som räknas som en riktig lunch', () => {
  it('smoothies, fruktsallader, gröt, bakverk och efterrätter är inte luncher', () => {
    for (const t of [
      'Fruktsallad med mango och ananas', 'Green smoothie med kiwi och spenat', 'Smoothie bowl med hallon', 'Grön smoothie', 'Proteinshake med banan',
      'Havregrynsgröt med äpple', 'Overnight oats med blåbär', 'Yoghurt med granola', 'Kvarg med bär', 'Chiapudding med mango', 'Müsli med mjölk',
      'Kladdkaka', 'Morotskaka med frosting', 'Kanelbullar', 'Äppelpaj med vaniljsås', 'Pannacotta med hallon', 'Blåbärsmuffins', 'Scones med sylt', 'Våfflor med grädde',
      'Jordgubbar med grädde', 'Bär med glass', 'Grillad ananas', 'Melon', 'Färska bär', 'Apelsinjuice', 'Nyponsoppa', 'Energibollar med dadlar', 'Pannkakstårta', 'Açaí bowl', '',
    ]) expect([t, isRealLunch(t)]).toEqual([t, false])
  })
  it('matiga rätter är luncher, även när ett sött eller fruktigt ord ingår', () => {
    for (const t of [
      'Kycklingsallad med currydressing', 'Tonfisksallad', 'Halloumisallad med citron- och gurkröra', 'Linssoppa med bröd', 'Tomatsoppa', 'Pastasallad med pesto',
      'Wrap med kyckling', 'Omelett med ost och skinka', 'Pytt i panna', 'Nudelwok med grönsaker', 'Räkmacka', 'Toast Skagen', 'Quesadilla med bönor', 'Poké bowl med lax',
      'Kyckling med yoghurtsås', 'Lax i ugn med yoghurtdressing', 'Mangosallad med kyckling', 'Sallad med vattenmelon och fetaost', 'Glasnudelsallad', 'Glaserad lax med ris',
      'Saftig kycklingfilé med ris', 'Krämig pasta med svamp', 'Köttbullar med potatismos', 'Fiskbullar i dillsås', 'Smörgåstårta', 'Äggmuffins med spenat', 'Shakshuka',
      'Fish and chips', 'Västerbottenpaj', 'Pannkakor med sylt', 'Risotto med ost, prinskorv, snacksmorötter, gurka och tomat', 'Äppelfläsk med lök', 'Bananpannkakor med keso',
    ]) expect([t, isRealLunch(t)]).toEqual([t, true])
  })
})
