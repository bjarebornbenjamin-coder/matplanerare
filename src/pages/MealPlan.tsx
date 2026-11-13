import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AiProgress } from '../components/AiProgress'
import { DoneButton } from '../components/DoneButton'
import { Link } from 'react-router-dom'
import { boxSides, fetchLunches, fetchVariedMealPlan, missingForPlan, missingNeeds, planDays, planStart } from '../ai/mealPlan'
import { isRealLunch } from '../domain/lunch'
import { uncoveredNeeds } from '../domain/shoppingMerge'
import { withPantryStatus } from '../ai/recipes'
import { IngredientList } from '../components/IngredientList'
import { db } from '../db/db'
import { appendShoppingItems, dishId, getSettings, markEaten, rateDish, saveSettings } from '../db/repo'
import { ConsumeDialog } from '../components/ConsumeDialog'
import { CookingOverlay, type CookRow } from '../components/CookingOverlay'
import { consumption, type Consumption } from '../domain/consume'
import { tidyShopping } from '../lib/shoppingTidy'
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, addDays, dayLabel, parseISODate, toHHmm, toISODate, weekdayOf } from '../domain/dates'
import { expiringWithin } from '../domain/food'
import { httpsUrl, recipeSearchUrl } from '../domain/recipeLink'
import { recipeForDish, splitIngredient } from '../ai/recipeSearch'
import type { DishRating, PantryItem, PlannedDinner, PlannedSide } from '../domain/types'
import { useAiConfig, useMealPlan, useNow, usePantry, useRatings, useSettings, useSides } from '../hooks'
import { authHeaders } from '../lib/auth'
import { undoable } from '../lib/undo'

type RecipeTarget = { id: string; title: string; table: 'mealPlan' | 'sides' }
/** En rätt som användaren ätit: middag, frukost, lunch eller matlåda. */
type EatTarget = { table: 'mealPlan' | 'sides'; id: string; title: string; eaten?: boolean; ingredients: { name: string; amount: string }[] }

/** Rätter som redan fått ett automatiskt receptförsök i den här sessionen. */
const autoTried = new Set<string>()
/**
 * Luncher som inte var riktiga luncher och som redan fått ett försök att bytas ut (dag och
 * rätt). Sparas i webbläsaren, så att ett byte som användaren ångrat inte görs om nästa gång.
 */
const LUNCH_TRIED = 'matplanerare-lunch-tried'
const lunchTried = new Set<string>(
  (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LUNCH_TRIED) ?? '[]') as unknown
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })(),
)
function rememberLunchTried(keys: string[]): void {
  keys.forEach((k) => lunchTried.add(k))
  try {
    localStorage.setItem(LUNCH_TRIED, JSON.stringify([...lunchTried].slice(-60)))
  } catch {
    /* utan minne görs försöket om nästa gång, vilket bara kostar ett anrop */
  }
}

