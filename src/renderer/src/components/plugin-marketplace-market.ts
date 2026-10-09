import type {
  MarketCatalog,
  MarketLocalizedText,
  MarketMcpEntry,
  MarketMcpInstallPlan,
  MarketSkillEntry,
  MarketSourceInfo
} from '@shared/market/market-types'
import {
  buildMcpConfig,
  buildRemoteMcpConfig,
  type MarketplaceItem,
  type SupplyChainPermission
} from './plugin-marketplace-config'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type MarketLanguage = 'zh' | 'en'

/** Markets publish zh and en copy; every other UI language reads the English text. */
export function marketLanguage(language: string | undefined): MarketLanguage {
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function pickMarketText(text: MarketLocalizedText, language: MarketLanguage): string {
  return (language === 'zh' ? text.zh || text.en : text.en || text.zh) ?? ''
}

export function marketSourceLabel(source: MarketSourceInfo, language: MarketLanguage): string {
  return pickMarketText(source.label, language) || source.id
}

function skillDetail(entry: MarketSkillEntry): string {
  return [entry.origin?.author, entry.origin?.from, entry.version ? `v${entry.version}` : '']
    .filter(Boolean)
    .join(' · ')
}

export function marketSkillItem(
  entry: MarketSkillEntry,
  source: MarketSourceInfo,
  language: MarketLanguage
): MarketplaceItem {
  const detail = skillDetail(entry)
  return {
    id: entry.id,
    kind: 'skill',
    title: pickMarketText(entry.name, language) || entry.id,
    description: pickMarketText(entry.description, language),
    ...(detail ? { detail } : {}),
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file', 'command'] },
    market: {
      sourceId: source.id,
      sourceLabel: marketSourceLabel(source, language),
      ...(entry.version ? { version: entry.version } : {})
    }
  }
}

function mcpPermissions(entry: MarketMcpEntry): SupplyChainPermission[] {
  return [
    ...(entry.transport === 'stdio' ? (['command'] as const) : []),
    'network',
    ...(entry.requiredEnvKeys.length > 0 ? (['secret'] as const) : [])
  ]
}

export function marketMcpItem(
  entry: MarketMcpEntry,
  source: MarketSourceInfo,
  language: MarketLanguage,
  t: Translate
): MarketplaceItem {
  return {
    id: entry.id,
    kind: 'mcp',
    title: pickMarketText(entry.name, language) || entry.id,
    description: pickMarketText(entry.description, language),
    ...(entry.requiredEnvKeys.length > 0
      ? { detail: t('marketNeedsKeys', { keys: entry.requiredEnvKeys.join(', ') }) }
      : {}),
    group: 'recommended',
    supplyChain: { source: entry.transport === 'stdio' ? 'mcp' : 'remote-mcp', permissions: mcpPermissions(entry) },
    market: {
      sourceId: source.id,
      sourceLabel: marketSourceLabel(source, language),
      ...(entry.requiredEnvKeys.length > 0 ? { requiredEnvKeys: entry.requiredEnvKeys } : {})
    }
  }
}

/**
 * Catalog cards for every synced market. Ids Kun already ships or manages are
 * skipped, so a market never shows a second card for something built in.
 */
export function marketItemsFromCatalogs(
  catalogs: ReadonlyArray<{ source: MarketSourceInfo; catalog: MarketCatalog }>,
  options: { language: MarketLanguage; t: Translate; reservedIds: { skill: ReadonlySet<string>; mcp: ReadonlySet<string> } }
): MarketplaceItem[] {
  const items: MarketplaceItem[] = []
  for (const { source, catalog } of catalogs) {
    for (const entry of catalog.skills) {
      if (options.reservedIds.skill.has(entry.id)) continue
      items.push(marketSkillItem(entry, source, options.language))
    }
    for (const entry of catalog.mcpServers) {
      if (options.reservedIds.mcp.has(entry.id)) continue
      items.push(marketMcpItem(entry, source, options.language, options.t))
    }
  }
  return items
}

/** Turns the main process's pinned install plan into the config fragment Kun writes. */
export function mcpConfigFromMarketPlan(plan: MarketMcpInstallPlan): Record<string, unknown> {
  const env = Object.fromEntries(plan.requiredEnvKeys.map((key) => [key, '']))
  return plan.transport === 'remote'
    ? buildRemoteMcpConfig({ [plan.id]: plan.url })
    : buildMcpConfig(plan.id, plan.command, plan.args, { env })
}

export function marketPlanPermissions(plan: MarketMcpInstallPlan): SupplyChainPermission[] {
  return [
    ...(plan.transport === 'stdio' ? (['command'] as const) : []),
    'network',
    ...(plan.requiredEnvKeys.length > 0 ? (['secret'] as const) : [])
  ]
}

export type MarketItemSection = { sourceId: string; label: string; items: MarketplaceItem[] }

/** Groups market cards by source, keeping the sources' registration order. */
export function groupMarketItemsBySource(
  items: readonly MarketplaceItem[],
  sources: readonly MarketSourceInfo[],
  language: MarketLanguage
): MarketItemSection[] {
  return sources
    .map((source) => ({
      sourceId: source.id,
      label: marketSourceLabel(source, language),
      items: items.filter((item) => item.market?.sourceId === source.id)
    }))
    .filter((section) => section.items.length > 0)
}

export type MarketSourceFilter = 'all' | 'builtin' | string

export function matchesMarketSource(
  item: Pick<MarketplaceItem, 'market'>,
  filter: MarketSourceFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'builtin') return !item.market
  return item.market?.sourceId === filter
}
