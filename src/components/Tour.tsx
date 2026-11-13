import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { endTour } from '../lib/tour'

interface Step {
  /** Sidan steget visas på. */
  route: string
  /**
   * Det som ska lysas upp: alternativ i tur och ordning, där det första som finns på sidan
   * används. Ett alternativ kan vara flera delar som lyses upp tillsammans. Utan träff visas
   * texten mitt på skärmen.
   */
  targets?: string[][]
  title: string
  text: string
}

export const TOUR_STEPS: Step[] = [
  {
    route: '/',
    title: 'Välkommen till Matplaneraren',
    text: 'En kort rundtur visar det viktigaste: hur du gör en meny, håller koll på det du har hemma och handlar. Den tar under en minut.',
  },
  {
    route: '/',
    targets: [['[data-tour="wishes"]', '[data-tour="generate"]']],
    title: 'Gör veckans meny',
    text: 'Skriv önskemål om du vill, till exempel ”fredag något lyxigt”. Välj antal dagar och tryck på knappen. AI:n väljer rätter efter det du har hemma och hämtar riktiga recept.',
  },
  {
    route: '/',
    targets: [['.plan-options > summary']],
    title: 'Anpassa veckan',
    text: 'Välj vilka dagar du vill ha frukost och lunch, när du storkokar till matlådor och när det ska gå fort. Här ändrar du också portioner, kost och allergier.',
  },
  {
    route: '/',
    targets: [['.dinner']],
    title: 'Dina rätter',
    text: 'När menyn är klar visas rätterna under Veckans mat. Öppna receptet, tryck ”Jag åt detta” så dras varorna från lagret, och ge tummen upp eller ner så lär sig appen din smak.',
  },
  {
    route: '/',
    targets: [['.nav']],
    title: 'Tre flikar',
    text: 'Längst ner växlar du mellan Meny, Lager och Inköp.',
  },
  {
    route: '/lager',
    targets: [['[data-tour="pantry-actions"]']],
    title: 'Lagret',
    text: 'Här står det du har hemma. Lägg till varor för hand, eller fotografera kvittot eller kylskåpet så fyller appen i åt dig. Det som snart går ut används först.',
  },
  {
    route: '/inkop',
    targets: [['.shop-start'], ['form.item']],
    title: 'Inköpslistan',
    text: 'Det som saknas till menyn hamnar här, hopräknat och sorterat efter butikens avdelningar. I butiken bockar du av varorna, och det du köpt kan läggas direkt i lagret.',
  },
  {
    route: '/',
    targets: [['.page-head .icon-btn']],
    title: 'Inställningar',
    text: 'Under kugghjulet finns utseende, notiser och synk mellan dina enheter. Där kan du också visa guiden igen. Nu är du redo att göra din första meny.',
  },
]

interface Box {
  top: number
  left: number
  width: number
  height: number
}

/** Luft runt det som lyses upp. */
const PAD = 8
/** Så högt upp på skärmen hamnar det upplysta när sidan rullas, så att textrutan får plats under. */
const TOP = 76
/** Avstånd mellan det upplysta och textrutan, och från rutan till skärmens kant. */
const GAP = 14
const EDGE = 12

/** Rutan som omsluter stegets delar, i fönstrets koordinater. null om inget av det finns på sidan. */
function locate(step: Step): { box: Box; first: Element } | null {
  for (const option of step.targets ?? []) {
    const found = option.map((sel) => document.querySelector(sel)).filter((el): el is Element => el !== null)
    if (found.length === 0) continue
    const rects = found.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
    if (rects.length === 0) continue
    const top = Math.min(...rects.map((r) => r.top))
    const left = Math.min(...rects.map((r) => r.left))
    const right = Math.max(...rects.map((r) => r.right))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { box: { top, left, width: right - left, height: bottom - top }, first: found[0] }
  }
  return null
}

/**
 * Rundturen: allt utom den del som förklaras tonas ner, och en ruta med text visas intill.
 * Appen under går inte att trycka på medan rundturen visas.
 */
