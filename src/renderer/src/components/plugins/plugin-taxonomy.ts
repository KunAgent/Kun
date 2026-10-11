import type { MarketTaxon } from '@shared/market/market-types'
import { pickMarketText, type MarketLanguage } from '../plugin-marketplace-market'
import type { MarketplaceItem } from '../plugin-marketplace-config'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type CategoryOption = { id: string; label: string; count: number }

/**
 * Labels for the categories Kun's own picks use, so the rail still reads well
 * before any market has synced. Market taxa override these when present.
 */
const BUILTIN_CATEGORY_KEYS: Record<string, string> = {
  search: 'pluginsCatSearch',
  developer: 'pluginsCatDeveloper',
  productivity: 'pluginsCatProductivity',
  browser: 'pluginsCatBrowser',
  development: 'pluginsCatDevelopment',
  document: 'pluginsCatDocument'
}

export function categoryLabels(
  taxa: readonly MarketTaxon[],
  language: MarketLanguage,
  t: Translate
): Map<string, string> {
  const labels = new Map<string, string>()
  for (const [id, key] of Object.entries(BUILTIN_CATEGORY_KEYS)) labels.set(id, t(key))
  for (const taxon of taxa) {
    const label = pickMarketText(taxon.name, language)
    if (label) labels.set(taxon.id, label)
  }
  return labels
}

/** Categories present in `items`, most populated first; ids without a label fall back to the id. */
export function categoryOptions(
  items: readonly Pick<MarketplaceItem, 'categories'>[],
  labels: ReadonlyMap<string, string>
): CategoryOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const id of new Set(item.categories ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: labels.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function matchesCategory(item: Pick<MarketplaceItem, 'categories'>, category: string): boolean {
  return category === 'all' || (item.categories ?? []).includes(category)
}

/** Case-insensitive match over the text a user can see on a card, plus the id. */
export function matchesQuery(text: readonly (string | undefined)[], query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return text.some((value) => value?.toLowerCase().includes(needle))
}
