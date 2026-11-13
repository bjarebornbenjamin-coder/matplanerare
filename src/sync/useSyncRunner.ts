import { liveQuery } from 'dexie'
import { useEffect } from 'react'
import { db } from '../db/db'
import { savePendingAnswers } from '../db/repo'
import { COLLECTIONS, runSync } from './engine'
import { setSyncStatus } from './status'
import { supabase, supabaseRemote, useSession } from './supabase'

const POLL_MS = 60_000
const DEBOUNCE_MS = 2_000

/** Kör synken när man är inloggad: vid start, vid ändringar, när nätet kommer tillbaka och regelbundet. */
export function useSyncRunner(): void {
  const session = useSession()
  const userId = session?.user.id

  useEffect(() => {
    if (!supabase || !userId) {
      setSyncStatus({ state: 'off', error: '' })
      return
    }
    const client = supabase
    const remote = supabaseRemote(client, userId)
    let running = false
    let again = false
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function sync() {
      if (stopped) return
      if (running) {
        again = true
        return
      }
      if (!navigator.onLine) return
      running = true
      setSyncStatus({ state: 'syncing', error: '' })
      try {
        await runSync(db, remote, userId!)
        // Nu är kontots inställningar hämtade: lägg till svaren från frågorna före inloggningen.
        await savePendingAnswers()
        setSyncStatus({ state: 'idle', lastSync: Date.now(), error: '' })
      } catch (e) {
        setSyncStatus({ state: 'error', error: e instanceof Error ? e.message : 'Synken misslyckades.' })
      } finally {
        running = false
        if (again) {
          again = false
          schedule()
        }
      }
    }
    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(() => void sync(), DEBOUNCE_MS)
    }

    void sync()
    const sub = liveQuery(() => Promise.all(COLLECTIONS.map((c) => db[c].toArray()))).subscribe({ next: schedule, error: () => {} })
    const onVisible = () => document.visibilityState === 'visible' && schedule()
    const poll = setInterval(() => document.visibilityState === 'visible' && void sync(), POLL_MS)
    window.addEventListener('online', schedule)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('manual-sync', schedule)
    return () => {
      stopped = true
      clearTimeout(timer)
      clearInterval(poll)
      sub.unsubscribe()
      window.removeEventListener('online', schedule)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('manual-sync', schedule)
    }
  }, [userId])
}
