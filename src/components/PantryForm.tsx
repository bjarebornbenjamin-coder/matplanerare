import { useState, type FormEvent } from 'react'
import { deletePantryItem, newId, runOut, savePantryItem } from '../db/repo'
import { PLACE_LABELS, guessPlace } from '../domain/storage'
import { toISODate } from '../domain/dates'
import type { PantryItem, StoragePlace } from '../domain/types'
import { undoable } from '../lib/undo'
import { useFieldError } from '../hooks'

interface Props {
  item: PantryItem | null
  onClose: () => void
}

export function PantryForm({ item, onClose }: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item?.amount ?? '')
  const [expires, setExpires] = useState(item?.expires ?? '')
  /** Vald plats; null = följ gissningen från namnet. */
  const [place, setPlace] = useState<StoragePlace | null>(item?.place ?? null)
  const shownPlace = place ?? guessPlace(name)
  const { error, fail, touch } = useFieldError()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return fail('name', 'Skriv vad det är.')
    await savePantryItem({
      id: item?.id ?? newId(),
      name: name.trim(),
      ...(amount.trim() ? { amount: amount.trim() } : {}),
      ...(expires ? { expires } : {}),
      addedAt: item?.addedAt ?? toISODate(new Date()),
      source: item?.source ?? 'manual',
      ...(place ? { place } : {}),
      updatedAt: '',
    })
    onClose()
  }

  async function usedUp() {
    if (!item) return
    await undoable(`${item.name} är slut och ligger på inköpslistan`, ['pantry', 'shopping'], () => runOut(item.id, true))
    onClose()
  }

  async function remove() {
    if (!item) return
    await undoable('Varan är borttagen', ['pantry'], () => deletePantryItem(item.id))
    onClose()
  }

  return (
    <div className="scrim" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-label={item ? 'Ändra vara' : 'Ny vara'}>
        <h1>{item ? 'Ändra vara' : 'Ny vara i lagret'}</h1>
        <label className="field">
          <span>Vara</span>
          <input type="text" value={name} onChange={(e) => { setName(e.target.value); touch('name') }} autoFocus onFocus={(e) => e.currentTarget.select()} />
        </label>
        <label className="field">
          <span>Mängd (valfritt)</span>
          <input type="text" placeholder="t.ex. 2 st, 500 g" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Förvaras i</span>
          <select value={shownPlace} onChange={(e) => setPlace(e.target.value as StoragePlace)}>
            {(Object.keys(PLACE_LABELS) as StoragePlace[]).map((p) => <option key={p} value={p}>{PLACE_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Bäst före (valfritt)</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn primary">Spara</button>
          <button type="button" className="btn" onClick={onClose}>Avbryt</button>
          <span className="spacer" />
          {item && <button type="button" className="btn" onClick={usedUp}>Slut, handla mer</button>}
          {item && <button type="button" className="btn danger" onClick={remove}>Ta bort</button>}
        </div>
      </form>
    </div>
  )
}
