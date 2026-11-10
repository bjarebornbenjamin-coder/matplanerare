import { addDays, parseISODate, toISODate, weekdayOf } from './dates'
import type { PantryItem, PlannedDinner, Settings, ShoppingItem } from './types'

export interface PlannedNotification {
  /** Stabilt id så att samma notis inte dubbleras vid omplanering. */
  id: string
  fireAt: Date
  title: string
  body: string
}

const at = (date: string, time: string): Date => {
  const d = parseISODate(date)
  d.setHours(Number(time.slice(0, 2)), Number(time.slice(3, 5)), 0, 0)
  return d
}

const list = (items: string[], max: number) => items.slice(0, max).join(', ') + (items.length > max ? ` +${items.length - max} till` : '')

/** Notiser de närmaste `days` dagarna: mat som snart går ut, inköpslistan och kvällens middag. */
export function planNotifications(
  now: Date,
  s: Pick<Settings, 'food'>,
  food: { pantry: PantryItem[]; shopping: ShoppingItem[]; mealPlan?: PlannedDinner[] },
  days = 14,
): PlannedNotification[] {
  const out: PlannedNotification[] = []
  const today = toISODate(now)
  const f = s.food

  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i)

    if (f.expiry.enabled) {
      const tomorrow = addDays(date, 1)
      const soon = food.pantry
        .filter((p) => p.expires === date || p.expires === tomorrow)
        .sort((a, b) => (a.expires ?? '').localeCompare(b.expires ?? '') || a.name.localeCompare(b.name, 'sv'))
      const fireAt = at(date, f.expiry.time)
      if (soon.length > 0 && fireAt > now) {
        const dinner = food.mealPlan?.find((d) => d.date === date)
        out.push({
          id: `expiry:${date}`,
          fireAt,
          title: dinner ? `Ikväll: ${dinner.title}` : 'Mat som snart går ut',
          body: (dinner ? 'Går ut snart: ' : '') + list(soon.map((p) => `${p.name} (${p.expires === date ? 'idag' : 'imorgon'})`), 4),
        })
      }
    }

    if (f.shopping.enabled && weekdayOf(date) === f.shopping.weekday) {
      const open = food.shopping.filter((i) => !i.done)
      const fireAt = at(date, f.shopping.time)
      if (open.length > 0 && fireAt > now) {
        out.push({
          id: `shopping:${date}`,
          fireAt,
          title: `Inköpslistan: ${open.length} ${open.length === 1 ? 'vara' : 'varor'}`,
          body: list(open.map((i) => i.name), 6),
        })
      }
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
