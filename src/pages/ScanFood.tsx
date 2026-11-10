import { useRef, useState } from 'react'
import { AiProgress } from '../components/AiProgress'
import { ImageUpload, Steps } from '../components/ImageUpload'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { matchExisting, parseScanResponse, scanImage, type ScanKind, type ScanRow } from '../ai/foodScan'
import { addPantryItems } from '../db/repo'
import { toISODate } from '../domain/dates'
import { useAiConfig, usePantry, useShopping } from '../hooks'
import { authHeaders } from '../lib/auth'
import { imageToDataUrl } from '../lib/image'

const TEXT: Record<ScanKind, { title: string; lead: string; box: string; hint: string; button: string; tips: string[] }> = {
  receipt: {
    title: 'Skanna kvitto',
    lead: 'Fota kvittot, så lägger AI:n in varorna i ditt matlager.',
    box: 'Välj en bild av kvittot',
    hint: 'Foto eller skärmdump av ett e-kvitto',
    button: 'Välj kvitto',
    tips: ['Fota rakt ovanifrån och se till att texten är skarp.', 'Dölj gärna kortnumret.', 'Bäst före-datumen är uppskattningar som du kan ändra.'],
  },
  fridge: {
    title: 'Skanna kylskåp',
    lead: 'Fota kylskåpet, frysen eller skafferiet, så listar AI:n vad som finns.',
    box: 'Välj ett foto',
    hint: 'Med dörren öppen och bra ljus',
    button: 'Välj foto',
    tips: ['AI:n ser bara det som syns, så saker längst in kan missas.', 'Mängderna är gissningar som du kan ändra.'],
  },
}

export function ScanFoodPage() {
  const [params] = useSearchParams()
  const kind: ScanKind = params.get('typ') === 'kylskap' ? 'fridge' : 'receipt'
  const t = TEXT[kind]
  const config = useAiConfig()
  const pantry = usePantry()
  const shopping = useShopping()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState('')
  const [rows, setRows] = useState<ScanRow[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!config || !pantry || !shopping) return null

  const match = matchExisting(pantry, shopping)

  async function onFile(file: File) {
    setError('')
    setRows(null)
    setBusy(true)
    try {
      const image = await imageToDataUrl(file)
      setPreview(image)
      const text = await scanImage(kind, image, config!.model, await authHeaders())
      const parsed = parseScanResponse(text, kind, toISODate(new Date()))
      setSkipped(parsed.skipped)
      setRows(parsed.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const update = (key: string, patch: Partial<ScanRow>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null)
  const chosen = rows?.filter((r) => r.include && r.name.trim()) ?? []
  const clearing = kind === 'receipt' ? chosen.filter((r) => match.listHit(r)) : []

  async function save() {
    await addPantryItems(chosen.map((r) => ({ name: r.name, amount: r.amount, expires: r.expires || undefined })), kind, { clearFromList: kind === 'receipt' })
    navigate('/lager')
  }

  return (
    <>
      <Link to="/lager" className="back">‹ Tillbaka till Lager</Link>
      <h1>{t.title}</h1>
      <p className="lead">{t.lead}</p>
      <ImageUpload title={t.box} hint={t.hint} button={t.button} busy={busy} done={Boolean(rows)} onFile={onFile} />
      {!rows && !busy && (
        <>
          <Steps items={[t.box, 'Granska och ändra varorna', 'Lägg dem i lagret']} />
          <ul className="tips">{t.tips.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="footnote">Bilden skickas till OpenAI för avläsning och sparas inte.</p>
        </>
      )}
      <AiProgress active={busy} expected={15} label="AI:n läser av bilden" />
      {error && (
        <>
          <p className="error" role="alert">{error}</p>
          <div className="actions" style={{ marginTop: 0 }}><Link to="/installningar/ai" className="btn">Testa anslutningen</Link></div>
        </>
      )}
      {preview && <img src={preview} alt={kind === 'receipt' ? 'Ditt kvitto' : 'Ditt foto'} className="import-preview" />}

      {rows && (
        <>
          <h2>Hittade {rows.length} varor{skipped > 0 ? ` (${skipped} hoppades över)` : ''}</h2>
          {rows.length === 0 && <p className="empty">Inga varor hittades. Prova en skarpare bild.</p>}
          {rows.map((r) => {
            const inPantry = match.pantryHit(r)
            const onList = kind === 'receipt' ? match.listHit(r) : undefined
            return (
              <div key={r.key} className={`card import-row${r.include ? '' : ' off'}`}>
                <label className="checks" style={{ margin: 0 }}>
                  <span className="row" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} />
                    <span className="title">{r.name || 'Namnlös'}{r.amount ? ` · ${r.amount}` : ''}</span>
                  </span>
                </label>
                {inPantry && <p className="sub">Finns redan i lagret{inPantry.amount ? ` (${inPantry.amount})` : ''}. Det läggs till som en ny post.</p>}
                {onList && r.include && <p className="sub">Tas bort från inköpslistan.</p>}
                {r.include && (
                  <div className="import-fields">
                    <input type="text" aria-label="Vara" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} />
                    <input type="text" aria-label="Mängd" placeholder="Mängd" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
                    <input type="date" aria-label="Bäst före" value={r.expires} onChange={(e) => update(r.key, { expires: e.target.value })} />
                  </div>
                )}
              </div>
            )
          })}
          <div className="actions">
            <button type="button" className="btn primary" disabled={chosen.length === 0} onClick={save}>
              Lägg {chosen.length} {chosen.length === 1 ? 'vara' : 'varor'} i lagret{clearing.length > 0 ? ` (${clearing.length} tas bort från listan)` : ''}
            </button>
            <Link to="/lager" className="btn">Avbryt</Link>
          </div>
        </>
      )}
    </>
  )
}
