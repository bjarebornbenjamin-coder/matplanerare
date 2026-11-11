/** Fel som visas för användaren när ett AI-anrop via servern misslyckas. */
export class AiError extends Error {}

export async function describeError(res: Response): Promise<string> {
  let detail = ''
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    /* svaret var inte JSON */
  }
  if (res.status === 401) return `${detail || 'Fel lösenord.'} Kontrollera lösenordet i Inställningar.`
  if (res.status === 403) return detail || 'Du har inte åtkomst.'
  if (res.status === 429) return detail || 'För många anrop eller slut på tegoder hos OpenAI.'
  if ((res.status === 504 || res.status === 502) && !detail) return `AI:n hann inte svara i tid (fel ${res.status}). Försök igen. Händer det ofta: välj en snabbare modell, t.ex. gpt-4o-mini, under Inställningar → AI.`
  if (res.status === 404) return `Modellen hittades inte. Kontrollera modellnamnet i Inställningar.${detail ? ` ${detail}` : ''}`
  return detail ? `Servern svarade med fel ${res.status}: ${detail}` : `Servern svarade med fel ${res.status} utan förklaring. Kontrollera Vercel → Logs och att miljövariablerna är satta.`
}
