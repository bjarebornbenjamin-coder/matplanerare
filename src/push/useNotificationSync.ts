import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { db } from '../db/db'
import { getSettings } from '../db/repo'
import { planNotifications } from '../domain/notifications'
import { supabase, useSession } from '../sync/supabase'
import { currentSubscription, pushSupported, uploadNotifications } from './push'

const DEBOUNCE_MS = 3_000

/** Håller serverns lista över kommande notiser i takt med matlagret, inköpslistan och inställningarna. */
export function useNotificationSync(): void {
  const session = useSession()
  const userId = session?.user.id

  useEffect(() => {
    if (!supabase || !userId || !pushSupported()) return
    const client = supabase
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = ''

    async function plan() {
      if (stopped || !navigator.onLine) return
      if (Notification.permission !== 'granted' || !(await currentSubscription())) return
      const [settings, pantry, shopping, mealPlan] = await Promise.all([getSettings(), db.pantry.toArray(), db.shopping.toArray(), db.mealPlan.toArray()])
      const planned = planNotifications(new Date(), settings, { pantry, shopping, mealPlan })
      const fingerprint = JSON.stringify(planned.map((n) => [n.id, n.fireAt.getTime(), n.title, n.body]))
      if (fingerprint === last) return
      try {
        await uploadNotifications(client, userId!, planned)
        last = fingerprint
      } catch {
        /* nästa ändring eller start försöker igen */
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void plan(), DEBOUNCE_MS)
    }

    schedule()
    const sub = liveQuery(() => Promise.all([db.settings.toArray(), db.pantry.toArray(), db.shopping.toArray(), db.mealPlan.toArray()])).subscribe({ next: schedule, error: () => {} })
    window.addEventListener('push-changed', schedule)
    window.addEventListener('online', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      stopped = true
      clearTimeout(timer)
      sub.unsubscribe()
      window.removeEventListener('push-changed', schedule)
      window.removeEventListener('online', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [userId])
}
