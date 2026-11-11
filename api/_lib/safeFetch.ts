import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'

/**
 * Hämtar en publik webbsida utan att servern kan luras att anropa interna adresser (SSRF):
 * bara https på port 443, domännamnet slås upp och ALLA adresser måste vara publika, och
 * anslutningen görs till just den kontrollerade adressen (så ett nytt DNS-svar däremellan inte
 * hjälper). Omdirigeringar följs inte automatiskt; varje ny adress kontrolleras på samma sätt.
 */

const v4 = (ip: string): number[] => ip.split('.').map(Number)

function publicV4(ip: string): boolean {
  const [a, b, c] = v4(ip)
  if (a === 0 || a === 10 || a === 127) return false // "denna", privat, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 169 && b === 254) return false // länklokal, bl.a. molnens metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // IETF, dokumentation
  if (a === 198 && (b === 18 || b === 19)) return false // test
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false // multicast, reserverat, broadcast
  return true
}

function publicV6(ip: string): boolean {
  const s = ip.toLowerCase()
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(s) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (mapped) return publicV4(mapped[1])
  if (s === '::' || s === '::1') return false
  const first = parseInt(s.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return false // unik lokal fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false // länklokal fe80::/10
  if ((first & 0xff00) === 0xff00) return false // multicast
  if (s.startsWith('2001:db8') || s.startsWith('2001:0db8')) return false // dokumentation
  if (first === 0x2002 || s.startsWith('64:ff9b')) return false // 6to4 och NAT64 kan peka på interna adresser
  if (first === 0) return false
  return true
}

/** Sant bara för vanliga publika internetadresser. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip)
  return kind === 4 ? publicV4(ip) : kind === 6 ? publicV6(ip) : false
}

type Resolve = (host: string) => Promise<LookupAddress[]>
const systemResolve: Resolve = (host) =>
  new Promise((ok, fail) => dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? fail(err) : ok(addrs))))

/** Slår upp värden och kräver att alla adresser är publika. Ger den adress som ska användas. */
export async function resolvePublic(host: string, resolve: Resolve = systemResolve, isAllowed: (ip: string) => boolean = isPublicAddress): Promise<LookupAddress> {
  if (isIP(host)) throw new Error('IP-adresser hämtas inte')
  const addrs = await resolve(host)
  if (addrs.length === 0 || !addrs.every((a) => isAllowed(a.address))) throw new Error(`${host} pekar på en intern adress`)
  return addrs[0]
}

/** Tillåter bara https på standardporten, utan inloggningsuppgifter i adressen. */
export function allowedTarget(u: URL): boolean {
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  const h = u.hostname.toLowerCase()
  return h.includes('.') && !h.endsWith('.local') && !h.endsWith('.internal') && !h.endsWith('.localhost') && h !== 'localhost' && !isIP(h.replace(/^\[|\]$/g, ''))
}

export interface PageResult {
  status: number
  contentType: string
  body: string
}

export interface FetchPageOptions {
  timeoutMs: number
  maxBytes: number
  maxRedirects?: number
  headers?: Record<string, string>
  /** Byts bara i tester. */
  resolve?: Resolve
  isAllowedAddress?: (ip: string) => boolean
  ca?: string
}

function once(url: URL, address: LookupAddress, o: FetchPageOptions): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((done, fail) => {
    // Anslut till den redan kontrollerade adressen, vad DNS än svarar nu.
    const pinned: LookupFunction = (_host, opts, cb) => {
      if (opts && (opts as { all?: boolean }).all) (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, [address])
      else cb(null, address.address, address.family)
    }
    const req = request(url, { method: 'GET', lookup: pinned, ...(o.ca ? { ca: o.ca } : {}), headers: { ...o.headers, 'Accept-Encoding': 'gzip, deflate, br' }, timeout: o.timeoutMs }, (res) => {
      const status = res.statusCode ?? 0
      const contentType = String(res.headers['content-type'] ?? '')
      if (status >= 300 && status < 400) {
        res.resume()
        done({ status, location: typeof res.headers.location === 'string' ? res.headers.location : undefined, contentType, body: '' })
        return
      }
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
      let stream: Readable = res
      if (enc === 'gzip') stream = res.pipe(createGunzip())
      else if (enc === 'deflate') stream = res.pipe(createInflate())
      else if (enc === 'br') stream = res.pipe(createBrotliDecompress())
      const chunks: Buffer[] = []
      let size = 0
      stream.on('data', (c: Buffer) => {
        size += c.length
        if (size > o.maxBytes) {
          chunks.push(c.subarray(0, Math.max(0, c.length - (size - o.maxBytes))))
          req.destroy()
          done({ status, contentType, body: Buffer.concat(chunks).toString('utf8') })
          return
        }
        chunks.push(c)
      })
      stream.on('end', () => done({ status, contentType, body: Buffer.concat(chunks).toString('utf8') }))
      stream.on('error', fail)
    })
    // Total tidsgräns, inte bara för en tyst anslutning.
    const timer = setTimeout(() => req.destroy(new Error('tidsgräns')), o.timeoutMs)
    req.on('close', () => clearTimeout(timer))
    req.on('timeout', () => req.destroy(new Error('tidsgräns')))
    req.on('error', fail)
    req.end()
  })
}

/** Hämtar sidan, följer högst några omdirigeringar och kontrollerar varje ny adress. */
export async function fetchPublicPage(start: URL, o: FetchPageOptions): Promise<PageResult | null> {
  let url = start
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    if (!allowedTarget(url)) return null
    const address = await resolvePublic(url.hostname, o.resolve, o.isAllowedAddress)
    const r = await once(url, address, o)
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) return null
      try {
        url = new URL(r.location, url)
      } catch {
        return null
      }
      continue
    }
    return { status: r.status, contentType: r.contentType, body: r.body }
  }
  return null
}
