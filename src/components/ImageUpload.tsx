import { useRef, type ReactNode } from 'react'

interface Props {
  /** Huvudtext i rutan, t.ex. "Välj en bild av kvittot". */
  title: string
  /** Kort hjälptext under, t.ex. "Skärmdump eller foto". */
  hint: string
  button: string
  busy: boolean
  /** Visar "Välj en annan bild" när en bild redan lästs av. */
  done: boolean
  onFile: (file: File) => void
  children?: ReactNode
}

/** Ruta för att välja en bild som AI:n ska läsa av. */
export function ImageUpload({ title, hint, button, busy, done, onFile, children }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="upload">
      <div className="upload-text">
        <div className="title">{title}</div>
        <div className="sub">{hint}</div>
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Läser av…' : done ? 'Välj en annan bild' : button}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      {children}
    </div>
  )
}

/** Hur det går till, i tre korta steg. */
export function Steps({ items }: { items: string[] }) {
  return (
    <ol className="how-steps">
      {items.map((s, i) => (
        <li key={s}>
          <span className="n" aria-hidden="true">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}
