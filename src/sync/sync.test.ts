import { beforeEach, describe, expect, it } from 'vitest'
import { AppDB } from '../db/db'
import { hashOf, runSync, type OutRow, type Remote, type RemoteRow } from './engine'

class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>()
  clock = 0
  pushes = 0
  failNextPush = false
  async pull(since: string | null) {
    return [...this.rows.values()].filter((r) => !since || r.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  }
  async push(rows: OutRow[]) {
    if (this.failNextPush) {
      this.failNextPush = false
      throw new Error('offline')
    }
    this.pushes++
    const ts = `2026-11-08T12:00:${String(++this.clock).padStart(2, '0')}.000000+00:00`
    for (const r of rows) this.rows.set(`${r.collection}:${r.id}`, { ...r, updated_at: ts })
  }
}

let a: AppDB
let b: AppDB
let remote: FakeRemote
const item = (id: string, name: string) => ({ id, name, addedAt: '2026-11-08', source: 'manual' as const, updatedAt: '' })

beforeEach(async () => {
  a = new AppDB(`a-${Math.random()}`)
  b = new AppDB(`b-${Math.random()}`)
  remote = new FakeRemote()
})

describe('synk', () => {
  it('första inloggningen laddar upp befintlig lokal data (migrering)', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    await a.shopping.put({ id: 'l1', name: 'Ägg', done: false, addedAt: '2026-11-08', updatedAt: '' })
    await a.settings.put({ id: 'main', theme: 'dark', food: { allergies: '', portions: 2, quickWeekdays: [], trainingWeekdays: [], shopping: { enabled: true, weekday: 5, time: '16:00' }, expiry: { enabled: true, time: '08:00' } }, nutrition: { waterMl: 2000, glassMl: 250 }, memories: [] })
    const r = await runSync(a, remote, 'u1')
    expect(r.pushed).toBe(3)
    expect([...remote.rows.keys()].sort()).toEqual(['pantry:s1', 'settings:main', 'shopping:l1'])
  })

  it('ändringar går mellan två enheter åt båda håll, inklusive borttagning', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    await runSync(a, remote, 'u1')
    await runSync(b, remote, 'u1')
    expect((await b.pantry.get('s1'))?.name).toBe('Matte')

    await b.pantry.put(item('s1', 'Matematik'))
    await b.shopping.put({ id: 'e1', name: 'Prov', done: false, addedAt: '2026-11-08', updatedAt: '' })
    await runSync(b, remote, 'u1')
    await runSync(a, remote, 'u1')
    expect((await a.pantry.get('s1'))?.name).toBe('Matematik')
    expect((await a.shopping.get('e1'))?.name).toBe('Prov')

    await a.shopping.delete('e1')
    await runSync(a, remote, 'u1')
    await runSync(b, remote, 'u1')
    expect(await b.shopping.get('e1')).toBeUndefined()
  })

  it('en andra synk utan ändringar skickar och tillämpar ingenting', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    await runSync(a, remote, 'u1')
    const again = await runSync(a, remote, 'u1')
    expect(again).toMatchObject({ pushed: 0, applied: 0 })
  })

  it('lokal osynkad ändring skrivs inte över av inkommande, utan vinner', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    await runSync(a, remote, 'u1')
    await runSync(b, remote, 'u1')
    await a.pantry.put(item('s1', 'Från A'))
    await runSync(a, remote, 'u1')
    await b.pantry.put(item('s1', 'Lokalt på B')) // B har inte hunnit synka A:s ändring
    await runSync(b, remote, 'u1')
    expect((await b.pantry.get('s1'))?.name).toBe('Lokalt på B')
    await runSync(a, remote, 'u1')
    expect((await a.pantry.get('s1'))?.name).toBe('Lokalt på B') // senast synkade skrivningen gäller
  })

  it('misslyckad uppladdning förlorar inget och försöks igen', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    remote.failNextPush = true
    await expect(runSync(a, remote, 'u1')).rejects.toThrow('offline')
    expect(remote.rows.size).toBe(0)
    expect((await runSync(a, remote, 'u1')).pushed).toBe(1)
    expect(remote.rows.size).toBe(1)
  })

  it('byte av konto laddar upp enhetens data till det nya kontot', async () => {
    await a.pantry.put(item('s1', 'Matte'))
    await runSync(a, remote, 'u1')
    const other = new FakeRemote()
    expect((await runSync(a, other, 'u2')).pushed).toBe(1)
  })

  it('ignorerar felaktiga poster från servern', async () => {
    remote.rows.set('pantry:x', { collection: 'pantry', id: 'x', data: { id: 'annat', name: 'Fel' }, deleted: false, updated_at: '2026-11-08T12:00:01.000000+00:00' })
    remote.rows.set('okänd:y', { collection: 'okänd', id: 'y', data: { id: 'y' }, deleted: false, updated_at: '2026-11-08T12:00:02.000000+00:00' })
    const r = await runSync(a, remote, 'u1')
    expect(r.applied).toBe(0)
    expect(await a.pantry.count()).toBe(0)
  })

  it('hash är oberoende av nyckelordning', () => {
    expect(hashOf({ a: 1, b: [1, 2], c: undefined })).toBe(hashOf({ b: [1, 2], a: 1 }))
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }))
  })
})
