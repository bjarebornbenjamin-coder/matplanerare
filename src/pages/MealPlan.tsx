import { useState } from 'react'
import { AiProgress } from '../components/AiProgress'
import { DoneButton } from '../components/DoneButton'
import { Link } from 'react-router-dom'
import { dayContext, fetchMealPlan, missingForPlan, planStart } from '../ai/mealPlan'
import { withPantryStatus } from '../ai/recipes'
import { IngredientList } from '../components/IngredientList'
import { db } from '../db/db'
import { addShoppingItems, getSettings, saveSettings } from '../db/repo'
import { WEEKDAYS_SHORT, addDays, dayLabel, parseISODate, toHHmm, toISODate, weekdayOf } from '../domain/dates'
import { expiringWithin } from '../domain/food'
import { recipeSearchUrl } from '../domain/recipeLink'
import { findRecipes, splitIngredient } from '../ai/recipeSearch'
import type { PlannedDinner } from '../domain/types'
import { useAiConfig, useMealPlan, useNow, usePantry, useSettings } from '../hooks'
import { authHeaders } from '../lib/auth'
import { undoable } from '../lib/undo'

export function MealPlanTab() {
  const plan = useMealPlan()
  const pantry = usePantry()
  const settings = useSettings()
  const config = useAiConfig()
  const now = useNow()
  const today = toISODate(now)
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finding, setFinding] = useState<Set<string>>(new Set())
  const [notFound, setNotFound] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [openIng, setOpenIng] = useState<Set<string>>(new Set())
  const [wishes, setWishes] = useState<string | null>(null)
  const [allergies, setAllergies] = useState<string | null>(null)
  if (!plan || !pantry || !settings) return null

  const upcoming = plan.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const missing = missingForPlan(upcoming, pantry)
  const expiring = new Set(expiringWithin(pantry, today).map((p) => p.name))

  /** Hämtar ett riktigt recept för middagen och byter AI:ns ingredienser mot receptsidans. */
  async function findRecipe(d: PlannedDinner, headers: Record<string, string>) {
    setFinding((s) => new Set(s).add(d.id))
    try {
      const stored = await getSettings()
      const s = { ...stored, food: { ...stored.food, weekWishes: (wishes ?? stored.food.weekWishes ?? '').trim() } }
      const [r] = await findRecipes({ mode: 'any', dish: d.title, count: 1, pantry: pantry!, food: s.food, memories: s.memories, today }, headers)
      await db.mealPlan.update(d.id, {
        url: r.url,
        site: r.site,
        title: r.title,
        ingredients: r.ingredients.map(splitIngredient).map((i) => ({ name: i.name, amount: i.amount })),
        steps: [],
        ...(r.minutes ? { minutes: r.minutes } : {}),
        updatedAt: new Date().toISOString(),
      })
      setNotFound((s) => { const n = new Set(s); n.delete(d.id); return n })
    } catch {
      setNotFound((s) => new Set(s).add(d.id))
    } finally {
      setFinding((s) => { const n = new Set(s); n.delete(d.id); return n })
    }
  }

  async function generate() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const s = await getSettings()
      const from = planStart(today, toHHmm(now))
      const dates = Array.from({ length: days }, (_, i) => addDays(from, i))
      const recent = plan!.filter((d) => d.date < from && d.date >= addDays(from, -14)).map((d) => d.title)
      const usable = pantry!.filter((p) => !p.expires || p.expires >= today)
      const result = await fetchMealPlan(
        { days: dates.map((d) => dayContext(d, s.food)), pantry: usable, food: s.food, memories: s.memories, recent, today },
        config?.model ?? 'gpt-4o-mini',
        await authHeaders(),
      )
      await undoable(`Veckomeny för ${result.length} dagar`, ['mealPlan'], async () => {
        await db.mealPlan.bulkDelete(dates)
        await db.mealPlan.bulkPut(result.map((d) => ({ ...d, updatedAt: new Date().toISOString() })))
      })
      if (result.length < dates.length) setMessage(`AI:n gav bara ${result.length} av ${dates.length} dagar. Gör om för att fylla resten.`)
      // Riktiga recept, tre åt gången så att servern inte överbelastas.
      const headers = await authHeaders()
      const queue = [...result]
      await Promise.all(Array.from({ length: 3 }, async () => {
        for (let d = queue.shift(); d; d = queue.shift()) await findRecipe(d, headers)
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel.')
    } finally {
      setBusy(false)
    }
  }

  async function shop() {
    const { added, skipped } = await addShoppingItems(missing)
    setMessage(added ? `${added} varor på inköpslistan${skipped ? ` (${skipped} fanns redan)` : ''}.` : 'Allt fanns redan på inköpslistan.')
  }

  return (
    <>
      <h2>Planera</h2>
      <label className="field wish-field">
        <span>Önskemål för veckan</span>
        <textarea
          rows={3}
          maxLength={500}
          placeholder={'t.ex. Fredag: något lyxigt.\nOnsdag: under 30 minuter.'}
          value={wishes ?? settings.food.weekWishes ?? ''}
          onChange={(e) => setWishes(e.target.value)}
          onBlur={() => {
            if (wishes !== null) void saveSettings({ food: { ...settings.food, weekWishes: wishes.trim() } })
            setWishes(null)
          }}
        />
      </label>
      <div className="actions" style={{ marginTop: 8 }}>
        <label className="inline-field">
          <span>Dagar</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={busy} onClick={generate}>
          {busy ? 'Planerar… (kan ta en halv minut)' : upcoming.length ? 'Gör ny meny' : 'Gör veckomeny'}
        </button>
      </div>
      <details className="plan-options">
        <summary>Anpassa veckan</summary>
        <WeekdayPicker label="Kort om tid (snabba middagar)" days={settings.food.quickWeekdays} onChange={(quickWeekdays) => saveSettings({ food: { ...settings.food, quickWeekdays } })} />
        <WeekdayPicker label="Träningsdagar (proteinrikt)" days={settings.food.trainingWeekdays} onChange={(trainingWeekdays) => saveSettings({ food: { ...settings.food, trainingWeekdays } })} />
        <div className="two">
          <label className="field">
            <span>Allergier / kost</span>
            <input
              type="text"
              placeholder="t.ex. nötter"
              value={allergies ?? settings.food.allergies}
              onChange={(e) => setAllergies(e.target.value)}
              onBlur={() => {
                if (allergies !== null) void saveSettings({ food: { ...settings.food, allergies: allergies.trim() } })
                setAllergies(null)
              }}
            />
          </label>
          <label className="field">
            <span>Portioner</span>
            <select value={settings.food.portions} onChange={(e) => saveSettings({ food: { ...settings.food, portions: Number(e.target.value) } })}>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="footnote">AI:n väljer rätterna utifrån lagret, dina önskemål och de här dagarna. Kolla allergier.</p>
      </details>
      <AiProgress active={busy} expected={30} label="Planerar middagarna" />
      {error && (
        <>
          <p className="error" role="alert">{error}</p>
          <div className="actions" style={{ marginTop: 0 }}><Link to="/installningar/ai" className="btn">Testa anslutningen</Link></div>
        </>
      )}

      {missing.length > 0 && (
        <div className="actions">
          <DoneButton onClick={shop} doneText="På inköpslistan" resetKey={missing.map((m) => m.name).join('|')}>Lägg det som saknas på inköpslistan ({missing.length})</DoneButton>
        </div>
      )}
      {message && <p className="muted" role="status">{message}</p>}

      {upcoming.length > 0 && <h2>Alla middagar</h2>}
      {upcoming.length === 0 && !busy && <p className="empty">Ingen meny än. Tryck Gör veckomeny.</p>}
      {upcoming.map((d) => {
        const ingredients = withPantryStatus(d.ingredients, pantry)
        const lacking = ingredients.filter((i) => i.status === 'missing').length
        const open = openIng.has(d.id)
        const isToday = d.date === today
        return (
          <section key={d.id} id={`middag-${d.date}`} className={`dinner${isToday ? ' is-today' : ''}`} aria-label={`${dayLabel(d.date)}: ${d.title}`}>
            <div className="dinner-head">
              <div className="dinner-date" aria-hidden="true">
                <span>{isToday ? 'Idag' : WEEKDAYS_SHORT[weekdayOf(d.date) - 1]}</span>
                <strong className="num">{parseISODate(d.date).getDate()}</strong>
              </div>
              <div className="dinner-headline">
                <h3 className="dinner-title">{d.title}</h3>
                {d.reason && <p className="dinner-reason">{d.reason}</p>}
              </div>
              <button type="button" className="icon-btn dinner-remove" aria-label={`Ta bort ${d.title} ur menyn`} onClick={() => undoable(`${d.title} är borttagen ur menyn`, ['mealPlan'], () => db.mealPlan.delete(d.id))}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
              </button>
            </div>
            <div className="dinner-main">
              <div className="dinner-tags">
                {d.minutes !== null && <span className="tag num">{d.minutes} min</span>}
                {d.url && <span className="tag">{d.site}</span>}
                <span className={`tag ${lacking ? 'warn' : 'ok'}`}>{lacking ? `${lacking} saknas` : 'Allt hemma'}</span>
              </div>
              {!d.url && !finding.has(d.id) && (
                <p className="dinner-note">{notFound.has(d.id) ? 'Hittade inget recept som gick att läsa.' : 'Inget recept hämtat än.'} Ingredienserna är AI:ns uppskattning.</p>
              )}
              <AiProgress active={finding.has(d.id)} expected={20} label="Letar recept på nätet" />
              <div className="dinner-actions">
                {d.url ? (
                  <a className="btn primary" href={d.url} target="_blank" rel="noreferrer">Öppna receptet</a>
                ) : (
                  <button type="button" className="btn primary" disabled={finding.has(d.id)} onClick={async () => findRecipe(d, await authHeaders())}>Hitta recept</button>
                )}
                <button type="button" className="btn" aria-expanded={open} onClick={() => setOpenIng((s) => { const n = new Set(s); if (open) n.delete(d.id); else n.add(d.id); return n })}>
                  Ingredienser <span className="num">{d.ingredients.length}</span> <svg className={`caret${open ? ' up' : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </div>
              {open && (
                <div className="dinner-ingredients">
                  <div className="sub">{d.url ? 'Enligt receptet' : 'Ungefärliga, enligt AI:n'}</div>
                  <IngredientList items={ingredients} expiring={expiring} />
                  <a className="btn text" href={recipeSearchUrl(d.title)} target="_blank" rel="noreferrer">Fler recept på nätet</a>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </>
  )
}

/** Veckodagar som knappar, t.ex. för dagar med ont om tid. */
function WeekdayPicker({ label, days, onChange }: { label: string; days: number[]; onChange: (days: number[]) => void }) {
  return (
    <fieldset className="weekday-picker">
      <legend>{label}</legend>
      <div className="weekday-row">
        {WEEKDAYS_SHORT.map((d, i) => {
          const wd = i + 1
          const on = days.includes(wd)
          return (
            <button key={d} type="button" className="chip" aria-pressed={on} aria-label={`${d}${on ? ', vald' : ''}`} onClick={() => onChange(on ? days.filter((x) => x !== wd) : [...days, wd].sort())}>
              {d}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
