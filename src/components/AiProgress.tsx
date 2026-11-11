import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Sant medan AI:n arbetar. */
  active: boolean
  /** Ungefär hur lång tid det brukar ta, i sekunder. */
  expected: number
  label: string
  /** Verkligt förlopp 0–100 när det är känt (t.ex. hämtade recept). Utelämnat = uppskattning. */
  value?: number
  /** Uppskattningen stannar under det här värdet (standard 95). */
  cap?: number
}

/** Uppskattat förlopp efter t sekunder: snabbt först, sedan allt långsammare mot 95 %. */
export const estimate = (t: number, expected: number, cap = 95) => cap * (1 - Math.exp((-2 * t) / expected))

/**
 * Förloppsstapel 0–100 % medan AI:n arbetar. AI:n rapporterar inte hur långt den kommit,
 * så stapeln är en uppskattning och går till 100 % när svaret kommer. Stapeln ritas om varje
 * bildruta (transform, inte bredd) så att den glider jämnt i stället för att hoppa.
 */
export function AiProgress({ active, expected, label, value, cap = 95 }: Props) {
  const [pct, setPct] = useState(0)
  const [visible, setVisible] = useState(active)
  const [finishing, setFinishing] = useState(false)
  const fill = useRef<HTMLDivElement>(null)
  const current = useRef(0)
  const target = useRef<{ value?: number; cap: number }>({ value, cap })
  target.current = { value, cap }

  useEffect(() => {
    if (active) {
      const start = performance.now()
      current.current = 0
      setVisible(true)
      setFinishing(false)
      setPct(0)
      let frame = 0
      const tick = (now: number) => {
        const t = target.current
        // Känt förlopp: glid mot det. Annars uppskattning. Stapeln går aldrig bakåt.
        const next = t.value === undefined ? estimate((now - start) / 1000, expected, t.cap) : current.current + (Math.min(100, t.value) - current.current) * 0.08
        const p = Math.max(current.current, next)
        current.current = p
        if (fill.current) fill.current.style.transform = `scaleX(${p / 100})`
        setPct((old) => (Math.floor(p) !== old ? Math.floor(p) : old))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(frame)
    }
    if (!visible) return
    // Glid sista biten till 100 % och göm sedan stapeln.
    setFinishing(true)
    setPct(100)
    requestAnimationFrame(() => {
      if (fill.current) fill.current.style.transform = 'scaleX(1)'
    })
    const hide = setTimeout(() => setVisible(false), 700)
    return () => clearTimeout(hide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, expected])

  if (!visible) return null
  return (
    <div className="ai-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="ai-progress-head">
        <span>{pct === 100 ? 'Klart' : label}</span>
        <span className="num">{pct} %</span>
      </div>
      <div className="ai-progress-track">
        <div ref={fill} className={`ai-progress-fill${finishing ? ' finishing' : ''}`} style={{ transform: `scaleX(${current.current / 100})` }} />
      </div>
    </div>
  )
}
