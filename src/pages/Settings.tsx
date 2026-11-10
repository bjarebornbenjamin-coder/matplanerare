import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { syncConfigured, useSession } from '../sync/supabase'
import { useNotifyStatus } from '../push/useNotifyStatus'
import { DEFAULT_MODEL, FALLBACK_MODELS, fetchModels } from '../ai/models'
import { NotifySection } from '../push/NotifySection'
import { SyncSection } from '../sync/SyncSection'
import { diagnose, type Diagnosis } from '../ai/diagnose'
import { setBackgroundImage, setBackgroundVeil, useBackground } from '../lib/background'
import { imageToDataUrl } from '../lib/image'
import { authHeaders } from '../lib/auth'
import { parseBackup } from '../db/backup'
import { exportAll, importAll, saveAiConfig, saveSettings } from '../db/repo'
import { toISODate } from '../domain/dates'
import type { Theme } from '../domain/types'
import { useAiConfig, useFieldError, useSettings } from '../hooks'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Som enheten' },
  { value: 'light', label: 'Ljust' },
  { value: 'dark', label: 'Mörkt' },
]

/** OpenAI-nycklar börjar med sk-. Ett lösenord till servern ska aldrig vara en sådan. */
export const looksLikeOpenAiKey = (v: string) => /^sk-[A-Za-z0-9_-]{16,}/.test(v.trim())

function AiSection() {
  const config = useAiConfig()
  const [password, setPassword] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsMsg, setModelsMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const { error: passwordError, fail, touch } = useFieldError()
  if (!config) return null
  const models = [...new Set([config.model, ...(config.models ?? FALLBACK_MODELS)])]
  return (
    <>
      <h2>Modell</h2>
      <label className="field">
        <span>Används i chatten och när AI:n läser bilder, gör veckomeny och uppskattar näring</span>
        <select value={config.model} onChange={(e) => saveAiConfig({ model: e.target.value })}>
          {models.map((m) => <option key={m} value={m}>{m}{m === DEFAULT_MODEL ? ' (standard)' : ''}</option>)}
        </select>
      </label>
      <p className="muted">
        {config.models ? `Listan är hämtad från OpenAI.` : 'Listan är förvald.'} Fungerar inte modellen används {DEFAULT_MODEL}.{' '}
        <button
          type="button"
          className="btn text inline"
          disabled={loadingModels}
          onClick={async () => {
            setLoadingModels(true)
            setModelsMsg('')
            try {
              const list = await fetchModels(await authHeaders())
              await saveAiConfig({ models: list })
              setModelsMsg(`Hämtade ${list.length} modeller.`)
            } catch (e) {
              setModelsMsg(e instanceof Error ? e.message : 'Kunde inte hämta listan.')
            } finally {
              setLoadingModels(false)
            }
          }}
        >
          {loadingModels ? 'Hämtar…' : 'Hämta aktuell lista'}
        </button>
      </p>
      {modelsMsg && <p className="muted" role="status">{modelsMsg}</p>}

      <h2>Lösenord till servern</h2>
      {config.password && looksLikeOpenAiKey(config.password) && (
        <p className="error" role="alert">Det sparade lösenordet ser ut som en OpenAI-nyckel. Ta bort det, lägg nyckeln i Vercel och skriv ditt APP_PASSWORD här.</p>
      )}
      {config.password ? (
        <div className="card row-between">
          <span>Lösenord sparat</span>
          <button type="button" className="btn text danger" onClick={() => saveAiConfig({ password: '' })}>Ta bort</button>
        </div>
      ) : (
        <>
          <p className="muted">Samma som APP_PASSWORD i Vercel. Valfritt, men utan det kan alla med adressen använda din OpenAI-nyckel.</p>
          <form
            className="add-row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              const value = password.trim()
              if (!value) return
              if (looksLikeOpenAiKey(value)) {
                fail('password', 'Det här ser ut som en OpenAI-nyckel. Den ska inte skrivas här utan läggas i Vercel som OPENAI_API_KEY. Här ska du skriva lösenordet du själv valt som APP_PASSWORD.')
                return
              }
              void saveAiConfig({ password: value })
              setPassword('')
            }}
          >
            <input type="password" aria-label="Serverns lösenord" placeholder="Lösenord" autoComplete="off" value={password} onChange={(e) => { setPassword(e.target.value); touch('password') }} />
            <button type="submit" className="btn primary">Spara</button>
          </form>
          {passwordError && <p className="error" role="alert">{passwordError}</p>}
        </>
      )}

      <h2>Anslutning</h2>
      <p className="muted">Kontrollerar att servern, lösenordet och OpenAI-nyckeln fungerar.</p>
      <div className="actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={testing}
          onClick={async () => {
            setTesting(true)
            setDiagnosis(null)
            setDiagnosis(await diagnose(await authHeaders()))
            setTesting(false)
          }}
        >
          {testing ? 'Testar…' : 'Testa anslutningen'}
        </button>
      </div>
      {diagnosis && <p className={diagnosis.ok ? 'done-note' : 'error'} role="status">{diagnosis.ok ? '✓ ' : ''}{diagnosis.message}</p>}
    </>
  )
}

