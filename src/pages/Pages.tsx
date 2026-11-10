import { Link } from 'react-router-dom'
import { PageHead } from '../components/PageHead'
import { dayLabel, toISODate } from '../domain/dates'
import { useNow } from '../hooks'
import { PantryTab, RecipesTab, ShoppingTab } from './Food'
import { Dashboard } from './Dashboard'
import { MealPlanTab } from './MealPlan'
import { NutritionTab } from './Nutrition'

export function MenuPage() {
  const today = toISODate(useNow())
  return (
    <>
      <PageHead eyebrow={dayLabel(today)} title="Matplaneraren" />
      <Dashboard />
      <div id="planera" />
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
