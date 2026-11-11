import { fetchWithTimeout } from '../lib/http'

export interface Diagnosis {
  ok: boolean
  /** Förklaring på vanlig svenska, med nästa steg. */
  message: string
}

interface HealthDetails {
  openaiKeyConfigured: boolean
  openAccess?: boolean
  openai: { ok: boolean; status: number; code?: string } | null
}

/**
 * Testar steg för steg: når vi servern, har vi åtkomst (lösenord eller inloggning), finns nyckeln
 * och godtar OpenAI den. Detaljerna visas bara för den som har åtkomst.
 */
export async function diagnose(headers: Record<string, string> = {}, fetchFn: typeof fetch = fetch): Promise<Diagnosis> {
  try {
    const res = await fetchWithTimeout('/api/health', {}, fetchFn)
    if (res.status === 404) return { ok: false, message: 'Servern hittar inte /api/health. Appen är troligen inte deployad med den senaste versionen. Kontrollera Vercel → Deployments.' }
    if (!res.ok) return { ok: false, message: `Serverfunktionerna svarar med fel ${res.status}. Titta i Vercel → Logs för förklaringen.` }
  } catch {
    return { ok: false, message: 'Kunde inte nå servern. Är du online, och är det här den deployade appen (inte en lokal utvecklingsserver utan `vercel dev`)?' }
  }

  if (headers['x-app-password'] && /^sk-[A-Za-z0-9_-]{16,}/.test(headers['x-app-password']))
    return { ok: false, message: 'Lösenordet du sparat här ser ut som en OpenAI-nyckel. Ta bort det, lägg nyckeln i Vercel som OPENAI_API_KEY och skriv ditt eget APP_PASSWORD här.' }

  let health: HealthDetails
  try {
    const res = await fetchWithTimeout('/api/health', { method: 'POST', headers }, fetchFn)
    if (res.status === 401)
      return {
        ok: false,
        message: headers.Authorization
          ? 'Inloggningen godtogs inte av servern (utgången eller ogiltig). Logga ut och in igen.'
          : headers['x-app-password']
            ? 'Servern nås, men lösenordet du skrivit in här stämmer inte med APP_PASSWORD i Vercel.'
            : 'Servern kräver inloggning eller lösenord. Logga in, eller skriv APP_PASSWORD här i Inställningar.',
      }
    if (res.status === 403) return { ok: false, message: 'Inloggningen är giltig men din e-postadress står inte i ALLOWED_EMAILS i Vercel (eller så saknas ALLOWED_EMAILS).' }
    if (res.status === 429) return { ok: false, message: 'För många försök. Vänta en minut och testa igen.' }
    if (!res.ok) return { ok: false, message: `Servern svarade med fel ${res.status}. Titta i Vercel → Logs för förklaringen.` }
    health = (await res.json()) as HealthDetails
  } catch {
    return { ok: false, message: 'Kunde inte nå servern när åtkomsten testades.' }
  }

  if (!health.openaiKeyConfigured)
    return { ok: false, message: 'Servern saknar OPENAI_API_KEY. Lägg in den i Vercel → Settings → Environment Variables (för Production), och gör sedan Redeploy. Variabeln måste heta exakt så.' }
  if (!health.openai?.ok) {
    const { status, code } = health.openai ?? { status: 0 }
    if (code === 'invalid_api_key' || status === 401)
      return { ok: false, message: 'OpenAI avvisar nyckeln som servern har (ogiltig, borttagen eller felkopierad). Skapa en ny på platform.openai.com/api-keys, ersätt OPENAI_API_KEY i Vercel och gör Redeploy.' }
    if (code === 'insufficient_quota' || status === 429)
      return { ok: false, message: 'Nyckeln är giltig men OpenAI-kontot har inga tegoder kvar eller har nått en gräns. Kontrollera Billing på platform.openai.com. Ett API-konto är skilt från ett ChatGPT-abonnemang och kräver eget saldo.' }
    if (code === 'unreachable') return { ok: false, message: 'Servern kunde inte nå OpenAI just nu. Försök igen om en stund.' }
    return { ok: false, message: `OpenAI svarade med fel ${status}${code ? ` (${code})` : ''}.` }
  }
  if (health.openAccess)
    return {
      ok: true,
      message:
        'Allt fungerar. Obs: åtkomsten är öppen, så alla som har webbadressen kan använda din OpenAI-nyckel (med en gräns per besökare). Sätt en utgiftsgräns hos OpenAI, eller lägg in APP_PASSWORD i Vercel om du vill skydda den.',
    }
  return { ok: true, message: 'Allt fungerar: servern, OpenAI-nyckeln och din åtkomst. Veckomenyn och skanningen ska nu fungera.' }
}
