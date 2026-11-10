import { Link } from 'react-router-dom'
import { withPantryStatus } from '../ai/recipes'
import { WEEKDAYS_SHORT, addDays, parseISODate, toISODate, weekdayOf } from '../domain/dates'
import { expiringWithin } from '../domain/food'
import { goalKcal, mealsOn, totalsOf } from '../domain/nutrition'
import { useMealPlan, useMeals, useNow, usePantry, useSettings, useShopping, useWater } from '../hooks'

const sv1 = (v: number) => v.toLocaleString('sv-SE', { maximumFractionDigits: 1 })
const R = 34
const C = 2 * Math.PI * R

interface Segment {
  value: number
  color: string
}

/** Ring som fylls mot ett mål. Flera delar läggs efter varandra (t.ex. kalorier från protein, kolhydrater och fett). */
function Ring({ label, value, unit, goal, segments }: { label: string; value: string; unit: string; goal: number; segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  let offset = 0
  const pct = goal > 0 ? Math.round((total / goal) * 100) : 0
  return (
    <div className="ring" role="img" aria-label={`${label}: ${value} ${unit}, ${pct} % av målet`}>
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={R} className="ring-track" />
        {segments.map((seg, i) => {
          const len = goal > 0 ? Math.min(C - offset, (seg.value / goal) * C) : 0
          const el = len > 0 ? (
            <circle key={i} cx="40" cy="40" r={R} className="ring-seg" stroke={seg.color} strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset} />
          ) : null
          offset += Math.max(0, len)
          return el
        })}
      </svg>
      <div className="ring-center">
        <span className="ring-value">{value}</span>
        <span className="ring-unit">{unit}</span>
      </div>
      <div className="ring-label">{label}</div>
    </div>
  )
}

export function Dashboard() {
  const settings = useSettings()
  const plan = useMealPlan()
  const pantry = usePantry()
  const shopping = useShopping()
  const meals = useMeals()
  const water = useWater()
  const today = toISODate(useNow())
  if (!settings || !plan || !pantry || !shopping || !meals || !water) return null

  const g = settings.nutrition
  const t = totalsOf(mealsOn(today, meals))
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
              {tonight.nutrition && <span>{tonight.nutrition.kcal} kcal</span>}
              <span>{lacking ? `${lacking} saknas` : 'Allt finns hemma'}</span>
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
              <Link className="btn on-hero-ghost" to="/recept">Hitta ett recept</Link>
            </div>
          </>
        )}
      </section>

      <Link to="/kost" className="rings" aria-label="Dagens kost, öppna Kost">
        <Ring
          label="Kalorier"
          value={String(t.kcal)}
          unit={`av ${goalKcal(g)}`}
          goal={goalKcal(g)}
          segments={[
            { value: t.protein * 4, color: 'var(--viz-protein)' },
            { value: t.carbs * 4, color: 'var(--viz-carbs)' },
            { value: t.fat * 9, color: 'var(--viz-fat)' },
          ]}
        />
        <Ring label="Protein" value={sv1(t.protein)} unit={`av ${g.proteinG} g`} goal={g.proteinG} segments={[{ value: t.protein, color: 'var(--viz-protein)' }]} />
        <Ring label="Vatten" value={sv1(ml / 1000)} unit={`av ${sv1(g.waterMl / 1000)} l`} goal={g.waterMl} segments={[{ value: ml, color: 'var(--viz-water)' }]} />
      </Link>

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
