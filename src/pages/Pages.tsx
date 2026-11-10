import { Link } from 'react-router-dom'
import { PageHead } from '../components/PageHead'
import { dayLabel, toISODate } from '../domain/dates'
import { goalKcal, mealsOn, totalsOf } from '../domain/nutrition'
import { useMeals, useNow, useSettings, useWater } from '../hooks'
import { PantryTab, RecipesTab, ShoppingTab } from './Food'
import { MealPlanTab } from './MealPlan'
import { NutritionTab } from './Nutrition'

const sv1 = (v: number) => v.toLocaleString('sv-SE', { maximumFractionDigits: 1 })

/** Dagens kost i en rad, som länk till Kost. */
function TodayRow() {
  const settings = useSettings()
  const meals = useMeals()
  const water = useWater()
  const today = toISODate(useNow())
  if (!settings || !meals || !water) return null
  const t = totalsOf(mealsOn(today, meals))
  const g = settings.nutrition
  const ml = water.find((w) => w.date === today)?.ml ?? 0
  return (
    <Link to="/kost" className="card kost-row">
      <span><strong>{t.kcal}</strong> / {goalKcal(g)} kcal</span>
      <span>protein <strong>{sv1(t.protein)}</strong> / {g.proteinG} g</span>
      <span>vatten <strong>{sv1(ml / 1000)}</strong> / {sv1(g.waterMl / 1000)} l</span>
    </Link>
  )
}

export function MenuPage() {
  const today = toISODate(useNow())
  return (
    <>
      <PageHead eyebrow={dayLabel(today)} title="Veckans meny" />
      <TodayRow />
      <MealPlanTab />
    </>
  )
}

export function RecipesPage() {
  return (
    <>
      <PageHead title="Recept" />
      <RecipesTab />
    </>
  )
}

export function PantryPage() {
  return (
    <>
      <PageHead title="Matlager" />
      <PantryTab />
    </>
  )
}

export function ShoppingPage() {
  return (
    <>
      <PageHead title="Inköpslista" />
      <ShoppingTab />
    </>
  )
}

export function NutritionPage() {
  return (
    <>
      <Link to="/" className="back">‹ Tillbaka till Meny</Link>
      <PageHead title="Kost" />
      <NutritionTab />
    </>
  )
}
