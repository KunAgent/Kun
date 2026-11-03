import {KUN_WARDROBE_RULES,rollKunWardrobeDrop} from './wardrobe-simulator.js'
import {kunWardrobeLocalDate,type KunWardrobe} from '../contracts/kun-wardrobe.js'
/** Debug only: rolls guaranteed bottles onto the shelf, then leaves today's counters untouched. */
export function seedWardrobeBottles(wardrobe: KunWardrobe, count: number, now = new Date()): KunWardrobe {
  let next = wardrobe
  for (let index = 0; index < count; index++) {
    const forced = { ...next, daily: { date: 'seed', drops: 0 }, pity: { ...next.pity, sinceDrop: KUN_WARDROBE_RULES.pity, lastCountedAt: null } }
    const rolled = rollKunWardrobeDrop(forced, { runId: `seed-${index + 1}`, source: 'code', sourceLabel: 'Debug shelf',
      now: new Date(now.getTime() - (count - index) * 60_000) })
    next = rolled.wardrobe
  }
  return { ...next, pending: next.pending.map((drop) => ({ ...drop, stashedAt: now.toISOString() })),
    daily: { date: kunWardrobeLocalDate(now), drops: 0 }, pity: { sinceDrop: 0, sinceEpic: 0, lastCountedAt: null } }
}
