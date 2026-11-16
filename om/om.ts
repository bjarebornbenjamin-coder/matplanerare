import './vendor/scrollcraft.css'
import './om.css'
import './vendor/scrollcraft.js'
import { WEEKDAYS_SHORT, addDays, dayLabel, parseISODate, toISODate, weekdayOf } from '../src/domain/dates'
import { expiringWithin, expiryLabel, expiryStatus } from '../src/domain/food'
import { MAX_PORTIONS, MIN_PORTIONS, portionCaption } from '../src/domain/onboarding'
import { cleanName } from '../src/domain/shoppingName'
import type { PantryItem } from '../src/domain/types'
import { FRIDGE, planWeek, shoppingFor, usedInTime, type FridgeItem } from './plan'

/**
 * Presentationssidan. Allt på ytan räknas fram här ur exemplet i plan.ts, och motorn
 * (vendor/scrollcraft.js, oförändrad) driver akterna. Sidans egen kod är signaturrörelsen:
 * varorna som lyfter ur kylen och landar i veckans dagar, de mest brådskande först.
 */

declare global {
  interface Window {
    ScrollCraft: { mount(root: Element): { destroy(): void } }
  }
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[]
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

const today = toISODate(new Date())
const week = planWeek(today)
const shopping = shoppingFor(week)
const expires = (f: FridgeItem) => addDays(today, f.daysLeft)
const asPantry = (f: FridgeItem): PantryItem => ({ id: f.id, name: f.name, amount: f.amount, expires: expires(f), addedAt: today, source: 'manual', updatedAt: '' })
const byUrgency = [...FRIDGE].sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'sv'))
const soon = expiringWithin(FRIDGE.map(asPantry), today).length
const NUMBER_WORDS = ['Inga', 'En', 'Två', 'Tre', 'Fyra', 'Fem', 'Sex', 'Sju', 'Åtta', 'Nio', 'Tio']

/** "Idag", sedan veckodagen: Tis, Ons … */
const dayShort = (date: string) => (date === today ? 'Idag' : WEEKDAYS_SHORT[weekdayOf(date) - 1])
/** Etiketten på en vara i kylen: "imorgon", "om 2 dagar", "24 nov". */
const shortExpiry = (f: FridgeItem) =>
  f.daysLeft <= 6 ? expiryLabel(expires(f), today).replace(/^Går ut /, '') : parseISODate(expires(f)).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }).replace('.', '')
const isSoon = (f: FridgeItem) => ['today', 'soon', 'expired'].includes(expiryStatus(expires(f), today))

function chip(f: FridgeItem, cls = 'mp-chip') {
  const c = el('li', cls)
  c.append(el('span', 'mp-chip__name', f.name), el('span', `mp-chip__tag${isSoon(f) ? ' is-soon' : ''}`, shortExpiry(f)))
  return c
}

// ------------------------------------------------------------ 1 · startsidan

$('[data-mp-today]').textContent = dayLabel(today)
const strip = $('[data-mp-strip]')
for (let d = 0; d < 5; d++) {
  const date = addDays(today, d)
  const li = el('li')
  li.append(el('span', 'mp-strip__day', dayShort(date)), el('span', 'mp-strip__date num', String(parseISODate(date).getDate())), el('span', 'mp-strip__dish', '–'))
  strip.append(li)
}
$('[data-mp-home="soon"]').textContent = String(soon)
$('[data-mp-home="all"]').textContent = String(FRIDGE.length)
const heroChips = $('[data-mp-hero-chips]')
byUrgency.slice(0, 3).forEach((f) => heroChips.append(chip(f)))

// ------------------------------------------------------------- 2 · lagret

const rows = $('[data-mp-pantry]')
byUrgency.forEach((f, i) => {
  const li = el('li', 'mp-row')
  const name = el('span', 'mp-row__name', f.name)
  name.append(el('span', 'mp-row__amount', ` · ${f.amount}`))
  li.append(name, el('span', `mp-row__sub${isSoon(f) ? ' is-soon' : ''}`, expiryLabel(expires(f), today)))
  // Raderna kommer en i taget och står kvar tills akten släpper.
  const from = 0.06 + i * 0.055
  li.setAttribute('data-sc-cue', `${from.toFixed(3)} 1 ${(0.09 / (1 - from)).toFixed(3)} 0`)
  rows.append(li)
})
$('[data-mp-count="all"]').setAttribute('data-sc-count', `0 ${FRIDGE.length}`)
$('[data-mp-count="soon"]').setAttribute('data-sc-count', `0 ${soon}`)
$('[data-mp-soon-text]').textContent = `${NUMBER_WORDS[soon] ?? soon} ${soon === 1 ? 'sak går' : 'saker går'} ut inom två dagar.`

