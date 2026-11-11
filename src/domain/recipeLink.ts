const SEARCH = 'https://www.google.com/search?q='

/** En sökning på rättens namn, som reserv om direktlänken hamnar fel. */
export function recipeSearchUrl(title: string): string {
  return SEARCH + encodeURIComponent(`${title.trim()} recept`).replace(/%20/g, '+')
}


/**
 * Adressen om den är https, annars undefined. Används där receptlänkar skrivs ut, så att en
 * javascript:- eller data:-adress (t.ex. i synkad eller importerad data) aldrig blir en klickbar länk.
 */
export function httpsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}
