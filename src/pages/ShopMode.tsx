import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { moveBoughtToPantry, saveShoppingItem } from '../db/repo'
import { tidyAmount } from '../domain/shoppingName'
import { AiProgress } from '../components/AiProgress'
import { SECTIONS, sectionFor } from '../domain/storeSection'
import { useShoppingTidy } from '../lib/shoppingTidy'
import type { ShoppingItem } from '../domain/types'
import { useShopping } from '../hooks'

/** Så långt måste raden svepas för att varan ska räknas som lagd i korgen. */
const SWIPE = 84
/** Så länge visas en nyss avbockad rad (bock, överstrykning, hopfällning) innan den flyttas till korgen. */
const LEAVE_MS = 900

const R = 19
const C = 2 * Math.PI * R

/** En vara: tryck eller svep åt höger för att lägga den i korgen. */
function ShopRow({ item, leaving, onCheck }: { item: ShoppingItem; leaving: boolean; onCheck: () => void }) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x0: number; y0: number; active: boolean } | null>(null)
  const swiped = useRef(false)
  const amount = tidyAmount(item.amount)

  const handlers = {
    onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
      drag.current = { x0: e.clientX, y0: e.clientY, active: false }
      swiped.current = false
    },
    onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
      const d = drag.current
      if (!d || leaving) return
      const mx = e.clientX - d.x0
      const my = e.clientY - d.y0
      // Bara ett tydligt sidledsdrag räknas, så att listan går att rulla som vanligt.
      if (!d.active) {
        if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.5) return
        d.active = true
        swiped.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      setDx(Math.max(0, Math.min(160, mx)))
    },
    onPointerUp() {
      const d = drag.current
      drag.current = null
      if (d?.active && dx >= SWIPE) onCheck()
      setDx(0)
    },
    onPointerCancel() {
      drag.current = null
      setDx(0)
    },
  }

  return (
    <li className={`shop-row${leaving ? ' is-leaving' : ''}${dx > 0 ? ' is-dragging' : ''}${dx >= SWIPE ? ' will-check' : ''}`}>
      <span className="shop-under" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 7.5" /></svg>
      </span>
      <button
        type="button"
        className="shop-item"
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        aria-label={`${item.name}${amount ? `, ${amount}` : ''}: lägg i korgen`}
        disabled={leaving}
        {...handlers}
        onClick={() => {
          if (!swiped.current) onCheck()
          swiped.current = false
        }}
      >
        <span className="shop-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 12.5 10.5 17 18 8" /></svg>
        </span>
        <span className="shop-text">
          <span className="shop-name"><span>{item.name}</span></span>
          {(amount || item.note) && <span className="shop-sub">{[amount, item.note].filter(Boolean).join(' · ')}</span>}
        </span>
      </button>
    </li>
  )
}

/**
 * Handla-läget: inköpslistan för butiken. Stora rader sorterade efter avdelning, tryck eller svep
 * för att lägga i korgen, och skärmen hålls tänd. Ändringarna sparas i samma lista som på Inköp.
 */
