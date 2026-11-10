import { useState, type FormEvent } from 'react'
import { AiProgress } from '../components/AiProgress'
import { DoneButton } from '../components/DoneButton'
import { Link } from 'react-router-dom'
import { PantryForm } from '../components/PantryForm'
import { MODE_LABELS, findRecipes, ingredientStatuses, type FoundRecipe, type IngredientLine, type RecipeMode } from '../ai/recipeSearch'
import { addShoppingItems, clearBought, deleteShoppingItem, moveBoughtToPantry, runOut, saveSettings, saveShoppingItem } from '../db/repo'
import { toISODate } from '../domain/dates'
import { expiryLabel, expiryStatus, expiringWithin, sortPantry } from '../domain/food'
import type { PantryItem } from '../domain/types'
import { useFieldError, useNow, usePantry, useSettings, useShopping } from '../hooks'
import { authHeaders } from '../lib/auth'
import { undoable } from '../lib/undo'

function RunOutDialog({ item, onClose }: { item: PantryItem; onClose: () => void }) {
  const done = async (addToList: boolean) => {
    await undoable(addToList ? `${item.name} är slut och ligger på inköpslistan` : `${item.name} är borttagen`, ['pantry', 'shopping'], () => runOut(item.id, addToList))
    onClose()
  }
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="runout-title" onClick={(e) => e.stopPropagation()}>
        <h1 id="runout-title" style={{ fontSize: 20 }}>{item.name} är slut?</h1>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => done(true)}>Lägg på inköpslistan</button>
          <button type="button" className="btn" onClick={() => done(false)}>Bara ta bort</button>
          <button type="button" className="btn" onClick={onClose} autoFocus>Avbryt</button>
        </div>
      </div>
    </div>
  )
}