// ------------------------------------------------- 4 · kylen blir veckan

const shelf = $('[data-mp-shelf]')
const shelfChips = new Map<string, HTMLElement>()
byUrgency.forEach((f) => {
  const c = chip(f)
  c.dataset.mpItem = f.id
  shelf.append(c)
  shelfChips.set(f.id, c)
})

interface Flight { item: FridgeItem; day: number; badge: HTMLElement; from: number; to: number; source: HTMLElement; slot: HTMLElement; clone: HTMLElement; tag: HTMLElement; dx: number; dy: number; x0: number; y0: number; scale: number }
interface DayRow { row: HTMLElement; dish: HTMLElement; count: HTMLElement; landed: number; at: number; title: string; set: boolean }

const days = $('[data-mp-days]')
const flightsLayer = $('[data-mp-flights]')
const flights: Flight[] = []
const dayRows: DayRow[] = []
week.forEach((day, d) => {
  const row = el('li', `mp-day${day.date === today ? ' is-today' : ''}`)
  const date = el('div', 'mp-date')
  const count = el('span', 'mp-day__count')
  date.append(el('span', '', dayShort(day.date)), el('strong', '', String(parseISODate(day.date).getDate())), count)
  const body = el('div', 'mp-day__body')
  const dish = el('p', 'mp-day__dish is-empty', '–')
  const items = el('div', 'mp-day__items')
  const tag = dayShort(day.date).toLowerCase()
  const base = 0.08 + d * 0.1
  day.arrivals.forEach((item, i) => {
    const slot = el('span', 'mp-slot')
    slot.append(el('span', '', item.name), el('span', 'mp-chip__tag is-day', tag))
    items.append(slot)
    const clone = el('div', 'mp-chip mp-flight')
    const cloneTag = el('span', `mp-chip__tag${isSoon(item) ? ' is-soon' : ''}`, shortExpiry(item))
    clone.append(el('span', 'mp-chip__name', item.name), cloneTag)
    flightsLayer.append(clone)
    const from = base + i * 0.028
    flights.push({ item, day: d, badge: date, from, to: from + 0.1, source: shelfChips.get(item.id)!, slot, clone, tag: cloneTag, dx: 0, dy: 0, x0: 0, y0: 0, scale: 1 })
  })
  const buy = day.dish.buy.map((b) => cleanName(b.name).toLowerCase())
  items.append(el('span', 'mp-day__buy', `köp: ${buy.join(', ')}`))
  body.append(dish, items)
  row.append(date, body)
  days.append(row)
  const last = day.arrivals.length ? base + (day.arrivals.length - 1) * 0.028 + 0.09 : base + 0.05
  dayRows.push({ row, dish, count, landed: -1, at: last, title: day.dish.title, set: false })
})

const weekAct = $('[data-mp-week-act]')
const stage = $('.mp-stage--week')
const fridge = $('.mp-fridge')
const status = $('[data-mp-week-status]')
const inTime = usedInTime(week)
const doneAt = Math.max(...dayRows.map((r) => r.at)) + 0.04

/** Mäter var varje vara börjar (i kylen) och slutar (i sin dag), relativt scenen. */
function measure() {
  const s = stage.getBoundingClientRect()
  for (const f of flights) {
    const a = f.source.getBoundingClientRect()
    // På de kortaste skärmarna syns inte varorna i dagen: då landar de i datumrutan.
    const b = (f.slot.getClientRects().length ? f.slot : f.badge).getBoundingClientRect()
    f.x0 = a.left - s.left
    f.y0 = a.top - s.top
    f.dx = b.left - a.left
    f.dy = b.top - a.top
    f.scale = a.height ? b.height / a.height : 1
    f.clone.style.width = `${a.width}px`
    f.clone.style.height = `${a.height}px`
  }
}

