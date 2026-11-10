import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlannedNotification } from '../domain/notifications'

export const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** Ber om tillstånd, prenumererar på push och registrerar enheten hos servern. */
export async function subscribeDevice(client: SupabaseClient, userId: string): Promise<void> {
  if (!vapidKey) throw new Error('Push är inte konfigurerat (VITE_VAPID_PUBLIC_KEY saknas).')
  if (Notification.permission === 'denied') throw new Error('Notiser är blockerade i webbläsaren. Ändra det i webbplatsinställningarna.')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Tillstånd för notiser nekades.')
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }))
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Oväntad prenumeration från webbläsaren.')
  const { error } = await client
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: 'user_id,endpoint' })
  if (error) throw new Error(error.message)
}

export async function unsubscribeDevice(client: SupabaseClient, userId: string): Promise<void> {
  const sub = await currentSubscription()
  if (sub) {
    await client.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  const { count } = await client.from('push_subscriptions').select('endpoint', { count: 'exact', head: true }).eq('user_id', userId)
  if (!count) await client.from('notifications').delete().eq('user_id', userId).eq('sent', false)
}

/** Ersätter alla ännu inte skickade, framtida notiser med den nya planen. */
/**
 * Matplaneraren delar Supabase med Studieassistenten. Notisernas id får ett eget prefix, och bara
 * den här appens egna kommande notiser ersätts, så att apparna inte raderar varandras.
 */
export const NOTIFY_PREFIX = 'mat:'

export async function uploadNotifications(client: SupabaseClient, userId: string, planned: PlannedNotification[]): Promise<void> {
  const del = await client.from('notifications').delete().eq('user_id', userId).eq('sent', false).gt('fire_at', new Date().toISOString()).like('id', `${NOTIFY_PREFIX}%`)
  if (del.error) throw new Error(del.error.message)
  if (planned.length === 0) return
  const { error } = await client.from('notifications').upsert(
    planned.map((n) => ({ user_id: userId, id: `${NOTIFY_PREFIX}${n.id}`, fire_at: n.fireAt.toISOString(), title: n.title, body: n.body })),
    { onConflict: 'user_id,id' },
  )
  if (error) throw new Error(error.message)
}