export function Tour() {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  /** Steget är på plats (rätt sida, delen hittad och uppmätt). Tills dess visas ingen text. */
  const [ready, setReady] = useState(false)
  /** Textrutans höjd, uppmätt. Före första mätningen används en uppskattning. */
  const [cardHeight, setCardHeight] = useState(260)
  const cardRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const next = useRef<HTMLButtonElement>(null)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1

  // Medan rundturen visas får sidan extra utrymme nedtill, så att varje del går att rulla upp
  // högt på skärmen även på en nästan tom sida.
  useLayoutEffect(() => {
    document.body.classList.add('touring')
    return () => document.body.classList.remove('touring')
  }, [])

  // Gå till sidan som steget hör till.
  useEffect(() => {
    if (pathname !== step.route) navigate(step.route)
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hitta delen som ska lysas upp, rulla fram den och följ med när sidan rullas eller ändrar storlek.
  useLayoutEffect(() => {
    if (pathname !== step.route) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let tries = 0
    setReady(false)
    const measure = () => {
      if (stopped) return
      setBox(locate(step)?.box ?? null)
    }
    const settle = () => {
      if (stopped) return
      const hit = locate(step)
      // Sidan kan fortfarande hålla på att läsa in sin data: vänta en stund på delen.
      if (!hit && step.targets && tries++ < 30) {
        timer = setTimeout(settle, 60)
        return
      }
      if (hit) {
        // Rulla så att delen hamnar högt upp och textrutan får plats under den. Det som sitter
        // fast i fönstret (flikarna längst ner) rullas inte.
        const fixed = hit.first.closest('.nav') !== null || getComputedStyle(hit.first).position === 'fixed'
        const fits = hit.box.top >= TOP - PAD && hit.box.top + hit.box.height + PAD + GAP + cardHeight + EDGE <= window.innerHeight
        if (!fixed && !fits) window.scrollBy(0, hit.box.top - TOP)
      } else window.scrollTo(0, 0)
      measure()
      setReady(true)
    }
    settle()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      stopped = true
      clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [index, pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enter går vidare och Esc stänger, och knappen Nästa har fokus så att skärmläsare läser rutan.
  useEffect(() => {
    if (ready) next.current?.focus({ preventScroll: true })
  }, [ready, index])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mät textrutan när steget visas, så att den kan placeras utan att hamna utanför skärmen.
  useLayoutEffect(() => {
    if (ready && cardRef.current && cardRef.current.offsetHeight !== cardHeight) setCardHeight(cardRef.current.offsetHeight)
  })

  const vh = window.innerHeight
  const vw = window.innerWidth
  const room = cardHeight + GAP + EDGE
  // Det upplysta området: delen med lite luft, men aldrig utanför fönstret. En del som är så
  // hög att textrutan inte får plats lyses bara upp upptill.
  const lit = box
    ? (() => {
        const top = Math.max(4, box.top - PAD)
        const left = Math.max(4, box.left - PAD)
        const right = Math.min(vw - 4, box.left + box.width + PAD)
        let bottom = Math.min(vh - 4, box.top + box.height + PAD)
        if (vh - bottom < room && top < room) bottom = Math.max(top + 96, Math.min(bottom, vh - room))
        return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
      })()
    : { top: vh / 2, left: vw / 2, width: 0, height: 0 }

  // Textrutan hamnar under det upplysta om den får plats där, annars över, annars längst ner.
  const below = vh - (lit.top + lit.height)
  const above = lit.top
  const place = !box ? 'center' : below >= room ? 'below' : above >= room ? 'above' : 'bottom'
  const card: CSSProperties =
    place === 'center' ? { top: '50%', transform: 'translateY(-50%)' }
    : place === 'below' ? { top: lit.top + lit.height + GAP }
    : place === 'above' ? { bottom: vh - lit.top + GAP }
    : { bottom: EDGE }
  // Pilen pekar på mitten av det upplysta, men håller sig inom rutan.
  const cardWidth = Math.min(420, vw - 24)
  const cardLeft = (vw - cardWidth) / 2
  const arrow = Math.max(28, Math.min(cardWidth - 28, lit.left + lit.width / 2 - cardLeft))

  return (
    <div className="tour" data-step={index}>
      <div className={`tour-light${box ? '' : ' is-empty'}`} style={{ top: lit.top, left: lit.left, width: lit.width, height: lit.height }} aria-hidden="true" />
      {ready && (
        <div key={index} ref={cardRef} className={`tour-card is-${place}`} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" style={{ ...card, width: cardWidth, left: cardLeft, '--arrow': `${arrow}px` } as CSSProperties}>
          <div className="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => <span key={i} className={i === index ? 'is-on' : i < index ? 'is-past' : ''} />)}
          </div>
          <div className="tour-title" id="tour-title">{step.title}</div>
          <p id="tour-text">{step.text}</p>
          <div className="tour-actions">
            {index === 0 ? (
              <button type="button" className="btn text" onClick={endTour}>Hoppa över</button>
            ) : (
              <button type="button" className="btn text" onClick={() => setIndex(index - 1)}>Tillbaka</button>
            )}
            <span className="tour-count num">{index + 1} av {TOUR_STEPS.length}</span>
            <button ref={next} type="button" className="btn primary" onClick={() => (last ? endTour() : setIndex(index + 1))}>{last ? 'Klar' : index === 0 ? 'Visa mig' : 'Nästa'}</button>
          </div>
          {index > 0 && !last && <button type="button" className="tour-skip" onClick={endTour}>Hoppa över guiden</button>}
        </div>
      )}
    </div>
  )
}