export function ShopModePage() {
  const shopping = useShopping()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState<Set<string>>(new Set())
  const [basketOpen, setBasketOpen] = useState(false)
  const [stored, setStored] = useState<number | null>(null)
  // Medan AI:n går igenom listan visas inga rader, så att inget bockas av på en lista som strax byts ut.
  const tidy = useShoppingTidy()

  // Håll skärmen tänd i butiken (där webbläsaren stöder det), och släpp låset när läget stängs.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let closed = false
    const request = async () => {
      try {
        const l = (await navigator.wakeLock?.request('screen')) ?? null
        if (closed) void l?.release()
        else lock = l
      } catch {
        /* inte tillåtet eller stöds inte: läget fungerar ändå */
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisible)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      closed = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
      document.body.style.overflow = prev
    }
  }, [])

  if (!shopping) return null
  const close = () => navigate('/inkop', { replace: true })

  // En nyss avbockad vara står kvar på sin plats medan animationen spelas.
  const open = shopping.filter((i) => !i.done || leaving.has(i.id))
  const basket = shopping.filter((i) => i.done && !leaving.has(i.id))
  const total = shopping.length
  const left = shopping.filter((i) => !i.done).length
  const got = total - left
  const groups = SECTIONS.map((section) => ({
    section,
    items: open.filter((i) => sectionFor(i) === section).sort((a, b) => a.name.localeCompare(b.name, 'sv')),
  })).filter((g) => g.items.length > 0)

  function check(item: ShoppingItem) {
    setLeaving((s) => new Set(s).add(item.id))
    void saveShoppingItem({ ...item, done: true })
    setTimeout(() => setLeaving((s) => { const n = new Set(s); n.delete(item.id); return n }), LEAVE_MS)
  }

  async function toPantry() {
    setStored(await moveBoughtToPantry())
  }

  // Klart när allt är avbockat, och även efter att varorna flyttats till lagret (då är listan tom).
  const allDone = stored !== null || (total > 0 && left === 0 && leaving.size === 0)

  return (
    <div className="shop-mode" role="dialog" aria-modal="true" aria-label="Handla">
      <header className="shop-head">
        <button type="button" className="icon-btn" aria-label="Stäng handla-läget" onClick={close}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className="shop-head-text">
          <h1>Handla</h1>
          <p aria-live="polite">{stored !== null ? 'Varorna ligger i lagret' : total === 0 ? 'Inköpslistan är tom' : left === 0 ? 'Allt ligger i korgen' : `${got} av ${total} i korgen`}</p>
        </div>
        <div className="shop-ring" role="img" aria-label={`${left} kvar att handla`}>
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r={R} className="shop-ring-track" />
            <circle cx="24" cy="24" r={R} className="shop-ring-fill" strokeDasharray={C} strokeDashoffset={total ? C * (1 - got / total) : C} />
          </svg>
          <span key={left} className="shop-ring-num num">{left}</span>
        </div>
      </header>

      {total === 0 && stored === null && (
        <div className="shop-empty">
          <p>Det finns inget att handla. Lägg till varor på Inköp, eller låt menyn fylla på listan.</p>
          <button type="button" className="btn primary" onClick={close}>Tillbaka till listan</button>
        </div>
      )}

      {allDone && (
        <div className="shop-finish">
          <div className="shop-finish-mark" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ '--a': `${i * 30}deg` } as CSSProperties} />)}
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="46" />
              <path d="M40 62 54 76 82 46" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2>Allt är handlat!</h2>
          {stored === null ? (
            <>
              <p>{got} {got === 1 ? 'vara ligger' : 'varor ligger'} i korgen. Vill du lägga dem i lagret direkt?</p>
              <div className="actions">
                <button type="button" className="btn primary" onClick={toPantry}>Lägg i lagret</button>
                <button type="button" className="btn" onClick={close}>Inte nu</button>
              </div>
            </>
          ) : (
            <>
              <p>{stored} {stored === 1 ? 'vara ligger' : 'varor ligger'} nu i lagret.</p>
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => navigate('/lager', { replace: true })}>Visa lagret</button>
                <button type="button" className="btn" onClick={close}>Klar</button>
              </div>
            </>
          )}
        </div>
      )}

      {tidy.running && (
        <div className="shop-tidying">
          <p>AI:n går igenom listan: slår ihop samma varor och sorterar efter avdelning.</p>
          <AiProgress active expected={12} label="Snyggar till listan" />
        </div>
      )}

      {!allDone && !tidy.running && groups.map((g, gi) => (
        <section key={g.section} className="shop-section" style={{ '--i': gi } as CSSProperties} aria-label={g.section}>
          <h2>
            <span>{g.section}</span>
            <span className="num">{g.items.filter((i) => !i.done).length}</span>
          </h2>
          <ul>
            {g.items.map((i) => <ShopRow key={i.id} item={i} leaving={leaving.has(i.id)} onCheck={() => check(i)} />)}
          </ul>
        </section>
      ))}

      {!allDone && !tidy.running && basket.length > 0 && (
        <section className={`shop-basket${basketOpen ? ' is-open' : ''}`} aria-label="I korgen">
          <button type="button" className="shop-basket-head" aria-expanded={basketOpen} onClick={() => setBasketOpen(!basketOpen)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 9h14l-1.4 9.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8zM9 9l3-5 3 5" /></svg>
            <span>I korgen</span>
            <span key={basket.length} className="shop-basket-count num">{basket.length}</span>
            <svg className={`caret${basketOpen ? ' up' : ''}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {basketOpen && (
            <ul>
              {basket.map((i) => (
                <li key={i.id}>
                  <button type="button" className="shop-basket-item" aria-label={`${i.name}: ta upp ur korgen`} onClick={() => saveShoppingItem({ ...i, done: false })}>
                    <span>{i.name}</span>
                    <span className="sub">Ångra</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
