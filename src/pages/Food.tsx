import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AiProgress } from '../components/AiProgress'
import { planShopping } from '../ai/shoppingPlan'
import { authHeaders } from '../lib/auth'
import { PantryForm } from '../components/PantryForm'
import { addShoppingItems, clearBought, deleteShoppingItem, moveBoughtToPantry, replaceOpenShopping, runOut, saveShoppingItem } from '../db/repo'
import { toISODate } from '../domain/dates'
import { tidyAmount } from '../domain/shoppingName'
import { expiryLabel, expiryStatus, expiringWithin, sortPantry } from '../domain/food'
import type { PantryItem } from '../domain/types'
import { useAiConfig, useFieldError, useNow, usePantry, useShopping } from '../hooks'
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
  const [tidying, setTidying] = useState(false)
  const pantry = usePantry()
  const config = useAiConfig()
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

  /** Slår ihop dubbletter, rensar namnen och räknar om mängderna med AI. */
  async function tidy() {
    setTidying(true)
    setMessage('')
    try {
      const current = shopping!.filter((i) => !i.done)
      const lines = await planShopping({ needs: [], pantry: pantry ?? [], current }, config?.model ?? 'gpt-4o-mini', await authHeaders())
      await undoable('Inköpslistan är städad', ['shopping'], () => replaceOpenShopping(lines))
      const merged = current.length - lines.length
      setMessage(merged > 0 ? `${merged} ${merged === 1 ? 'dubblett' : 'dubbletter'} slogs ihop.` : 'Listan är städad.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kunde inte städa listan.')
    } finally {
      setTidying(false)
    }
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

      <div className="list-head">
        <p className="muted">{open.length === 0 ? 'Inköpslistan är tom.' : `${open.length} att köpa`}</p>
        {open.length > 1 && <button type="button" className="btn text" disabled={tidying} onClick={tidy}>{tidying ? 'Städar…' : 'Städa listan'}</button>}
      </div>
      <AiProgress active={tidying} expected={12} label="Slår ihop och rensar listan" />
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
