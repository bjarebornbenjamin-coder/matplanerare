import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AiProgress } from '../components/AiProgress'
import { PantryForm } from '../components/PantryForm'
import { addShoppingItems, clearBought, deleteShoppingItem, moveBoughtToPantry, runOut, saveShoppingItem } from '../db/repo'
import { toISODate } from '../domain/dates'
import { tidyAmount } from '../domain/shoppingName'
import { SECTIONS, sectionFor } from '../domain/storeSection'
import { tidyShopping, useShoppingTidy } from '../lib/shoppingTidy'
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
              <span className="title">{i.name}{tidyAmount(i.amount) ? ` · ${tidyAmount(i.amount)}` : ''}</span>
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
  const tidy = useShoppingTidy()
  const { error, fail, touch } = useFieldError()

  // AI:n går igenom listan när den öppnas, om det tillkommit varor sedan sist. En gång per
  // besök, så att Ångra inte genast görs om.
  const started = useRef(false)
  useEffect(() => {
    if (!shopping || started.current) return
    started.current = true
    void tidyShopping()
  }, [shopping])

  if (!shopping) return null

  const open = shopping.filter((i) => !i.done)
  // Samma ordning som i butiken: avdelning för avdelning, och i bokstavsordning inom varje.
  const groups = SECTIONS.map((section) => ({ section, items: open.filter((i) => sectionFor(i) === section).sort((a, b) => a.name.localeCompare(b.name, 'sv')) })).filter((g) => g.items.length > 0)
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
        <span className="title">{i.name}{tidyAmount(i.amount) ? ` · ${tidyAmount(i.amount)}` : ''}</span>
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

      {open.length > 0 && (
        <Link to="/handla" className="shop-start">
          <span className="shop-start-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9h14l-1.4 9.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8zM9 9l3-5 3 5" /></svg>
          </span>
          <span className="shop-start-text">
            <strong>Börja handla</strong>
            <span>Stora rader, sorterade efter butikens avdelningar</span>
          </span>
          <span className="chev" aria-hidden="true">›</span>
        </Link>
      )}
      <div className="list-head">
        <p className="muted">{open.length === 0 ? 'Inköpslistan är tom.' : `${open.length} att köpa`}</p>
        {open.length > 1 && <button type="button" className="btn" disabled={tidy.running} onClick={() => tidyShopping({ force: true })}>{tidy.running ? 'Städar…' : 'Städa med AI'}</button>}
      </div>
      <AiProgress active={tidy.running} expected={12} label="AI:n går igenom listan" />
      {tidy.message && !tidy.running && <p className="muted" role="status">{tidy.message}</p>}
      {groups.map((g) => (
        <section key={g.section} aria-label={g.section}>
          <h2 className="list-section">{g.section}</h2>
          {g.items.map(row)}
        </section>
      ))}

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
