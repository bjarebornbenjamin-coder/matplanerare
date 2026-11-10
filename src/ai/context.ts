import { db } from '../db/db'
import { getSettings } from '../db/repo'
import type { ToolContext } from './tools'

export async function loadToolContext(): Promise<ToolContext> {
  const [settings, pantry, shopping, water, mealPlan, sides] = await Promise.all([
    getSettings(),
    db.pantry.toArray(),
    db.shopping.toArray(),
    db.water.toArray(),
    db.mealPlan.toArray(),
    db.sides.toArray(),
  ])
  return { settings, pantry, shopping, water, mealPlan, sides }
}
