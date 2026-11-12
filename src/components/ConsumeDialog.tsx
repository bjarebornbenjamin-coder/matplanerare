import { useState } from 'react'
import type { PantryChange } from '../db/repo'
import type { Consumption } from '../domain/consume'

interface Props {
  title: string
  used: Consumption[]
  onConfirm: (changes: PantryChange[]) => void
  onClose: () => void
}

/**
 * Visar vad som dras från lagret när en rätt är uppäten, innan något ändras. Det som går att
 * räkna är förvalt; varor där mängden inte går att jämföra får användaren själv markera som slut.
 */
export function ConsumeDialog({ title, used, onConfirm, onClose }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(used.map((u) => [u.item.id, u.kind !== 'unknown'])))
  const toggle = (id: string) => setChecked((c) => ({ ...c, [id]: !c[id] }))
  const counted = used.filter((u) => u.kind !== 'unknown')
  const unknown = used.filter((u) => u.kind === 'unknown')

  const confirm = () =>
    onConfirm(
      used
        .filter((u) => checked[u.item.id])
        .map((u) => (u.kind === 'reduce' ? { id: u.item.id, amount: u.left } : { id: u.item.id, remove: true })),
    )

  const row = (u: Consumption) => (
    <label key={u.item.id} className="consume-row">
      <input type="checkbox" checked={checked[u.item.id] ?? false} onChange={() => toggle(u.item.id)} />
      <span>
        <span className="title">{u.item.name}</span>
        <span className="sub num">
          {u.kind === 'reduce' && `${u.item.amount} → ${u.left} kvar (receptet använder ${u.need})`}
          {u.kind === 'remove' && `${u.item.amount} tar slut (receptet använder ${u.need}) och tas bort ur lagret`}
          {u.kind === 'unknown' && `${u.item.amount ? `Hemma: ${u.item.amount}. ` : ''}${u.need ? `Receptet använder ${u.need}. ` : ''}Bocka i om varan tog slut.`}
        </span>
      </span>
    </label>
  )

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="consume-title" onClick={(e) => e.stopPropagation()}>
        <h1 id="consume-title" style={{ fontSize: 20 }}>Jag åt {title}</h1>
        {counted.length > 0 && (
          <>
            <h2>Dras från lagret</h2>
            {counted.map(row)}
          </>
        )}
        {unknown.length > 0 && (
          <>
            <h2>Tog något av det här slut?</h2>
            <p className="footnote">Mängden går inte att räkna om, så de här varorna ligger kvar om du inte bockar i dem.</p>
            {unknown.map(row)}
          </>
        )}
        <div className="actions">
          <button type="button" className="btn primary" onClick={confirm} autoFocus>Uppdatera lagret</button>
          <button type="button" className="btn" onClick={onClose}>Avbryt</button>
        </div>
      </div>
    </div>
  )
}