function BackgroundSection() {
  const bg = useBackground()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  if (!bg) return null

  async function choose(file: File) {
    setBusy(true)
    setMessage('')
    try {
      await setBackgroundImage(await imageToDataUrl(file, 1920, 2_500_000))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kunde inte använda bilden.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <p className="muted">Till exempel en fri impressionistisk målning (Monet, Renoir, Morisot). Sparas bara på den här enheten.</p>
      {bg.image && <img src={bg.image} alt="Vald bakgrundsbild" className="bg-preview" />}
      {bg.image && (
        <label className="field">
          <span>Tydlighet på bilden</span>
          <input
            type="range"
            className="range"
            min={5}
            max={70}
            step={5}
            value={Math.round((1 - bg.veil) * 100)}
            aria-valuetext={`${Math.round((1 - bg.veil) * 100)} % av bilden syns`}
            onChange={(e) => setBackgroundVeil(1 - Number(e.target.value) / 100)}
          />
          <span className="sub" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lugn</span><span>Tydlig</span></span>
        </label>
      )}
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Läser bilden…' : bg.image ? 'Byt bild' : 'Välj bild'}</button>
        {bg.image && <button type="button" className="btn danger" onClick={() => setBackgroundImage(null)}>Ta bort bilden</button>}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
      </div>
      {message && <p className="error" role="alert">{message}</p>}
    </>
  )
}

function WaterSection() {
  const settings = useSettings()
  const [draft, setDraft] = useState<{ waterMl?: string; glassMl?: string }>({})
  if (!settings) return null
  const n = settings.nutrition
  const field = (key: 'waterMl' | 'glassMl', label: string, min: number, max: number) => (
    <label className="field">
      <span>{label} (ml)</span>
      <input
        type="text"
        inputMode="numeric"
        value={draft[key] ?? String(n[key])}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => {
          const v = Math.round(Number((draft[key] ?? '').replace(',', '.')))
          setDraft((d) => ({ ...d, [key]: undefined }))
          if (draft[key] !== undefined && Number.isFinite(v) && v >= min && v <= max) void saveSettings({ nutrition: { ...n, [key]: v } })
        }}
      />
    </label>
  )
  return (
    <>
      <p className="muted">Fyll på glas direkt på startsidan.</p>
      <div className="two">
        {field('waterMl', 'Mål per dag', 0, 20000)}
        {field('glassMl', 'Ett glas', 50, 2000)}
      </div>
    </>
  )
}

function MemorySection() {
  const settings = useSettings()
  const [fact, setFact] = useState('')
  if (!settings) return null
  const memories = settings.memories
  return (
    <>
      <p className="muted">Saker assistenten tar hänsyn till i alla svar. Be chatten komma ihåg något ("jag gillar inte svamp"), eller skriv in det här.</p>
      {memories.length === 0 && <p className="empty">Inget sparat.</p>}
      {memories.map((m) => (
        <div className="item" key={m}>
          <span style={{ flex: 1, alignSelf: 'center' }}>{m}</span>
          <button type="button" className="btn danger" aria-label={`Glöm: ${m}`} onClick={() => saveSettings({ memories: memories.filter((x) => x !== m) })}>Glöm</button>
        </div>
      ))}
      <form
        className="item"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          const f = fact.trim().slice(0, 200)
          if (!f || memories.includes(f) || memories.length >= 30) return
          void saveSettings({ memories: [...memories, f] })
          setFact('')
        }}
      >
        <input type="text" aria-label="Något att komma ihåg" placeholder="t.ex. Jag tränar helst på morgonen" value={fact} onChange={(e) => setFact(e.target.value)} />
        <button type="submit" className="btn">Lägg till</button>
      </form>
    </>
  )
}

