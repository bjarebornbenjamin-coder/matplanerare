import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { addWater } from '../db/repo'
import { withPantryStatus } from '../ai/recipes'
import { WEEKDAYS_SHORT, addDays, parseISODate, toISODate, weekdayOf } from '../domain/dates'
import { expiringWithin } from '../domain/food'
import { useMealPlan, useNow, usePantry, useSettings, useShopping, useWater } from '../hooks'

const liters = (ml: number) => (ml / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 2 })
const R = 34
const C = 2 * Math.PI * R

/** Ring som fylls mot ett mål. */
function Ring({ value, goal, color, children }: { value: number; goal: number; color: string; children: ReactNode }) {
  const len = goal > 0 ? Math.min(1, value / goal) * C : 0
  return (
    <div className="ring" aria-hidden="true">
      <svg viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={R} className="ring-track" />
        {len > 0 && <circle cx="40" cy="40" r={R} className="ring-seg" stroke={color} strokeDasharray={`${len} ${C}`} />}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

export function Dashboard() {
  const settings = useSettings()
  const plan = useMealPlan()
  const pantry = usePantry()
  const shopping = useShopping()
  const water = useWater()
  const today = toISODate(useNow())
  if (!settings || !plan || !pantry || !shopping || !water) return null

  const g = settings.nutrition
  const ml = water.find((w) => w.date === today)?.ml ?? 0
  const tonight = plan.find((d) => d.date === today)
  const lacking = tonight ? withPantryStatus(tonight.ingredients, pantry).filter((i) => i.status === 'missing').length : 0
  const expiring = expiringWithin(pantry, today)
  const toBuy = shopping.filter((i) => !i.done).length
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i))

  return (
    <div className="dash">
      <section className={`tonight${tonight ? '' : ' empty-tonight'}`} aria-label="Ikväll">
        <div className="tonight-kicker">Ikväll</div>
        {tonight ? (
          <>
            <div className="tonight-title">{tonight.title}</div>
            <div className="tonight-meta">
              {tonight.minutes !== null && <span>{tonight.minutes} min</span>}
              {tonight.url ? <span>{lacking ? `${lacking} saknas` : 'Allt finns hemma'}</span> : <span>Receptet saknas</span>}
            </div>
            <div className="tonight-actions">
              {tonight.url ? (
                <a className="btn on-hero" href={tonight.url} target="_blank" rel="noreferrer">Öppna receptet</a>
              ) : (
                <a className="btn on-hero" href={`#middag-${tonight.date}`}>Visa middagen</a>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="tonight-title">Ingen middag planerad</div>
            <div className="tonight-actions">
              <a className="btn on-hero" href="#planera">Gör veckomeny</a>
            </div>
          </>
        )}
      </section>

      <section className="water" aria-label="Vatten idag">
        <Ring value={ml} goal={g.waterMl} color="var(--viz-water)">
          <span className="ring-value">{Math.round(g.waterMl > 0 ? (ml / g.waterMl) * 100 : 0)}%</span>
        </Ring>
        <div className="water-body">
          <div className="water-title">Vatten idag</div>
          <div className="sub num" aria-live="polite">{liters(ml)} av {liters(g.waterMl)} l</div>
          <div className="water-actions">
            <button type="button" className="btn primary" onClick={() => addWater(today, g.glassMl)}>+ Glas</button>
            <button type="button" className="btn" aria-label="Ta bort ett glas" disabled={ml === 0} onClick={() => addWater(today, -g.glassMl)}>−</button>
          </div>
        </div>
      </section>

      <div className="stats">
        <Link to="/lager" className={`stat-tile${expiring.length ? ' warn' : ''}`}>
          <span className="stat-num">{expiring.length}</span>
          <span className="stat-label">går ut snart</span>
        </Link>
        <Link to="/inkop" className="stat-tile">
          <span className="stat-num">{toBuy}</span>
          <span className="stat-label">att handla</span>
        </Link>
        <Link to="/lager" className="stat-tile">
          <span className="stat-num">{pantry.length}</span>
          <span className="stat-label">i lagret</span>
        </Link>
      </div>

      <section aria-label="Veckan">
        <h2>Veckan</h2>
        <ol className="week-strip">
          {week.map((date) => {
            const d = plan.find((x) => x.date === date)
            const wd = WEEKDAYS_SHORT[weekdayOf(date) - 1]
            return (
              <li key={date} className={`${date === today ? 'is-today' : ''}${d ? '' : ' is-empty'}`}>
                <a href={d ? `#middag-${date}` : '#planera'}>
                  <span className="ws-day">{date === today ? 'Idag' : wd}</span>
                  <span className="ws-date num">{parseISODate(date).getDate()}</span>
                  <span className="ws-dish">{d ? d.title : '–'}</span>
                </a>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