export function PantryTab() {
  const pantry = usePantry()
  const today = toISODate(useNow())
  const [editing, setEditing] = useState<PantryItem | 'new' | null>(null)
  const [runningOut, setRunningOut] = useState<PantryItem | null>(null)
  if (!pantry) return null

  const sorted = sortPantry(pantry)
  const soon = expiringWithin(pantry, today).length

  return (
    <>
      <p className="muted">
        {pantry.length === 0 ? 'Lagret är tomt.' : `${pantry.length} varor`}
        {soon > 0 ? ` · ${soon} går ut snart eller har gått ut` : ''}
      </p>
      <div className="actions" style={{ marginTop: 0, marginBottom: 12 }}>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}>Lägg till vara</button>
        <Link to="/skanna?typ=kvitto" className="btn">Skanna kvitto</Link>
        <Link to="/skanna?typ=kylskap" className="btn">Skanna kylskåp</Link>
      </div>
      {sorted.map((i) => {
        const status = expiryStatus(i.expires, today)
        return (
          <div key={i.id} className="card task">
            <button type="button" className="task-main" onClick={() => setEditing(i)}>
              <span className="title">{i.name}{i.amount ? ` · ${i.amount}` : ''}</span>
              {i.expires && <span className={`sub${status === 'expired' || status === 'today' || status === 'soon' ? ' overdue' : ''}`}>{expiryLabel(i.expires, today)}</span>}
            </button>
            <button type="button" className="btn" aria-label={`Slut: ${i.name}`} onClick={() => setRunningOut(i)}>Slut</button>
          </div>
        )
      })}
      {editing && <PantryForm key={editing === 'new' ? 'new' : editing.id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {runningOut && <RunOutDialog item={runningOut} onClose={() => setRunningOut(null)} />}
    </>
  )
}

export function ShoppingTab() {
  const shopping = useShopping()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const { error, fail, touch } = useFieldError()
  if (!shopping) return null

  const open = shopping.filter((i) => !i.done).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.name.localeCompare(b.name, 'sv'))
  const bought = shopping.filter((i) => i.done)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return fail('name', 'Skriv vad du ska köpa.')
    const res = await addShoppingItems([{ name, amount }])
    if (res.added === 0) return fail('name', `${name.trim()} står redan på listan.`)
    setName('')
    setAmount('')
    setMessage('')
  }

  async function toPantry() {
    const n = await moveBoughtToPantry()
    setMessage(`${n} ${n === 1 ? 'vara' : 'varor'} lades i lagret.`)
  }

  const row = (i: (typeof shopping)[number]) => (
    <div key={i.id} className={`card task${i.done ? ' done' : ''}`}>
      <input type="checkbox" aria-label={`Köpt: ${i.name}`} checked={i.done} onChange={(e) => saveShoppingItem({ ...i, done: e.target.checked })} />
      <div className="task-main" style={{ cursor: 'default' }}>
        <span className="title">{i.name}{i.amount ? ` · ${i.amount}` : ''}</span>
        {i.note && <span className="sub">{i.note}</span>}
      </div>
      <button type="button" className="btn" aria-label={`Ta bort ${i.name}`} onClick={() => undoable(`${i.name} är borttagen från listan`, ['shopping'], () => deleteShoppingItem(i.id))}>Ta bort</button>
    </div>
  )

  return (
    <>
      <form className="item" onSubmit={add}>
        <input type="text" aria-label="Vara att köpa" placeholder="Vara" value={name} onChange={(e) => { setName(e.target.value); touch('name') }} />
        <input type="text" aria-label="Mängd" placeholder="Mängd" style={{ maxWidth: 110 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="submit" className="btn primary">Lägg till</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}

      <p className="muted" style={{ marginTop: 12 }}>{open.length === 0 ? 'Inköpslistan är tom.' : `${open.length} att köpa`}</p>
      {open.map(row)}

      {bought.length > 0 && (
        <>
          <h2>Köpt ({bought.length})</h2>
          {bought.map(row)}
          <div className="actions">
            <button type="button" className="btn primary" onClick={toPantry}>Lägg köpta varor i lagret</button>
            <button type="button" className="btn" onClick={() => clearBought()}>Rensa köpta</button>
          </div>
        </>
      )}
      {message && <p className="muted" role="status">{message}</p>}
    </>
  )
}

const MODE_KEY = 'recipe-mode'

