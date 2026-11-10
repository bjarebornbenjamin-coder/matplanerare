import { useState } from 'react'
import { AiProgress } from '../components/AiProgress'
import { DoneButton } from '../components/DoneButton'
import { Link } from 'react-router-dom'
import { dayContext, fetchMealPlan, missingForPlan, planStart } from '../ai/mealPlan'
import { withPantryStatus } from '../ai/recipes'
import { IngredientList } from '../components/IngredientList'
import { MealForm } from '../components/MealForm'
import { db } from '../db/db'
import { addShoppingItems, getSettings, saveSettings } from '../db/repo'
import { WEEKDAYS_SHORT, addDays, dayLabel, toHHmm, toISODate } from '../domain/dates'
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
  const [eating, setEating] = useState<PlannedDinner | null>(null)
  const [finding, setFinding] = useState<Set<string>>(new Set())
  const [notFound, setNotFound] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  if (!plan || !pantry || !settings) return null

  const upcoming = plan.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const missing = missingForPlan(upcoming, pantry)
  const expiring = new Set(expiringWithin(pantry, today).map((p) => p.name))

  /** Hämtar ett riktigt recept för middagen och byter AI:ns ingredienser mot receptsidans. */
  async function findRecipe(d: PlannedDinner, headers: Record<string, string>) {
    setFinding((s) => new Set(s).add(d.id))
    try {
      const s = await getSettings()
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
        { days: dates.map((d) => dayContext(d, s.food)), pantry: usable, food: s.food, goals: s.nutrition, memories: s.memories, recent, today },
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
        <p className="footnote">AI:n väljer rätterna utifrån lagret, dina mål och de här dagarna. Kolla allergier.</p>
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
        return (
          <section key={d.id} id={`middag-${d.date}`} className="card recipe" aria-label={`${dayLabel(d.date)}: ${d.title}`}>
            <div className="sub">{d.date === today ? 'Idag' : d.date === addDays(today, 1) ? 'Imorgon' : dayLabel(d.date)}</div>
            <div className="title">{d.title}</div>
            {d.reason && <div className="sub">{d.reason}</div>}
            <div className="sub num">
              {[d.minutes !== null ? `${d.minutes} min` : null, d.nutrition ? `${d.nutrition.kcal} kcal, protein ${d.nutrition.protein} g per portion` : null, lacking ? `${lacking} saknas` : 'allt finns hemma'].filter(Boolean).join(' · ')}
            </div>
            {d.url ? (
              <div className="sub">Recept från {d.site}</div>
            ) : finding.has(d.id) ? null : (
              <p className="sub">{notFound.has(d.id) ? 'Hittade inget recept som gick att läsa.' : 'Inget recept hämtat än.'} Ingredienserna är AI:ns uppskattning.</p>
            )}
            <AiProgress active={finding.has(d.id)} expected={20} label="Letar recept på nätet" />
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center', color: 'var(--primary)' }}>
                {d.url ? 'Ingredienser enligt receptet' : 'Ungefärliga ingredienser'} ({d.ingredients.length})
              </summary>
              <IngredientList items={ingredients} expiring={expiring} />
            </details>
            <div className="actions" style={{ marginTop: 8 }}>
              {d.url ? (
                <a className="btn primary" href={d.url} target="_blank" rel="noreferrer">Öppna receptet</a>
              ) : (
                <button type="button" className="btn primary" disabled={finding.has(d.id)} onClick={async () => findRecipe(d, await authHeaders())}>Hitta recept</button>
              )}
              <button type="button" className="btn" onClick={() => setEating(d)}>Jag åt detta</button>
              <a className="btn text" href={recipeSearchUrl(d.title)} target="_blank" rel="noreferrer">Fler recept</a>
              <button type="button" className="btn text" onClick={() => undoable(`${d.title} är borttagen ur menyn`, ['mealPlan'], () => db.mealPlan.delete(d.id))}>Ta bort</button>
            </div>
          </section>
        )
      })}
      {eating && (
        <MealForm key={eating.id} meal={null} date={today} draft={{ name: eating.title, source: 'recipe', ...(eating.nutrition ?? {}) }} onClose={() => setEating(null)} />
      )}
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
