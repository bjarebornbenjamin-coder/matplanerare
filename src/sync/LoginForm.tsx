import { useState, type CSSProperties, type FormEvent } from 'react'
import { DEFAULT_FOOD } from '../db/repo'
import { useSettings } from '../hooks'
import { answerSummary } from '../domain/onboarding'
import { reopenOnboarding, useOnboarding } from '../lib/onboarding'
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

/** `prefer` = knappen som står först och som Enter väljer: skapa konto för den som är ny, annars logga in. */
export function LoginForm({ intro, prefer = 'in' }: { intro?: string; prefer?: 'in' | 'up' }) {
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
    <form className="login-form" onSubmit={(e) => auth(prefer, e)}>
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
        {(prefer === 'up' ? (['up', 'in'] as const) : (['in', 'up'] as const)).map((kind, i) => (
          <button key={kind} type={i === 0 ? 'submit' : 'button'} className={`btn wide${i === 0 ? ' primary' : ''}`} disabled={busy !== null || !email || !password} onClick={i === 0 ? undefined : () => auth(kind)}>
            {kind === 'in' ? (busy === 'in' ? 'Loggar in…' : 'Logga in') : busy === 'up' ? 'Skapar konto…' : 'Skapa konto'}
          </button>
        ))}
      </div>
      <p className="muted small">{prefer === 'up' ? 'Skriv e-post och ett lösenord (minst 6 tecken) och tryck Skapa konto. Har du redan ett konto trycker du Logga in.' : 'Första gången: skriv e-post och ett lösenord (minst 6 tecken) och tryck Skapa konto.'}</p>
    </form>
  )
}

/** Första sidan när synken är installerad men ingen är inloggad. Den som just svarat på frågorna ser sina val här. */
export function LoginScreen() {
  const { answers } = useOnboarding()
  const settings = useSettings()
  return (
    <div className="login">
      <div className="eyebrow">Matplaneraren</div>
      {answers ? (
        <>
          <h1>Sista steget</h1>
          <p className="muted">Skapa ett konto eller logga in, så sparas dina val och menyn följer med mellan mobil och dator.</p>
          <div className="login-picks">
            <div className="login-picks-head">
              <span>Dina val</span>
              <button type="button" className="btn text" onClick={reopenOnboarding}>Ändra</button>
            </div>
            <ul>
              {answerSummary(answers, settings?.food.portions ?? DEFAULT_FOOD.portions).map((t, i) => <li key={t} style={{ '--i': i } as CSSProperties}>{t}</li>)}
            </ul>
          </div>
        </>
      ) : (
        <>
          <h1>Välkommen</h1>
          <p className="muted">Planera veckans mat, håll koll på det du har hemma och handla smart. Logga in en gång per enhet, så följer allt med mellan mobil och dator.</p>
        </>
      )}
      <div className="card login-card">
        <LoginForm prefer={answers ? 'up' : 'in'} />
      </div>
      {!answers && <button type="button" className="btn text login-ask" onClick={reopenOnboarding}>Välj portioner, kost och allergier först</button>}
    </div>
  )
}