let lastP = -1
function render(p: number) {
  if (p === lastP) return
  lastP = p
  let flown = 0
  const landed = dayRows.map(() => 0)
  for (const f of flights) {
    const t = clamp01((p - f.from) / (f.to - f.from))
    if (t <= 0) {
      f.clone.style.opacity = '0'
      f.source.classList.remove('is-gone')
      f.slot.style.opacity = '0'
      continue
    }
    f.source.classList.add('is-gone')
    if (t >= 1) {
      f.clone.style.opacity = '0'
      f.slot.style.opacity = '1'
      flown++
      landed[f.day]++
      continue
    }
    const e = ease(t)
    // En båge uppåt, mer ju längre varan flyger.
    const lift = Math.sin(Math.PI * t) * Math.min(70, Math.hypot(f.dx, f.dy) * 0.18)
    const sc = 1 + (f.scale - 1) * e + Math.sin(Math.PI * t) * 0.08
    f.clone.style.transform = `translate3d(${(f.x0 + f.dx * e).toFixed(1)}px, ${(f.y0 + f.dy * e - lift).toFixed(1)}px, 0) scale(${sc.toFixed(3)})`
    f.clone.style.opacity = t > 0.86 ? ((1 - t) / 0.14).toFixed(3) : '1'
    f.slot.style.opacity = t > 0.82 ? ((t - 0.82) / 0.18).toFixed(3) : '0'
    // Etiketten byts från när varan går ut till dagen den används, mitt i luften.
    const day = dayShort(week[f.day].date).toLowerCase()
    const label = t > 0.5 ? day : shortExpiry(f.item)
    if (f.tag.textContent !== label) {
      f.tag.textContent = label
      f.tag.className = `mp-chip__tag${t > 0.5 ? ' is-day' : isSoon(f.item) ? ' is-soon' : ''}`
    }
  }
  dayRows.forEach((r, d) => {
    if (landed[d] === r.landed) return
    r.landed = landed[d]
    r.count.textContent = landed[d] ? `+${landed[d]}` : ''
    r.count.classList.toggle('is-on', landed[d] > 0)
  })
  let set = 0
  for (const r of dayRows) {
    const on = p >= r.at
    if (on !== r.set) {
      r.set = on
      r.dish.textContent = on ? r.title : '–'
      r.dish.classList.toggle('is-empty', !on)
      r.row.classList.toggle('is-set', on)
    }
    if (on) set++
  }
  fridge.classList.toggle('is-empty', flown === flights.length)
  const text = p >= doneAt ? `${week.length} middagar · ${inTime} av ${FRIDGE.length} varor används i tid` : set ? `${set} av ${week.length} dagar planerade` : 'Planerar…'
  if (status.textContent !== text) status.textContent = text
  status.classList.toggle('is-done', p >= doneAt)
}

// ---------------------------------------------------------- 5 · listan

const messy = $('[data-mp-messy]')
for (const r of shopping.raw) {
  const li = el('li', '', `${r.name} ${r.amount}`)
  li.append(el('small', '', r.dish))
  messy.append(li)
}
const tidy = $('[data-mp-tidy]')
for (const s of shopping.sections) {
  tidy.append(el('h4', '', s.section))
  const ul = el('ul')
  for (const l of s.lines) {
    const label = el('label', 'mp-check')
    const box = el('input')
    box.type = 'checkbox'
    const text = el('span', '', l.name)
    if (l.amount) text.append(el('small', '', ` · ${l.amount}`))
    label.append(box, text)
    const li = el('li')
    li.append(label)
    ul.append(li)
  }
  tidy.append(ul)
}
// Raden ovanför listan följer avtorkningen: först hur det ser ut i recepten, sedan resultatet.
const listAct = $('#inkop')
const tidyNote = $('[data-mp-tidy-note]')
const REVEAL_DONE = 0.5
function renderList(p: number) {
  const text = p >= REVEAL_DONE ? `Städad · ${shopping.raw.length} rader blev ${shopping.count}` : `${shopping.raw.length} rader från veckans recept`
  if (tidyNote.textContent !== text) tidyNote.textContent = text
}

// ------------------------------------------------------ 6 · första steget

let portions = 2
let touched = false
const out = $('[data-mp-portions]')
const plates = $('[data-mp-plates]')
const caption = $('[data-mp-caption]')
const minus = $<HTMLButtonElement>('[data-mp-step="-1"]')
const plus = $<HTMLButtonElement>('[data-mp-step="1"]')
function showPortions(prev: number) {
  out.textContent = String(portions)
  out.setAttribute('aria-label', `${portions} ${portions === 1 ? 'portion' : 'portioner'}`)
  if (!reduce && prev !== portions) {
    out.classList.remove('is-bump')
    void out.offsetWidth
    out.classList.add('is-bump')
  }
  while (plates.children.length > portions) plates.lastElementChild!.remove()
  while (plates.children.length < portions) plates.append(el('span', `mp-plate${prev ? ' is-new' : ''}`))
  caption.textContent = portionCaption(portions)
  minus.disabled = portions <= MIN_PORTIONS
  plus.disabled = portions >= MAX_PORTIONS
}
for (const b of [minus, plus]) {
  b.addEventListener('click', () => {
    const prev = portions
    portions = Math.min(MAX_PORTIONS, Math.max(MIN_PORTIONS, portions + Number(b.dataset.mpStep)))
    touched = true
    showPortions(prev)
  })
}
showPortions(0)