export function MealPlanTab() {
  const plan = useMealPlan()
  const sides = useSides()
  const ratings = useRatings()
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
  const [shopping, setShopping] = useState(false)
  const [eating, setEating] = useState<{ target: EatTarget; used: Consumption[] } | null>(null)
  /** "Köket": helskärmsvyn medan menyn görs. null när den inte visas (eller har dolts). */
  const [cook, setCook] = useState<{ stage: 'plan' | 'recipes' | 'done'; dates: string[]; leaving: boolean } | null>(null)
  const cookShown = useRef(false)
  /** Sant en kort stund efter att menyn är klar, så att korten serveras in i tur och ordning. */
  const [served, setServed] = useState(false)
  /** Förlopp när menyn görs: uppskattning medan AI:n planerar, sedan verkligt per hämtat recept. */
  const [progress, setProgress] = useState<{ label: string; value?: number }>({ label: 'Planerar rätterna' })
  const [openIng, setOpenIng] = useState<Set<string>>(new Set())
  const [wishes, setWishes] = useState<string | null>(null)
  const [allergies, setAllergies] = useState<string | null>(null)
  const findRef = useRef<((item: RecipeTarget, headers: Record<string, string>) => Promise<void>) | null>(null)

  // Rätter i menyn som saknar riktigt recept (t.ex. från en äldre version) får ett försök när sidan visas.
  useEffect(() => {
    if (!plan || !sides || !pantry || !settings || busy || !findRef.current) return
    const from = toISODate(new Date())
    const todo: RecipeTarget[] = [
      ...plan.filter((d) => d.date >= from && !d.url).map((d) => ({ id: d.id, title: d.title, table: 'mealPlan' as const })),
      ...sides.filter((x) => x.date >= from && !x.fromBatch && !x.url).map((x) => ({ id: x.id, title: x.title, table: 'sides' as const })),
    ].filter((t) => !autoTried.has(t.id))
    if (todo.length === 0) return
    todo.forEach((t) => autoTried.add(t.id))
    const find = findRef.current
    void authHeaders().then(async (headers) => {
      for (const t of todo) await find(t, headers)
    })
  }, [plan, sides, pantry, settings, busy])

  // Luncher i menyn som inte är riktiga luncher (en smoothie eller fruktsallad från en äldre
  // version) byts en gång mot riktiga luncher, och får sedan ett recept. Bytet går att ångra.
  useEffect(() => {
    if (!plan || !sides || !pantry || !settings || !config || busy || !findRef.current) return
    const from = toISODate(new Date())
    const bad = sides.filter((x) => x.slot === 'lunch' && x.date >= from && !x.fromBatch && !x.eaten && !isRealLunch(x.title) && !lunchTried.has(`${x.id}|${x.title}`))
    if (bad.length === 0) return
    rememberLunchTried(bad.map((x) => `${x.id}|${x.title}`))
    const find = findRef.current
    void (async () => {
      const headers = await authHeaders()
      const avoid = [...plan.filter((d) => d.date >= from).map((d) => d.title), ...sides.filter((x) => x.date >= from).map((x) => x.title)]
      const fixed = await fetchLunches(bad.map((x) => x.date), { allergies: settings.food.allergies, memories: settings.memories, avoid }, config.model, headers)
      if (fixed.length === 0) return
      const stamp = new Date().toISOString()
      // Receptet hämtas här nedanför, inte en gång till av den automatiska sökningen.
      fixed.forEach((f) => autoTried.add(`${f.date}:lunch`))
      await undoable(fixed.length === 1 ? `Lunchen byttes mot ${fixed[0].title}` : `${fixed.length} luncher byttes mot riktiga luncher`, ['sides'], async () => {
        for (const f of fixed) await db.sides.update(`${f.date}:lunch`, { title: f.title, minutes: f.minutes, ingredients: [], url: undefined, site: undefined, updatedAt: stamp })
      })
      for (const f of fixed) await find({ id: `${f.date}:lunch`, title: f.title, table: 'sides' }, headers)
    })()
  }, [plan, sides, pantry, settings, config, busy])

  if (!plan || !sides || !ratings || !pantry || !settings) return null

  const upcoming = plan.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const upcomingSides = sides.filter((x) => x.date >= today)
  // Bara rätter med riktigt recept räknas; matlådor har inga egna ingredienser.
  // Uppätna rätter behöver inte handlas till.
  const missing = missingForPlan([...upcoming.filter((d) => d.url && !d.eaten), ...upcomingSides.filter((x) => !x.fromBatch && x.url && !x.eaten)], pantry)
  const dates = [...new Set([...upcoming.map((d) => d.date), ...upcomingSides.map((x) => x.date)])].sort()
  const food = settings.food
  const saveFood = (patch: Partial<typeof food>) => saveSettings({ food: { ...food, ...patch } })
  const expiring = new Set(expiringWithin(pantry, today).map((p) => p.name))

  /**
   * Hämtar ett riktigt recept för middagen eller lunchen och byter AI:ns ingredienser mot
   * receptsidans. Finns inget för rätten tas en liknande rätt; finns inget alls visas rätten utan recept.
   */
  async function findRecipe(item: RecipeTarget, headers: Record<string, string>) {
    setFinding((s) => new Set(s).add(item.id))
    try {
      const s = await getSettings()
      // Luncher får bara recept som är riktiga luncher (id:t slutar på måltiden: "2026-11-15:lunch").
      const meal = item.table === 'sides' && item.id.endsWith(':lunch') ? 'lunch' : undefined
      const r = await recipeForDish(item.title, { pantry: pantry!, food: s.food, memories: s.memories, today }, headers, fetch, meal)
      if (!r) {
        setNotFound((n) => new Set(n).add(item.id))
        return
      }
      const patch = {
        url: r.url,
        site: r.site,
        title: r.title,
        ingredients: r.ingredients.map(splitIngredient).map((i) => ({ name: i.name, amount: i.amount })),
        ...(r.minutes ? { minutes: r.minutes } : {}),
        updatedAt: new Date().toISOString(),
      }
      if (item.table === 'mealPlan') await db.mealPlan.update(item.id, { ...patch, steps: [] })
      else await db.sides.update(item.id, patch)
      setNotFound((n) => { const x = new Set(n); x.delete(item.id); return x })
    } finally {
      setFinding((f) => { const x = new Set(f); x.delete(item.id); return x })
    }
  }

  findRef.current = findRecipe

  /**
   * "Jag åt detta": visar vad som dras från lagret och markerar rätten som uppäten. Använder
   * receptet inget ur lagret (t.ex. en matlåda) markeras rätten direkt. Ett tryck till ångrar markeringen.
   */
  async function ate(target: EatTarget) {
    if (target.eaten) return undoable(`${target.title} är inte längre markerad som uppäten`, [target.table], () => markEaten(target, [], false))
    const used = consumption(target.ingredients, pantry!)
    if (used.length === 0) return undoable(`${target.title} är markerad som uppäten`, [target.table], () => markEaten(target, []))
    setEating({ target, used })
  }

  async function generate() {
    setBusy(true)
    setError('')
    setMessage('')
    setProgress({ label: 'Planerar rätterna' })
    const from = planStart(today, toHHmm(now))
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i))
    // Köket öppnas direkt, så att det syns att något händer.
    cookShown.current = true
    setCook({ stage: 'plan', dates, leaving: false })
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      const stored = await getSettings()
      // Önskemål som skrivits men inte sparats än (rutan sparar när den lämnas).
      const s = { ...stored, food: { ...stored.food, weekWishes: (wishes ?? stored.food.weekWishes ?? '').trim() } }
      const recent = plan!.filter((d) => d.date < from && d.date >= addDays(from, -21)).map((d) => d.title)
      // En ny meny ersätter hela den kommande menyn, inte bara de valda dagarna: väljer man
      // 3 dagar ska det inte ligga kvar rätter från en äldre 7-dagarsmeny efteråt.
      const replacing = plan!.filter((d) => d.date >= from).map((d) => d.title)
      const usable = pantry!.filter((p) => !p.expires || p.expires >= today)
      const planned = planDays(dates, s.food)
      const { dinners, sides: aiSides } = await fetchVariedMealPlan(
        {
          days: planned.days, pantry: usable, food: s.food, memories: s.memories, recent, replacing, today,
          liked: ratings!.filter((r) => r.rating === 1).map((r) => r.title).slice(0, 30),
          disliked: ratings!.filter((r) => r.rating === -1).map((r) => r.title).slice(0, 50),
        },
        config?.model ?? 'gpt-4o-mini',
        await authHeaders(),
      )
      const newSides = [...aiSides, ...boxSides(planned.boxes, dinners, s.food.boxPortions)]
      const stamp = new Date().toISOString()
      await undoable(`Ny meny för ${dinners.length} ${dinners.length === 1 ? 'dag' : 'dagar'}`, ['mealPlan', 'sides'], async () => {
        await db.mealPlan.bulkDelete(await db.mealPlan.where('date').aboveOrEqual(from).primaryKeys())
        await db.sides.bulkDelete(await db.sides.where('date').aboveOrEqual(from).primaryKeys())
        await db.mealPlan.bulkPut(dinners.map((d) => ({ ...d, updatedAt: stamp })))
        await db.sides.bulkPut(newSides.map((x) => ({ ...x, updatedAt: stamp })))
      })
      setCook((c) => c && { ...c, stage: 'recipes' })
      if (dinners.length < dates.length) setMessage(`AI:n gav bara ${dinners.length} av ${dates.length} dagar. Gör om för att fylla resten.`)
      // Riktiga recept till alla måltider (utom matlådor), fyra åt gången så att servern inte överbelastas.
      const headers = await authHeaders()
      dinners.forEach((d) => autoTried.add(d.id))
      newSides.forEach((x) => autoTried.add(x.id))
      const queue = [
        ...dinners.map((d) => ({ id: d.id, title: d.title, table: 'mealPlan' as const })),
        ...newSides.filter((x) => !x.fromBatch).map((x) => ({ id: x.id, title: x.title, table: 'sides' as const })),
      ]
      const total = queue.length
      let done = 0
      setProgress({ label: `Hämtar recept 0 av ${total}`, value: 30 })
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let d = queue.shift(); d; d = queue.shift()) {
          await findRecipe(d, headers)
          done++
          setProgress({ label: `Hämtar recept ${done} av ${total}`, value: 30 + (70 * done) / total })
        }
      }))
      // Visa "klart" en stund, tona ut köket och servera korten.
      if (cookShown.current) {
        setCook((c) => c && { ...c, stage: 'done' })
        await wait(1500)
        setCook((c) => c && { ...c, leaving: true })
        await wait(360)
      }
      cookShown.current = false
      setCook(null)
      setServed(true)
      setTimeout(() => setServed(false), 2600)
      requestAnimationFrame(() => document.getElementById('veckans-mat')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (e) {
      cookShown.current = false
      setCook(null)
      setError(e instanceof Error ? e.message : 'Något gick fel.')
      requestAnimationFrame(() => document.getElementById('plan-progress')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Lägger det som saknas för hela veckan på inköpslistan och städar den sedan: samma vara slås
   * ihop och mängderna summeras. Inget som redan står på listan tas bort.
   */
  async function shop() {
    setShopping(true)
    try {
      const recipes = [...upcoming.filter((d) => d.url && !d.eaten), ...upcomingSides.filter((x) => !x.fromBatch && x.url && !x.eaten)]
      // Det som redan lagts till för en rätt (även det som är avbockat) räknas inte en gång till.
      const lines = uncoveredNeeds(missingNeeds(recipes, pantry!), await db.shopping.toArray(), settings!.food.aliases)
      if (lines.length) {
        await appendShoppingItems(lines)
        await tidyShopping()
      }
      setMessage(lines.length ? `${lines.length} ${lines.length === 1 ? 'vara' : 'varor'} lades på inköpslistan. Samma vara slås ihop och mängderna räknas samman.` : 'Allt fanns redan på inköpslistan.')
    } finally {
      setShopping(false)
    }
  }

  // Raderna i köket: tomma medan AI:n väljer, sedan rätterna direkt ur menyn så att de
  // uppdateras när recepten hämtas.
  const cookRows: CookRow[] = (cook?.dates ?? []).map((date) => {
    const chosen = cook!.stage !== 'plan'
    const d = chosen ? plan.find((x) => x.date === date) : undefined
    const extras = chosen
      ? sides.filter((x) => x.date === date).sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'breakfast' ? -1 : 1)).map((x) => `${SLOT_LABEL[x.slot]}: ${x.fromBatch ? 'matlåda' : x.title}`).join(' · ')
      : ''
    return {
      date,
      label: date === today ? 'Idag' : WEEKDAYS_SHORT[weekdayOf(date) - 1],
      day: parseISODate(date).getDate(),
      dinner: chosen ? (d?.title ?? 'Ingen rätt den här gången') : undefined,
      ready: Boolean(d?.url),
      ...(extras ? { extras } : {}),
    }
  })

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
          {busy ? 'Gör menyn…' : upcoming.length ? 'Gör ny meny' : 'Gör veckomeny'}
        </button>
      </div>
      <div id="plan-progress">
        <AiProgress active={busy} expected={20} cap={30} value={progress.value} label={progress.label} />
      </div>
      <details className="plan-options">
        <summary>Anpassa veckan</summary>
        <h3 className="plan-sub">Måltider utöver middag</h3>
        <WeekdayPicker label="Frukost" days={food.breakfastWeekdays} onChange={(breakfastWeekdays) => saveFood({ breakfastWeekdays })} />
        <WeekdayPicker label="Lunch" days={food.lunchWeekdays} onChange={(lunchWeekdays) => saveFood({ lunchWeekdays })} />
        <WeekdayPicker label="Storkok (matlådor till luncherna efter)" days={food.batchWeekdays} onChange={(batchWeekdays) => saveFood({ batchWeekdays })} />
        {food.batchWeekdays.length > 0 && (
          food.lunchWeekdays.length === 0 ? (
            <p className="footnote">Välj lunchdagar ovan, så blir luncherna efter ett storkok matlådor.</p>
          ) : (
            <label className="inline-field" style={{ marginBottom: 8 }}>
              <span>Portioner per matlåda</span>
              <select value={food.boxPortions} onChange={(e) => saveFood({ boxPortions: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )
        )}
        <h3 className="plan-sub">Middagar</h3>
        <WeekdayPicker label="Kort om tid (snabba middagar)" days={food.quickWeekdays} onChange={(quickWeekdays) => saveFood({ quickWeekdays })} />
        <WeekdayPicker label="Träningsdagar (proteinrikt)" days={food.trainingWeekdays} onChange={(trainingWeekdays) => saveFood({ trainingWeekdays })} />
        <h3 className="plan-sub">Hushållet</h3>
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
      <AiProgress active={shopping} expected={15} label="Räknar ihop veckans inköp" />
      {message && <p className="muted" role="status">{message}</p>}

      {cook && (
        <CookingOverlay
          stage={cook.stage}
          rows={cookRows}
          progress={progress}
          leaving={cook.leaving}
          onHide={() => {
            cookShown.current = false
            setCook(null)
            requestAnimationFrame(() => document.getElementById('plan-progress')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
          }}
        />
      )}
      {dates.length > 0 && <h2 id="veckans-mat">Veckans mat</h2>}
      {dates.length === 0 && !busy && <p className="empty">Ingen meny än. Tryck Gör veckomeny.</p>}
      {dates.map((date, cardIndex) => {
        const serve = { className: served ? ' served' : '', style: { '--i': cardIndex } as CSSProperties }
        const d = upcoming.find((x) => x.date === date)
        const daySides = upcomingSides.filter((x) => x.date === date).sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'breakfast' ? -1 : 1))
        const sideRows = daySides.length > 0 && (
          <div className="sides">
            {daySides.map((x) => (
              <SideRow key={x.id} side={x} dinners={upcoming.concat(plan.filter((p) => p.date < today))} pantry={pantry} expiring={expiring} finding={finding.has(x.id)} notFound={notFound.has(x.id)} onAte={() => ate({ table: 'sides', id: x.id, title: x.fromBatch ? `Matlåda: ${x.title}` : x.title, eaten: x.eaten, ingredients: x.ingredients })} onFind={async () => findRecipe({ id: x.id, title: x.title, table: 'sides' }, await authHeaders())} />
            ))}
          </div>
        )
        if (!d) {
          return (
            <section key={date} id={`middag-${date}`} className={`dinner${date === today ? ' is-today' : ''}${serve.className}`} style={serve.style} aria-label={dayLabel(date)}>
              <div className="dinner-head">
                <DateBadge date={date} today={today} />
                <div className="dinner-headline"><h3 className="dinner-title muted-title">Ingen middag planerad</h3></div>
              </div>
              {sideRows}
            </section>
          )
        }
        const boxes = sides.filter((x) => x.fromBatch === d.date).length
        const ingredients = withPantryStatus(d.ingredients, pantry)
        const lacking = ingredients.filter((i) => i.status === 'missing').length
        const open = openIng.has(d.id)
        return (
          <section key={d.id} id={`middag-${d.date}`} className={`dinner${d.date === today ? ' is-today' : ''}${serve.className}`} style={serve.style} aria-label={`${dayLabel(d.date)}: ${d.title}`}>
            <div className="dinner-head">
              <DateBadge date={d.date} today={today} />
              <div className="dinner-headline">
                <h3 className="dinner-title">{d.title}</h3>
                {d.reason && <p className="dinner-reason">{d.reason}</p>}
              </div>
              <button type="button" className="icon-btn dinner-remove" aria-label={`Ta bort ${d.title} ur menyn`} onClick={() => undoable(`${d.title} är borttagen ur menyn`, ['mealPlan', 'sides'], async () => {
                await db.mealPlan.delete(d.id)
                await db.sides.bulkDelete(sides.filter((x) => x.fromBatch === d.date).map((x) => x.id))
              })}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
              </button>
            </div>
            <div className="dinner-main">
              <div className="dinner-tags">
                {boxes > 0 && <span className="tag batch">Storkok, {boxes} {boxes === 1 ? 'matlåda' : 'matlådor'}</span>}
                {d.minutes !== null && <span className="tag num">{d.minutes} min</span>}
                {d.url && <span className="tag">{d.site}</span>}
                {d.url && !d.eaten && <span className={`tag ${lacking ? 'warn' : 'ok'}`}>{lacking ? `${lacking} saknas` : 'Allt hemma'}</span>}
                <RateButtons dish={d} ratings={ratings} />
              </div>
              {!d.url && !finding.has(d.id) && (
                <p className="dinner-note">{notFound.has(d.id) ? 'Hittade inget recept på nätet för den här rätten. Försök igen, eller ta bort den och gör om menyn.' : 'Receptet är inte hämtat än.'}</p>
              )}
              <AiProgress active={finding.has(d.id)} expected={20} label="Letar recept på nätet" />
              <div className="dinner-actions">
                {d.url ? (
                  <a className="btn primary" href={httpsUrl(d.url)} target="_blank" rel="noreferrer">Öppna receptet</a>
                ) : (
                  <button type="button" className="btn primary" disabled={finding.has(d.id)} onClick={async () => findRecipe({ id: d.id, title: d.title, table: 'mealPlan' }, await authHeaders())}>{notFound.has(d.id) ? 'Försök igen' : 'Hitta recept'}</button>
                )}
                {d.url && <button type="button" className="btn" aria-expanded={open} onClick={() => setOpenIng((s) => { const n = new Set(s); if (open) n.delete(d.id); else n.add(d.id); return n })}>
                  Ingredienser <span className="num">{d.ingredients.length}</span> <svg className={`caret${open ? ' up' : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>}
                <button type="button" className={`btn${d.eaten ? ' is-done' : ''}`} aria-pressed={Boolean(d.eaten)} onClick={() => ate({ table: 'mealPlan', id: d.id, title: d.title, eaten: d.eaten, ingredients: d.ingredients })}>{d.eaten ? '✓ Uppäten' : 'Jag åt detta'}</button>
              </div>
              {open && d.url && (
                <div className="dinner-ingredients">
                  <div className="sub">Enligt receptet på {d.site}</div>
                  <IngredientList items={ingredients} expiring={expiring} />
                  <a className="btn text" href={recipeSearchUrl(d.title)} target="_blank" rel="noreferrer">Fler recept på nätet</a>
                </div>
              )}
            </div>
            {sideRows}
          </section>
        )
      })}
      <PastDinners plan={plan} today={today} ratings={ratings} onAte={(d) => ate({ table: 'mealPlan', id: d.id, title: d.title, eaten: d.eaten, ingredients: d.ingredients })} />
      {eating && (
        <ConsumeDialog
          title={eating.target.title}
          used={eating.used}
          onClose={() => setEating(null)}
          onConfirm={async (changes) => {
            const t = eating.target
            setEating(null)
            await undoable(`${t.title} är uppäten och lagret är uppdaterat`, ['pantry', t.table], () => markEaten(t, changes))
          }}
        />
      )}
    </>
  )
}

const THUMB_UP = 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3'
const THUMB_DOWN = 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17'

/** Tumme upp/ner. Samma tumme igen tar bort betyget. Används när menyn planeras. */
function RateButtons({ dish, ratings }: { dish: { title: string; date?: string; url?: string; site?: string }; ratings: DishRating[] }) {
  const current = ratings.find((r) => r.id === dishId(dish.title))?.rating
  const btn = (rating: 1 | -1, path: string, label: string) => (
    <button type="button" className={`icon-btn rate${current === rating ? (rating === 1 ? ' up' : ' down') : ''}`} aria-pressed={current === rating} aria-label={`${label}: ${dish.title}`} onClick={() => rateDish(dish, rating)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill={current === rating ? 'currentColor' : 'none'} fillOpacity={0.2} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
    </button>
  )
  return (
    <span className="rate-buttons">
      {btn(1, THUMB_UP, 'Gillade')}
      {btn(-1, THUMB_DOWN, 'Gillade inte')}
    </span>
  )
}

/** De senaste sju dagarnas middagar, så att man kan säga vad man tyckte. */
function PastDinners({ plan, today, ratings, onAte }: { plan: PlannedDinner[]; today: string; ratings: DishRating[]; onAte: (d: PlannedDinner) => void }) {
  const past = plan.filter((d) => d.date < today && d.date >= addDays(today, -7)).sort((a, b) => b.date.localeCompare(a.date))
  if (past.length === 0) return null
  const unrated = past.filter((d) => !ratings.some((r) => r.id === dishId(d.title))).length
  return (
    <section aria-label="Hur var maten?">
      <h2>Hur var maten?</h2>
      <p className="footnote">{unrated ? 'Tumme upp så kommer rätten gärna tillbaka, tumme ner så föreslås den aldrig igen.' : 'Tack! Betygen används när nästa meny görs.'}</p>
      <div className="past-list">
        {past.map((d) => (
          <div key={d.id} className="past-row">
            <div className="past-body">
              <div className="sub">{dayLabel(d.date)}</div>
              <div className="past-title">{d.url ? <a href={httpsUrl(d.url)} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</div>
              <button type="button" className={`side-link${d.eaten ? ' is-done' : ''}`} aria-pressed={Boolean(d.eaten)} onClick={() => onAte(d)}>{d.eaten ? '✓ Uppäten' : 'Jag åt detta'}</button>
            </div>
            <RateButtons dish={d} ratings={ratings} />
          </div>
        ))}
      </div>
    </section>
  )
}

function DateBadge({ date, today }: { date: string; today: string }) {
  return (
    <div className="dinner-date" aria-hidden="true">
      <span>{date === today ? 'Idag' : WEEKDAYS_SHORT[weekdayOf(date) - 1]}</span>
      <strong className="num">{parseISODate(date).getDate()}</strong>
    </div>
  )
}

const SLOT_LABEL = { breakfast: 'Frukost', lunch: 'Lunch' } as const

/** Frukost eller lunch under dagens middag. En matlåda visar storkokets rätt. */
function SideRow({ side, dinners, pantry, expiring, finding, notFound, onFind, onAte }: { side: PlannedSide; dinners: PlannedDinner[]; pantry: PantryItem[]; expiring: Set<string>; finding: boolean; notFound: boolean; onFind: () => void; onAte: () => void }) {
  const [open, setOpen] = useState(false)
  const from = side.fromBatch ? dinners.find((d) => d.date === side.fromBatch) : undefined
  const title = side.fromBatch ? `Matlåda: ${from?.title ?? side.title}` : side.title
  const ingredients = withPantryStatus(side.ingredients, pantry)
  const lacking = ingredients.filter((i) => i.status === 'missing').length
  // Frukost och lunch ska ha ett riktigt recept, precis som middagen.
  const needsRecipe = !side.fromBatch && !side.url
  const meta = side.fromBatch
    ? `Från storkoket ${WEEKDAYS_LONG[weekdayOf(side.fromBatch) - 1]}`
    : needsRecipe
      ? finding ? 'Letar recept på nätet…' : notFound ? 'Hittade inget recept på nätet.' : 'Receptet är inte hämtat än.'
      : [side.minutes !== null ? `${side.minutes} min` : null, side.site ?? null, side.ingredients.length ? (lacking ? `${lacking} saknas` : 'allt hemma') : null].filter(Boolean).join(' · ')
  return (
    <div className="side">
      <span className={`side-label ${side.slot}`}>{SLOT_LABEL[side.slot]}</span>
      <div className="side-body">
        <div className="side-title">{title}</div>
        {meta && <div className={`side-meta${lacking && !side.fromBatch && !needsRecipe ? ' warn' : ''}`}>{meta}</div>}
        {side.url && <a className="side-link" href={httpsUrl(side.url)} target="_blank" rel="noreferrer">Öppna receptet</a>}
        {needsRecipe && !finding && <button type="button" className="side-link" onClick={onFind}>{notFound ? 'Försök igen' : 'Hitta recept'}</button>}
        <button type="button" className={`side-link${side.eaten ? ' is-done' : ''}`} aria-pressed={Boolean(side.eaten)} onClick={onAte}>{side.eaten ? '✓ Uppäten' : 'Jag åt detta'}</button>
        {open && (
          <div className="dinner-ingredients">
            <IngredientList items={ingredients} expiring={expiring} />
            {!side.url && <a className="btn text" href={recipeSearchUrl(side.title)} target="_blank" rel="noreferrer">Recept på nätet</a>}
          </div>
        )}
      </div>
      {!side.fromBatch && !needsRecipe && side.ingredients.length > 0 && (
        <button type="button" className="icon-btn" aria-expanded={open} aria-label={`Ingredienser till ${title}`} onClick={() => setOpen(!open)}>
          <svg className={`caret${open ? ' up' : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}
      <button type="button" className="icon-btn" aria-label={`Ta bort ${title}`} onClick={() => undoable(`${title} är borttagen ur menyn`, ['sides'], () => db.sides.delete(side.id))}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
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
