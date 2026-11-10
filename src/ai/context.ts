import { db } from '../db/db'
import { getSettings } from '../db/repo'
import type { ToolContext } from './tools'

export async function loadToolContext(): Promise<ToolContext> {
  const [settings, pantry, shopping, meals, water, mealPlan] = await Promise.all([
    getSettings(),
    db.pantry.toArray(),
    db.shopping.toArray(),
    db.meals.toArray(),
    db.water.toArray(),
    db.mealPlan.toArray(),
  ])
  return { settings, pantry, shopping, meals, water, mealPlan }
}
