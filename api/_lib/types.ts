export interface ApiRequest {
  method: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
  ip: string
}

export interface ApiResponse {
  status: number
  headers?: Record<string, string>
  body: unknown
}

export interface Env {
  OPENAI_API_KEY?: string
  /** Delat lösenord som appen skickar med (x-app-password). */
  APP_PASSWORD?: string
  /** Kommaseparerade e-postadresser som får använda servern via Supabase-inloggning. */
  ALLOWED_EMAILS?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  /** Kommaseparerade modeller som /api/ai får använda (annars en inbyggd lista). */
  ALLOWED_MODELS?: string
  /** Anrop per besökare och dygn när åtkomsten är öppen (standard 100). */
  OPEN_DAILY_LIMIT?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  CRON_SECRET?: string
  /** Modell för receptsökning med webbsökning (annars provas gpt-4.1-mini, gpt-4o-mini, gpt-5-mini, gpt-4.1). */
  RECIPE_SEARCH_MODEL?: string
}

export type FetchFn = typeof fetch

export const header = (req: ApiRequest, name: string): string => {
  const v = req.headers[name.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): ApiResponse => ({ status, body, headers })
export const errorBody = (status: number, message: string): ApiResponse => json(status, { error: { message } })
