import { describe, expect, it } from 'vitest'
import { allowedTarget, fetchPublicPage, isPublicAddress, resolvePublic } from './_lib/safeFetch.js'

describe('skydd mot att servern hämtar interna adresser (SSRF)', () => {
  it('känner igen privata och interna adresser', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a00:1', '2002:c0a8:101::1', 'inte-en-ip'])
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false])
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::6810:85e5', '::ffff:8.8.8.8']) expect([ip, isPublicAddress(ip)]).toEqual([ip, true])
  })
  it('kontrollerar adresserna efter DNS-uppslaget, alla måste vara publika', async () => {
    const dns = (...addrs: string[]) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
    await expect(resolvePublic('ica.se', dns('93.184.216.34'))).resolves.toMatchObject({ address: '93.184.216.34' })
    await expect(resolvePublic('intern.example.com', dns('10.0.0.5'))).rejects.toThrow(/intern/)
    await expect(resolvePublic('blandad.example.com', dns('93.184.216.34', '127.0.0.1'))).rejects.toThrow(/intern/)
    await expect(resolvePublic('metadata.example.com', dns('169.254.169.254'))).rejects.toThrow(/intern/)
    await expect(resolvePublic('127.0.0.1', dns('127.0.0.1'))).rejects.toThrow()
  })
  it('bara https på port 443, utan inloggningsuppgifter, och inga IP-adresser eller lokala namn', () => {
    expect(allowedTarget(new URL('https://www.ica.se/recept/x/'))).toBe(true)
    for (const bad of ['http://www.ica.se/', 'https://www.ica.se:8443/', 'https://u:p@ica.se/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest/meta-data', 'https://router.local/', 'https://db.internal/', 'file:///etc/passwd'])
      expect([bad, allowedTarget(new URL(bad))]).toEqual([bad, false])
  })
  it('hämtar aldrig en sida vars namn pekar på en intern adress', async () => {
    const o = { timeoutMs: 1000, maxBytes: 1000, resolve: async () => [{ address: '127.0.0.1', family: 4 }] }
    await expect(fetchPublicPage(new URL('https://ser-publik-ut.example.com/'), o)).rejects.toThrow(/intern/)
    expect(await fetchPublicPage(new URL('http://www.ica.se/'), o)).toBeNull()
  })
})