export function SettingsPage() {
  const { del } = useParams()
  const settings = useSettings()
  const config = useAiConfig()
  const session = useSession()
  const notify = useNotifyStatus()
  const background = useBackground()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  if (!settings) return null


  async function download() {
    const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `matplaneraren-${toISODate(new Date())}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setMessage({ text: `Säkerhetskopia sparad som ${a.download} (i Hämtade filer).`, error: false })
  }

  async function upload(file: File) {
    try {
      const backup = parseBackup(JSON.parse(await file.text()))
      if (!confirm(`Importen ersätter ALL data i appen (${backup.pantry.length} varor i lagret, ${backup.mealPlan.length} middagar i menyn). Fortsätta?`)) return
      await importAll(backup)
      setMessage({ text: 'Importen är klar.', error: false })
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Kunde inte läsa filen.', error: true })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const sections: Record<string, { title: string; body: ReactNode }> = {
    utseende: {
      title: 'Utseende',
      body: (
        <>
          <h2>Tema</h2>
          <div className="seg" role="group" aria-label="Tema">
            {THEMES.map((t) => (
              <button key={t.value} type="button" className="tab" aria-pressed={settings.theme === t.value} onClick={() => saveSettings({ theme: t.value })}>{t.label}</button>
            ))}
          </div>
          <h2>Bakgrundsbild</h2>
          <BackgroundSection />
        </>
      ),
    },
    vatten: { title: 'Vatten', body: <WaterSection /> },
    synk: { title: 'Synk mellan enheter', body: <SyncSection /> },
    notiser: { title: 'Notiser', body: <NotifySection /> },
    ai: { title: 'AI-assistent', body: <AiSection /> },
    minne: { title: 'Assistentens minne', body: <MemorySection /> },
    sakerhetskopia: {
      title: 'Säkerhetskopia',
      body: (
        <>
          <p className="muted">{syncConfigured ? 'Med synk påslagen finns datan även i molnet, men en egen kopia skadar inte.' : 'All data ligger bara på den här enheten. Exportera regelbundet.'}</p>
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn primary" onClick={download}>Exportera JSON</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Importera JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
          {message && <p className={message.error ? 'error' : 'muted'} role="status">{message.text}</p>}
        </>
      ),
    },
  }

  const open = del ? sections[del] : undefined
  if (open) {
    return (
      <>
        <Link to="/installningar" className="back">‹ Inställningar</Link>
        <h1>{open.title}</h1>
        {open.body}
      </>
    )
  }

  const theme = THEMES.find((t) => t.value === settings.theme)!.label
  const groups: { title: string; rows: { to: string; title: string; status: string }[] }[] = [
    {
      title: 'Allmänt',
      rows: [
        { to: 'utseende', title: 'Utseende', status: `${theme}${background?.image ? ', egen bakgrundsbild' : ''}` },
        { to: 'vatten', title: 'Vatten', status: `Mål ${(settings.nutrition.waterMl / 1000).toLocaleString('sv-SE')} l, glas ${settings.nutrition.glassMl} ml` },
      ],
    },
    {
      title: 'Kopplingar',
      rows: [
        { to: 'synk', title: 'Synk mellan enheter', status: !syncConfigured ? 'Inte installerad' : session ? `Inloggad som ${session.user.email}` : 'Inte inloggad' },
        { to: 'notiser', title: 'Notiser', status: !notify ? '' : notify.on ? [settings.food.expiry.enabled && 'mat som går ut', settings.food.shopping.enabled && 'inköpslistan'].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) || 'På' : 'Av' },
      ],
    },
    {
      title: 'AI',
      rows: [
        { to: 'ai', title: 'AI-assistent', status: `${config?.model ?? DEFAULT_MODEL}${config?.password ? ', lösenord sparat' : ''}` },
        { to: 'minne', title: 'Assistentens minne', status: settings.memories.length ? `${settings.memories.length} ${settings.memories.length === 1 ? 'sak' : 'saker'}` : 'Inget sparat' },
      ],
    },
    { title: 'Data', rows: [{ to: 'sakerhetskopia', title: 'Säkerhetskopia', status: 'Exportera eller importera all data' }] },
  ]

  return (
    <>
      <Link to="/" className="back">‹ Tillbaka</Link>
      <h1>Inställningar</h1>
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2>{g.title}</h2>
          <div className="settings-list">
            {g.rows.map((r) => (
              <Link key={r.to} to={`/installningar/${r.to}`} className="settings-row">
                <span>
                  <span className="title">{r.title}</span>
                  {r.status && <span className="sub">{r.status}</span>}
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
