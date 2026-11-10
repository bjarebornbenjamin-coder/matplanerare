import type { HHmm, ISODate } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toHHmm(d: Date): HHmm {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** 1 = måndag … 7 = söndag */
export function weekdayOf(s: ISODate): number {
  const w = parseISODate(s).getDay()
  return w === 0 ? 7 : w
}

export function mondayOf(s: ISODate): ISODate {
  return addDays(s, 1 - weekdayOf(s))
}

/** Hela dagar mellan två datum, oberoende av sommartid. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export const WEEKDAYS_SHORT = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']
export const WEEKDAYS_LONG = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag']

/** ISO-veckonummer (vecka 1 är veckan med årets första torsdag). */
export function isoWeek(s: ISODate): number {
  const thursday = addDays(mondayOf(s), 3)
  const year = Number(thursday.slice(0, 4))
  return Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1
}

/** "tisdag 10 november" */
export function dayLabel(date: ISODate): string {
  return parseISODate(date).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' })
}
