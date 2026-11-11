import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PantryForm } from '../components/PantryForm'
import { Storage3D } from '../components/Storage3D'
import { addShoppingItems, clearBought, deleteShoppingItem, moveBoughtToPantry, runOut, saveShoppingItem } from '../db/repo'
import { toISODate } from '../domain/dates'
import { expiryLabel, expiryStatus, expiringWithin, sortPantry } from '../domain/food'
import type { PantryItem } from '../domain/types'
import { useFieldError, useNow, usePantry, useShopping } from '../hooks'
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

const VIEW_KEY = 'pantry-view'

export function PantryTab() {
  const pantry = usePantry()
  const today = toISODate(useNow())
  const [editing, setEditing] = useState<PantryItem | 'new' | null>(null)
  const [runningOut, setRunningOut] = useState<PantryItem | null>(null)
  const [view, setView] = useState<'skap' | 'lista'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'skap'
    } catch {
      return 'skap'
    }
  })
  const chooseView = (v: 'skap' | 'lista') => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* valet gäller bara för stunden */
    }
  }
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
      <div className="seg" role="group" aria-label="Visa lagret som">
        <button type="button" className="tab" aria-pressed={view === 'skap'} onClick={() => chooseView('skap')}>Skåpen</button>
        <button type="button" className="tab" aria-pressed={view === 'lista'} onClick={() => chooseView('lista')}>Lista</button>
      </div>
      {view === 'skap' && (
        <>
          <p className="storage-hint">Dra i en dörr för att öppna den, eller tryck på den. Tryck på en vara för att ändra den.</p>
          <Storage3D pantry={pantry} today={today} onPick={setEditing} />
        </>
      )}
      {view === 'lista' && sorted.map((i) => {
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
