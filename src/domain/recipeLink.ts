const SEARCH = 'https://www.google.com/search?q='

/** En sökning på rättens namn, som reserv om direktlänken hamnar fel. */
export function recipeSearchUrl(title: string): string {
  return SEARCH + encodeURIComponent(`${title.trim()} recept`).replace(/%20/g, '+')
}