export function RecipesTab() {
  const pantry = usePantry()
  const settings = useSettings()
  const today = toISODate(useNow())
  const [mode, setMode] = useState<RecipeMode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY)
      return v === 'pantry' || v === 'some' || v === 'any' ? v : 'some'
    } catch {
      return 'some'
    }
  })
  const [wish, setWish] = useState('')
  const [recipes, setRecipes] = useState<FoundRecipe[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [allergies, setAllergies] = useState<string | null>(null)
  if (!pantry || !settings) return null
  const food = settings.food
  const usable = pantry.filter((p) => !p.expires || p.expires >= today)

  function chooseMode(m: RecipeMode) {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* valet sparas bara för stunden */
    }
  }

  async function search() {
    setBusy(true)
    setError('')
    setNotes({})
    try {
      const found = await findRecipes({ mode, pantry: usable, food, memories: settings!.memories, today, wish }, await authHeaders())
      // Det som kräver minst handling först (jämförelsen går på namn, så det är en ungefärlig sortering).
      const missingCount = (r: FoundRecipe) => ingredientStatuses(r.ingredients, usable).filter((l) => l.status === 'missing').length
      setRecipes(mode === 'any' ? found : [...found].sort((a, b) => missingCount(a) - missingCount(b)))
    } catch (e) {
      setRecipes(null)
      setError(e instanceof Error ? e.message : 'Något gick fel.')
    } finally {
      setBusy(false)
    }
  }

  async function addMissing(r: FoundRecipe, missing: IngredientLine[]) {
    const res = await addShoppingItems(missing.map((m) => ({ name: m.name, amount: m.amount, note: r.title })))
    setNotes((n) => ({ ...n, [r.url]: `${res.added} ${res.added === 1 ? 'vara' : 'varor'} lades på inköpslistan${res.skipped ? ` (${res.skipped} fanns redan)` : ''}.` }))
  }

  return (
    <>
      <label className="field">
        <span>Utgå från</span>
        <select value={mode} onChange={(e) => chooseMode(e.target.value as RecipeMode)}>
          {(Object.keys(MODE_LABELS) as RecipeMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
      </label>
      <div className="two">
        <label className="field">
          <span>Önskemål (valfritt)</span>
          <input type="text" placeholder="t.ex. kyckling" value={wish} onChange={(e) => setWish(e.target.value)} />
        </label>
        <label className="field">
          <span>Allergier / kost</span>
          <input
            type="text"
            placeholder="t.ex. nötter"
            value={allergies ?? food.allergies}
            onChange={(e) => setAllergies(e.target.value)}
            onBlur={() => {
              if (allergies !== null) void saveSettings({ food: { ...food, allergies: allergies.trim() } })
              setAllergies(null)
            }}
          />
        </label>
      </div>
      <p className="muted">
        {mode !== 'any' && usable.length === 0
          ? 'Lägg först in varor i lagret, eller välj Handla det som behövs.'
          : 'AI:n söker på nätet efter riktiga recept (ICA, Köket, Arla m.fl.). Ingredienserna nedan kommer från receptsidan. Kolla allergier själv.'}
      </p>
      <div className="actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn primary" disabled={busy || (mode !== 'any' && usable.length === 0)} onClick={search}>
          {busy ? 'Söker… (tar några sekunder)' : recipes ? 'Sök igen' : 'Hitta recept'}
        </button>
      </div>
      <AiProgress active={busy} expected={25} label="Letar efter recept på nätet" />
      {error && (
        <>
          <p className="error" role="alert">{error}</p>
          <div className="actions" style={{ marginTop: 0 }}><Link to="/installningar/ai" className="btn">Testa anslutningen</Link></div>
        </>
      )}

      {recipes?.map((r) => {
        const lines = ingredientStatuses(r.ingredients, pantry)
        const missing = lines.filter((l) => l.status === 'missing')
        const home = lines.filter((l) => l.status === 'pantry').length
        return (
          <div key={r.url} className="card recipe">
            <div className="title">{r.title}</div>
            <div className="sub">{[r.site, r.servings, r.minutes ? `${r.minutes} min` : null].filter(Boolean).join(' · ')}</div>
            {r.why && <div className="sub">{r.why}</div>}
            <div className="sub num">{home} av {lines.length} ingredienser hemma{missing.length ? `, ${missing.length} saknas` : ''}</div>
            <div className="actions" style={{ marginTop: 8 }}>
              <a className="btn primary" href={r.url} target="_blank" rel="noreferrer">Öppna receptet</a>
              {missing.length > 0 && (
                <DoneButton onClick={() => addMissing(r, missing)} doneText="På inköpslistan" resetKey={missing.map((m) => m.line).join('|')}>
                  Lägg saknade på inköpslistan ({missing.length})
                </DoneButton>
              )}
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center', color: 'var(--primary)' }}>Ingredienser enligt receptet ({lines.length})</summary>
              <ul className="ingredients">
                {lines.map((l) => (
                  <li key={l.line} className={l.status === 'missing' ? 'missing' : ''}>
                    <span>{l.line}</span>
                    <span className="sub">{l.status === 'pantry' ? 'har hemma' : l.status === 'staple' ? 'basvara' : 'saknas'}</span>
                  </li>
                ))}
              </ul>
              <p className="sub">Jämförelsen med lagret går på namn, så kolla mängderna själv.</p>
            </details>
            {notes[r.url] && <p className="muted" role="status">{notes[r.url]}</p>}
          </div>
        )
      })}
    </>
  )
}
