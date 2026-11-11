export const DEFAULT_MODEL = 'gpt-4o-mini'

/** Används tills listan hämtats från OpenAI. Kan vara inaktuell, hämta en färsk lista i Inställningar. */
export const FALLBACK_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-5-mini', 'gpt-5']

const EXCLUDE = /(audio|realtime|transcribe|tts|image|embedding|instruct|search|moderation|whisper|dall|codex|computer-use|preview)/
const SNAPSHOT = /(-\d{4}-\d{2}-\d{2}|-\d{4})$/

/** Väljer ut textmodeller (gpt-*, o*) ur OpenAIs modelllista, utan datumstämplade versioner. */
export function filterTextModels(ids: string[]): string[] {
  const kept = ids.filter((id) => /^(gpt-|o\d)/.test(id) && !EXCLUDE.test(id) && !SNAPSHOT.test(id))
  return [...new Set([DEFAULT_MODEL, ...kept])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export async function fetchModels(headers: Record<string, string> = {}, fetchFn: typeof fetch = fetch): Promise<string[]> {
  let res: Response
  try {
    res = await fetchFn('/api/models', { headers })
  } catch {
    throw new Error('Kunde inte nå servern. Kontrollera internetanslutningen.')
  }
  if (res.status === 401) throw new Error('Fel lösenord.')
  if (!res.ok) throw new Error(`Servern svarade med fel ${res.status}.`)
  const data = (await res.json()) as { data?: { id?: string }[] }
  const models = filterTextModels((data.data ?? []).map((m) => m.id ?? ''))
  if (models.length <= 1) throw new Error('Hittade inga textmodeller i svaret.')
  return models
}
