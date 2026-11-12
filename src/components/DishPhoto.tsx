import { useEffect, useRef, useState } from 'react'
import { httpsUrl } from '../domain/recipeLink'

interface Props {
  /** Receptets bild. Visas bara om adressen är https. */
  src: string | undefined
  className?: string
  /** Meddelar om bilden laddades, så att omgivningen kan anpassa sig (t.ex. mörk toning bakom text). */
  onLoaded?: (ok: boolean) => void
}

/**
 * Bild på en rätt från receptsidan. Tonas in när den är laddad. Går bilden inte att ladda
 * (borttagen, blockerad, offline) visas ingenting, så kortet ser ut som det gjorde utan bild.
 * Bilden är dekorativ: rättens namn står alltid som text bredvid.
 */
export function DishPhoto({ src, className = '', onLoaded }: Props) {
  const url = httpsUrl(src)
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setState('loading')
    // En bild som redan finns i webbläsarens minne kan vara klar innan onLoad hinner kopplas in.
    if (img.current?.complete && img.current.naturalWidth > 0) setState('ok')
  }, [url])
  useEffect(() => {
    if (state !== 'loading') onLoaded?.(state === 'ok')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  useEffect(() => {
    if (!url) onLoaded?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  if (!url || state === 'failed') return null
  return (
    <span className={`photo ${className}${state === 'ok' ? ' is-loaded' : ''}`} aria-hidden="true">
      <img ref={img} src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setState('ok')} onError={() => setState('failed')} />
    </span>
  )
}