// Vidare in i appen. Det som valts här följer med in i appens frågor.
const ONBOARDING = 'matplanerare-onboarding'
function readOnboarding(): { done?: boolean; answers?: Record<string, unknown> | null } | null {
  try {
    return JSON.parse(localStorage.getItem(ONBOARDING) ?? 'null')
  } catch {
    return null
  }
}
/** Inloggad på den här enheten (Supabase sparar sin inloggning under sb-…-auth-token). */
function signedIn() {
  try {
    return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
  } catch {
    return false
  }
}
// Den som redan använder appen går rakt in i den, och valen här rör inte deras inställningar.
const returning = () => Boolean(readOnboarding()?.done) || signedIn()
if (returning()) for (const a of $$('.mp-login')) a.textContent = 'Öppna appen'
for (const a of $$<HTMLAnchorElement>('[data-mp-go]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault()
    const onb = readOnboarding()
    const back = returning()
    try {
      localStorage.setItem('matplanerare-landing-seen', '1')
      if (!back && a.dataset.mpGo === 'start') {
        const answers = { diets: [], likes: [], otherLike: '', allergens: [], otherAllergy: '', ...(onb?.answers ?? {}), ...(touched ? { portions } : {}) }
        localStorage.setItem(ONBOARDING, JSON.stringify({ done: false, answers }))
      }
    } catch {
      /* utan lagring börjar appen med sina egna frågor */
    }
    location.href = back ? '/' : a.getAttribute('href')!
  })
}

// --------------------------------------------------------- flikraden

const tabs = $('[data-mp-tabs]')
const parts = $$('[data-mp-part]')
const tabLinks = $$<HTMLAnchorElement>('[data-mp-tab]')
function currentPart() {
  const y = innerHeight * 0.45
  let part = 'meny'
  for (const p of parts) if (p.getBoundingClientRect().top <= y) part = p.dataset.mpPart!
  return part
}
function syncTabs() {
  const part = currentPart()
  tabs.classList.toggle('is-away', part === 'close')
  for (const t of tabLinks) {
    if (t.dataset.mpTab === part) t.setAttribute('aria-current', 'page')
    else t.removeAttribute('aria-current')
  }
}
// En flik hoppar till sin akt, där den har hunnit visa något: lagret fyllt, veckan klar.
const TAB_AT: Record<string, number> = { lager: 0.72, meny: 0.94, inkop: 0 }
for (const t of tabLinks) {
  t.addEventListener('click', (e) => {
    const target = document.getElementById(t.getAttribute('href')!.slice(1))
    if (!target) return
    e.preventDefault()
    const top = target.getBoundingClientRect().top + scrollY
    const travel = Math.max(0, target.offsetHeight - innerHeight)
    scrollTo({ top: top + travel * (TAB_AT[t.dataset.mpTab!] ?? 0), behavior: reduce ? 'auto' : 'smooth' })
  })
}

// ------------------------------------------- startsidans djup mot pekaren

if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const scene = $('[data-mp-tilt]')
  const planes: [HTMLElement, number][] = [[$('.mp-home'), 6], [$('.mp-tonight'), 12], [$('.mp-hero__chips'), 22]]
  let frame = 0
  addEventListener('pointermove', (e) => {
    if (frame || scrollY > innerHeight) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const r = scene.getBoundingClientRect()
      const mx = clamp01((e.clientX - r.left) / r.width) - 0.5
      const my = clamp01((e.clientY - r.top) / r.height) - 0.5
      for (const [plane, px] of planes) plane.style.translate = `${(mx * px).toFixed(1)}px ${(my * px * 0.6).toFixed(1)}px`
    })
  })
}

// ---------------------------------------------------------------- start

window.ScrollCraft.mount(document.body)
measure()
render(reduce ? 1 : 0)
document.fonts?.ready.then(() => {
  measure()
  lastP = -1
})
addEventListener('resize', () => {
  measure()
  lastP = -1
})
function tick() {
  if (!reduce) render(clamp01(parseFloat(weekAct.style.getPropertyValue('--sc-p')) || 0))
  renderList(reduce ? 1 : parseFloat(listAct.style.getPropertyValue('--sc-p')) || 0)
  syncTabs()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
