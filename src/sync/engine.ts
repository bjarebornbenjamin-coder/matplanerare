import type { AppDB } from '../db/db'

/**
 * Lokalt först: all data ligger i IndexedDB. Synken jämför varje posts innehåll mot det som
 * senast synkades (hash), så den märker ändringar oavsett var i koden de gjordes.
 * Konflikter: en lokal osynkad ändring vinner över en inkommande; annars gäller senaste skrivning på servern.
 */

export const COLLECTIONS = ['settings', 'pantry', 'shopping', 'mealPlan', 'sides', 'ratings'] as const
export type Collection = (typeof COLLECTIONS)[number]

export interface RemoteRow {
  collection: string
  id: string
  data: unknown | null
  deleted: boolean
  updated_at: string
}
export interface OutRow {
  collection: string
  id: string
  data: unknown | null
  deleted: boolean
}
export interface Remote {
  /** Alla poster ändrade vid eller efter `since` (null = alla). */
  pull(since: string | null): Promise<RemoteRow[]>
  push(rows: OutRow[]): Promise<void>
}

export interface SyncResult {
  pulled: number
  applied: number
  pushed: number
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** cyrb53: liten, snabb hash. Räcker för att upptäcka ändringar. */
export function hashOf(v: unknown): string {
  const s = stable(v)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const keyOf = (collection: string, id: string) => `${collection}:${id}`
const isCollection = (c: string): c is Collection => (COLLECTIONS as readonly string[]).includes(c)
const tableOf = (db: AppDB, c: Collection) => db[c] as unknown as import('dexie').Table<{ id: string }, string>

function validRemote(r: RemoteRow): boolean {
  if (r.deleted) return true
  return typeof r.data === 'object' && r.data !== null && (r.data as { id?: unknown }).id === r.id
}

/** Tillämpar en inkommande post, om inte en lokal osynkad ändring finns. */
async function applyRemote(db: AppDB, r: RemoteRow): Promise<boolean> {
  if (!isCollection(r.collection) || !validRemote(r)) return false
  const table = tableOf(db, r.collection)
  const key = keyOf(r.collection, r.id)
  return db.transaction('rw', [table, db.syncState], async () => {
    const state = await db.syncState.get(key)
    const local = await table.get(r.id)
    const localDirty = local ? !state || state.hash !== hashOf(local) : Boolean(state)
    if (localDirty) return false
    if (r.deleted) {
      if (!local) return false
      await table.delete(r.id)
      await db.syncState.delete(key)
      return true
    }
    const hash = hashOf(r.data)
    const changed = !local || hashOf(local) !== hash
    if (changed) await table.put(r.data as { id: string })
    await db.syncState.put({ key, hash })
    return changed
  })
}

interface Pending {
  key: string
  hash: string | null // null = borttagning
  row: OutRow
}

async function collectChanges(db: AppDB): Promise<Pending[]> {
  const state = new Map((await db.syncState.toArray()).map((s) => [s.key, s.hash]))
  const out: Pending[] = []
  for (const c of COLLECTIONS) {
    const local = await tableOf(db, c).toArray()
    const seen = new Set<string>()
    for (const rec of local) {
      const key = keyOf(c, rec.id)
      seen.add(key)
      const hash = hashOf(rec)
      if (state.get(key) !== hash) out.push({ key, hash, row: { collection: c, id: rec.id, data: rec, deleted: false } })
    }
    for (const key of state.keys()) {
      if (key.startsWith(`${c}:`) && !seen.has(key)) {
        out.push({ key, hash: null, row: { collection: c, id: key.slice(c.length + 1), data: null, deleted: true } })
      }
    }
  }
  return out
}

export async function runSync(db: AppDB, remote: Remote, userId: string): Promise<SyncResult> {
  let meta = await db.syncMeta.get('main')
  if (!meta || meta.userId !== userId) {
    // Första inloggningen (eller annat konto): all lokal data räknas som osynkad och laddas upp.
    await db.syncState.clear()
    meta = { key: 'main', userId, cursor: null }
    await db.syncMeta.put(meta)
  }

  const rows = await remote.pull(meta.cursor)
  let cursor = meta.cursor
  let applied = 0
  for (const r of rows) {
    if (!cursor || r.updated_at > cursor) cursor = r.updated_at
    if (await applyRemote(db, r)) applied++
  }

  const pending = await collectChanges(db)
  for (let i = 0; i < pending.length; i += 200) {
    const chunk = pending.slice(i, i + 200)
    await remote.push(chunk.map((p) => p.row))
    await db.transaction('rw', db.syncState, async () => {
      for (const p of chunk) {
        if (p.hash === null) await db.syncState.delete(p.key)
        else await db.syncState.put({ key: p.key, hash: p.hash })
      }
    })
  }

  await db.syncMeta.put({ key: 'main', userId, cursor })
  return { pulled: rows.length, applied, pushed: pending.length }
}
