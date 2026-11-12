import { useEffect, useState, type CSSProperties } from 'react'
import { AiProgress } from './AiProgress'
import { DishPhoto } from './DishPhoto'

export interface CookRow {
  date: string
  /** "Idag", "Tor" osv. */
  label: string
  day: number
  /** Middagens namn när den är vald. */
  dinner?: string
  /** Receptet är hämtat. */
  ready?: boolean
  /** Receptets bild, när den finns. */
  image?: string
  /** Frukost och lunch för dagen, om sådana planeras. */
  extras?: string
}

interface Props {
  /** plan = AI:n väljer rätter, recipes = recepten hämtas, done = klart. */
  stage: 'plan' | 'recipes' | 'done'
  rows: CookRow[]
  progress: { label: string; value?: number }
  /** Stäng vyn och låt arbetet fortsätta i bakgrunden. */
  onHide: () => void
  /** Sant medan vyn tonas ut. */
  leaving?: boolean
}

const THINKING = ['Kollar vad som finns hemma', 'Läser dina önskemål', 'Tänker på vad du gillar', 'Väljer rätter som passar dagarna']

/** Grytan som puttrar medan menyn lagas. Ren SVG och CSS, inga bilder. */
function Pot({ done }: { done: boolean }) {
  if (done) {
    return (
      <div className="cook-done" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ '--a': `${i * 30}deg` } as CSSProperties} />)}
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="46" fill="#fff" />
          <path d="M40 62 54 76 82 46" fill="none" stroke="#0b57d0" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  return (
    <svg className="cook-pot" viewBox="0 0 200 190" aria-hidden="true">
      <g className="cook-steam" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
        <path d="M74 62c-9-11 9-17 0-29s9-17 0-28" />
        <path d="M100 62c-9-11 9-17 0-29s9-17 0-28" />
        <path d="M126 62c-9-11 9-17 0-29s9-17 0-28" />
      </g>
      <g className="cook-bubbles" fill="#fff">
        <circle cx="62" cy="90" r="4" />
        <circle cx="140" cy="90" r="3" />
        <circle cx="100" cy="88" r="3.5" />
      </g>
      <g className="cook-lid">
        <circle cx="100" cy="72" r="8" fill="#d3e3fd" />
        <rect x="50" y="78" width="100" height="14" rx="7" fill="#fff" />
      </g>
      <rect x="26" y="106" width="24" height="12" rx="6" fill="#d3e3fd" />
      <rect x="150" y="106" width="24" height="12" rx="6" fill="#d3e3fd" />
      <path d="M46 96h108v42a24 24 0 0 1-24 24H70a24 24 0 0 1-24-24z" fill="#fff" />
      <rect x="46" y="112" width="108" height="8" fill="#d3e3fd" />
      <g className="cook-flames" fill="#ffb74d">
        <path d="M70 186c-7-6-3-12 0-17 3 5 7 11 0 17z" />
        <path d="M100 188c-9-8-4-15 0-22 4 7 9 14 0 22z" />
        <path d="M130 186c-7-6-3-12 0-17 3 5 7 11 0 17z" />
      </g>
    </svg>
  )
}

/**
 * Helskärmsvyn som visas medan menyn görs: grytan puttrar, och rätterna dyker upp dag för dag
 * när AI:n valt dem och får en bock när receptet är hämtat. Visar samma förlopp som stapeln på sidan.
 */
export function CookingOverlay({ stage, rows, progress, onHide, leaving }: Props) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (stage !== 'plan') return
    const t = setInterval(() => setTick((n) => n + 1), 2400)
    return () => clearInterval(t)
  }, [stage])
  // Sidan bakom ska inte gå att rulla medan vyn är öppen.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const done = stage === 'done'
  const headline = done ? 'Menyn är klar!' : stage === 'plan' ? 'Lagar din meny' : 'Hämtar recepten'
  const status = done ? 'Smaklig måltid' : stage === 'plan' ? THINKING[tick % THINKING.length] : progress.label

  return (
    <div className={`cook${leaving ? ' leaving' : ''}${done ? ' is-done' : ''}`} role="dialog" aria-modal="true" aria-label="Menyn görs">
      <div className="cook-glow" aria-hidden="true" />
      <div className="cook-inner">
        <Pot done={done} />
        <h1 className="cook-title" aria-live="polite">{headline}</h1>
        <p key={status} className="cook-status">{status}</p>
        {!done && <AiProgress active expected={20} cap={30} value={progress.value} label={stage === 'plan' ? 'Planerar rätterna' : progress.label} />}
        <ol className="cook-days">
          {rows.map((r, i) => (
            <li key={r.date} className={r.dinner ? 'has-dish' : ''} style={{ '--i': i } as CSSProperties}>
              <span className="cook-date">
                <span>{r.label}</span>
                <strong className="num">{r.day}</strong>
              </span>
              {r.dinner ? (
                <span className="cook-dish">
                  <span className="cook-dish-title">{r.dinner}</span>
                  {r.extras && <span className="cook-dish-extras">{r.extras}</span>}
                </span>
              ) : (
                <span className="cook-skeleton" aria-label="Väljer rätt" />
              )}
              {r.image && <DishPhoto src={r.image} className="cook-thumb" />}
              {r.ready && (
                <svg className="cook-check" viewBox="0 0 24 24" aria-label="Receptet är hämtat">
                  <circle cx="12" cy="12" r="11" fill="#fff" />
                  <path d="M7 12.5 10.5 16 17 9" fill="none" stroke="#0b57d0" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </li>
          ))}
        </ol>
        {!done && <button type="button" className="cook-hide" onClick={onHide}>Dölj och fortsätt i bakgrunden</button>}
      </div>
    </div>
  )
}
