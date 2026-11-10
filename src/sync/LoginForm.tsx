import { useState, type FormEvent } from 'react'
import { keyHint, projectHint, supabase } from './supabase'

/** Supabase svarar på engelska; de vanligaste felen översätts. */
export function loginError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid api key') || m.includes('no api key')) {
    return `Supabase godkänner inte nyckeln i VITE_SUPABASE_ANON_KEY. Appen använder ${keyHint} för ${projectHint}. Jämför med Publishable key i Supabase (Project Settings → API Keys): kopiera den med kopieringsknappen, inte genom att markera texten, lägg in den igen i Vercel och gör Redeploy.`
  }
  if (m.includes('invalid login credentials')) return 'Fel e-post eller lösenord.'
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'Det går inte att skapa nya konton. Logga in med ditt befintliga konto.'
  if (m.includes('already registered')) return 'Det finns redan ett konto med den e-postadressen. Logga in i stället.'
  if (m.includes('email not confirmed')) return 'E-postadressen är inte bekräftad. Klicka på länken i mejlet från Supabase, eller stäng av Confirm email i Supabase.'
  if (m.includes('password should be at least')) return 'Lösenordet måste vara minst 6 tecken.'
  if (m.includes('unable to validate email') || m.includes('invalid format')) return 'E-postadressen ser inte rätt ut.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Kunde inte nå Supabase. Kontrollera internetanslutningen.'
  return message
}

/** Öga som visar läget: öppet när lösenordet syns, överstruket när det är dolt. */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  )
}

export function LoginForm({ intro }: { intro?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [message, setMessage] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState<'in' | 'up' | null>(null)
  if (!supabase) return null
  const client = supabase

  async function auth(kind: 'in' | 'up', e?: FormEvent) {
    e?.preventDefault()
    if (kind === 'up' && password.length < 6) return setMessage('Lösenordet måste vara minst 6 tecken.')
    setBusy(kind)
    setMessage('')
    setInfo('')
    const { data, error } =
      kind === 'up'
        ? await client.auth.signUp({ email: email.trim(), password })
        : await client.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(null)
    if (error) return setMessage(loginError(error.message))
    if (kind === 'up' && !data.session) setInfo('Kontot är skapat. Bekräfta e-postadressen via mejlet och logga sedan in.')
    else setPassword('')
  }

  return (
    <form className="login-form" onSubmit={(e) => auth('in', e)}>
      {intro && <p className="muted">{intro}</p>}
      <label className="field">
        <span>E-post</span>
        <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Lösenord</span>
        <span className="password-field">
          <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="icon-btn" aria-pressed={show} aria-label={show ? 'Dölj lösenordet' : 'Visa lösenordet'} title={show ? 'Dölj lösenordet' : 'Visa lösenordet'} onClick={() => setShow((v) => !v)}>
            <EyeIcon open={show} />
          </button>
        </span>
      </label>
      {message && <p className="error" role="alert">{message}</p>}
      {info && <p className="muted" role="status">{info}</p>}
      <div className="login-buttons">
        <button type="submit" className="btn primary wide" disabled={busy !== null || !email || !password}>{busy === 'in' ? 'Loggar in…' : 'Logga in'}</button>
        <button type="button" className="btn wide" disabled={busy !== null || !email || !password} onClick={() => auth('up')}>{busy === 'up' ? 'Skapar konto…' : 'Skapa konto'}</button>
      </div>
      <p className="muted small">Första gången: skriv e-post och ett lösenord (minst 6 tecken) och tryck Skapa konto.</p>
    </form>
  )
}

/** Första sidan när synken är installerad men ingen är inloggad. */
export function LoginScreen() {
  return (
    <div className="login">
      <div className="eyebrow">Matplaneraren</div>
      <h1>Välkommen</h1>
      <p className="muted">Planera veckans mat, håll koll på det du har hemma och handla smart. Logga in en gång per enhet, så följer allt med mellan mobil och dator.</p>
      <div className="card login-card">
        <LoginForm />
      </div>
    </div>
  )
}
