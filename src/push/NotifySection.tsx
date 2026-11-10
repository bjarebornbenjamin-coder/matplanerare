import { useCallback, useEffect, useState } from 'react'
import { saveSettings } from '../db/repo'
import { useSettings } from '../hooks'
import { authHeaders } from '../lib/auth'
import { supabase, useSession } from '../sync/supabase'
import { currentSubscription, pushSupported, subscribeDevice, unsubscribeDevice, vapidKey } from './push'

const WEEKDAY_NAMES = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag']

export function NotifySection() {
  const settings = useSettings()
  const session = useSession()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setSubscribed(pushSupported() && Notification.permission === 'granted' ? Boolean(await currentSubscription()) : false)
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!settings) return null
  const food = settings.food

  const head = null
  if (!pushSupported()) {
    return <>{head}<p className="muted">Den här webbläsaren stöder inte push-notiser. På iPhone måste appen först läggas till på hemskärmen (iOS 16.4 eller senare).</p></>
  }
  if (!supabase || !vapidKey) {
    return <>{head}<p className="muted">Notiser är inte påslagna på den här installationen. Se README (avsnittet Push-notiser).</p></>
  }
  if (!session) {
    return <>{head}<p className="muted">Logga in under Synk mellan enheter för att kunna få notiser. Servern behöver veta vem du är för att skicka till rätt enhet.</p></>
  }
  const client = supabase
  const userId = session.user.id

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setMessage('')
    try {
      await fn()
      setMessage(ok)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Något gick fel.')
    } finally {
      setBusy(false)
      await refresh()
      window.dispatchEvent(new Event('push-changed'))
    }
  }

  async function test() {
    const headers = await authHeaders()
    const res = await fetch('/api/push-test', { method: 'POST', headers: headers ?? {} })
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) throw new Error(body.error?.message ?? `Servern svarade med fel ${res.status}.`)
  }

  return (
    <>
      {head}
      <div className="checks" style={{ marginBottom: 8 }}>
        <label>
          <input type="checkbox" checked={food.expiry.enabled} onChange={(e) => saveSettings({ food: { ...food, expiry: { ...food.expiry, enabled: e.target.checked } } })} />
          Notis när mat snart går ut (med kvällens middag om den är planerad)
        </label>
      </div>
      {food.expiry.enabled && (
        <label className="field">
          <span>Tid för utgångsnotis</span>
          <input type="time" value={food.expiry.time} onChange={(e) => e.target.value && saveSettings({ food: { ...food, expiry: { ...food.expiry, time: e.target.value } } })} />
        </label>
      )}
      <div className="checks" style={{ marginBottom: 8 }}>
        <label>
          <input type="checkbox" checked={food.shopping.enabled} onChange={(e) => saveSettings({ food: { ...food, shopping: { ...food.shopping, enabled: e.target.checked } } })} />
          Notis med inköpslistan
        </label>
      </div>
      {food.shopping.enabled && (
        <div className="two">
          <label className="field">
            <span>Dag</span>
            <select value={food.shopping.weekday} onChange={(e) => saveSettings({ food: { ...food, shopping: { ...food.shopping, weekday: Number(e.target.value) } } })}>
              {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d[0].toUpperCase() + d.slice(1)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Tid</span>
            <input type="time" value={food.shopping.time} onChange={(e) => e.target.value && saveSettings({ food: { ...food, shopping: { ...food.shopping, time: e.target.value } } })} />
          </label>
        </div>
      )}

      <p className="muted">
        {subscribed === null ? '' : subscribed ? 'Den här enheten tar emot notiser.' : 'Den här enheten tar inte emot notiser än.'}
      </p>
      <div className="actions" style={{ marginTop: 0 }}>
        {subscribed ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => run(test, 'Testnotis skickad.')}>Skicka testnotis</button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => run(() => unsubscribeDevice(client, userId), 'Notiser avstängda på den här enheten.')}>Stäng av på den här enheten</button>
          </>
        ) : (
          <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => subscribeDevice(client, userId), 'Notiser påslagna.')}>Slå på notiser på den här enheten</button>
        )}
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      <p className="muted">
        Notiserna planeras 14 dagar framåt varje gång du öppnar appen eller ändrar matlagret eller inköpslistan. Öppna appen minst varannan vecka.
      </p>
    </>
  )
}
