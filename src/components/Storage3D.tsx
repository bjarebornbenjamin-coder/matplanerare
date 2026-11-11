import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { expiryLabel, expiryStatus, sortPantry } from '../domain/food'
import { emojiFor, placeOf } from '../domain/storage'
import type { PantryItem, StoragePlace } from '../domain/types'

const MAX_ANGLE = 110
/** Dörren räknas som öppen om den släpps mer än så här mycket öppen. */
const SNAP = 35

/**
 * En dörr som följer pekaren: dörrens fria kant hamnar där pekaren är (kant = bredd · cos(vinkel)).
 * Ett tryck utan dragning öppnar eller stänger. Skafferiets två dörrar delar samma vinkel;
 * `bind` ger händelser för en dörr med gångjärnet till vänster eller höger.
 */
function useDoor() {
  const [angle, setAngle] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x0: number; moved: boolean; rect: DOMRect } | null>(null)

  const angleAt = (clientX: number, rect: DOMRect, hinge: 'left' | 'right') => {
    const fromHinge = hinge === 'left' ? clientX - rect.left : rect.right - clientX
    const ratio = Math.max(-1, Math.min(1, fromHinge / rect.width))
    return Math.max(0, Math.min(MAX_ANGLE, (Math.acos(ratio) * 180) / Math.PI))
  }
  const release = (moved: boolean) => {
    setDragging(false)
    setAngle((a) => (moved ? (a > SNAP ? MAX_ANGLE : 0) : a > SNAP ? 0 : MAX_ANGLE))
  }

  const bind = (hinge: 'left' | 'right', width: 'full' | 'half') => ({
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      // Mätningen görs mot dörrens plats i skåpet, inte den roterade dörren.
      const box = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect()
      const w = width === 'half' ? box.width / 2 : box.width
      const rect = new DOMRect(hinge === 'left' ? box.left : box.right - w, box.top, w, box.height)
      drag.current = { x0: e.clientX, moved: false, rect }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.abs(e.clientX - d.x0) < 6) return
      d.moved = true
      setDragging(true)
      setAngle(angleAt(e.clientX, d.rect, hinge))
    },
    onPointerUp() {
      const d = drag.current
      drag.current = null
      if (d) release(d.moved)
    },
    onPointerCancel() {
      drag.current = null
      release(true)
    },
  })
  return { angle, open: angle > SNAP, dragging, setAngle, bind }
}

function ItemButton({ item, today, index, hidden, onPick }: { item: PantryItem; today: string; index: number; hidden: boolean; onPick: (i: PantryItem) => void }) {
  const status = expiryStatus(item.expires, today)
  const warn = status === 'expired' || status === 'today' ? 'bad' : status === 'soon' ? 'soon' : ''
  return (
    <button
      type="button"
      className={`shelf-item${warn ? ` ${warn}` : ''}`}
      style={{ '--i': index } as CSSProperties}
      tabIndex={hidden ? -1 : 0}
      title={[item.name, item.amount, item.expires && expiryLabel(item.expires, today)].filter(Boolean).join(' · ')}
      aria-label={[item.name, item.amount, item.expires && expiryLabel(item.expires, today)].filter(Boolean).join(', ')}
      onClick={() => onPick(item)}
    >
      <span className="shelf-emoji" aria-hidden="true">{emojiFor(item.name, placeOf(item))}</span>
      <span className="shelf-name">{item.name}</span>
      {warn && <span className="shelf-dot" aria-hidden="true" />}
    </button>
  )
}

interface CompartmentProps {
  kind: StoragePlace
  label: string
  items: PantryItem[]
  today: string
  onPick: (i: PantryItem) => void
  /** Skafferiet har två dörrar som öppnas tillsammans. */
  double?: boolean
  className?: string
}

/** Ett fack med dörr(ar) och hyllor. Dra i dörren eller tryck för att öppna. */
function Compartment({ kind, label, items, today, onPick, double, className = '' }: CompartmentProps) {
  const { angle, open, dragging, setAngle, bind } = useDoor()
  const door = (side: 'left' | 'right') => (
    <div
      className={`door door-${side}${double ? ' half' : ''}${dragging ? ' dragging' : ''}`}
      style={{ transform: `rotateY(${side === 'left' ? -angle : angle}deg)` }}
      {...bind(side, double ? 'half' : 'full')}
    >
      <div className="door-front">
        <span className={`door-handle handle-${side === 'left' ? 'right' : 'left'}`} />
        {side === 'left' && <span className="door-label">{label}</span>}
      </div>
      <div className="door-back" />
    </div>
  )

  return (
    <div className={`compartment ${kind}${open ? ' is-open' : ''} ${className}`}>
      <div className="inside" aria-hidden={!open}>
        <div className="inside-light" />
        {items.length === 0 ? (
          <p className="inside-empty">Tomt</p>
        ) : (
          <div className="shelves">
            {items.map((i, n) => <ItemButton key={i.id} item={i} today={today} index={n} hidden={!open} onPick={onPick} />)}
          </div>
        )}
      </div>
      {door('left')}
      {double && door('right')}
      <button type="button" className="door-toggle" aria-expanded={open} aria-label={`${open ? 'Stäng' : 'Öppna'} ${label.toLowerCase()} (${items.length} ${items.length === 1 ? 'vara' : 'varor'})`} onClick={() => setAngle(open ? 0 : MAX_ANGLE)} />
    </div>
  )
}

/** Kylskåp (med frysfack) och skafferi med varorna på hyllorna. */
export function Storage3D({ pantry, today, onPick }: { pantry: PantryItem[]; today: string; onPick: (i: PantryItem) => void }) {
  const sorted = sortPantry(pantry)
  const by = (p: StoragePlace) => sorted.filter((i) => placeOf(i) === p)
  const fridge = by('fridge')
  const freezer = by('freezer')
  const pantryItems = by('pantry')
  return (
    <div className="storage-scene">
      <figure className="unit unit-fridge">
        <div className="appliance fridge-body">
          <Compartment kind="freezer" label="Frys" items={freezer} today={today} onPick={onPick} className="part-freezer" />
          <Compartment kind="fridge" label="Kylskåp" items={fridge} today={today} onPick={onPick} className="part-fridge" />
        </div>
        <figcaption>Kylskåp {fridge.length} · Frys {freezer.length}</figcaption>
      </figure>
      <figure className="unit unit-pantry">
        <div className="appliance pantry-body">
          <Compartment kind="pantry" label="Skafferi" items={pantryItems} today={today} onPick={onPick} double className="part-pantry" />
        </div>
        <figcaption>Skafferi {pantryItems.length}</figcaption>
      </figure>
    </div>
  )
}
