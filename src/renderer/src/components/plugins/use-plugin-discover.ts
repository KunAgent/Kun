import { useCallback, useMemo } from 'react'
import type { SkillListItem } from '@shared/kun-gui-api'
import { RECOMMENDED_ITEMS } from '../plugin-marketplace-catalog'
import { mcpConfigHasServers, type MarketplaceItem, type PluginKind } from '../plugin-marketplace-config'
import { matchesMarketSource } from '../plugin-marketplace-market'
import type { MarketCatalogsState } from '../use-market-catalogs'
import type { DiscoverCardModel, DiscoverEmpty } from './PluginDiscover'
import type { RailOption, RailSync } from './PluginsRail'
import { readMcpServer, missingEnvForServer } from './mcp-server-form'
import { buildDiscoverCard, filterDiscoverItems, requiredKeysOf, type DiscoverState } from './plugin-discover'
import { compareVersions, type InstalledMcpRow } from './plugin-installed'
import { categoryLabels, categoryOptions, type CategoryOption } from './plugin-taxonomy'

type Translate = (key: string, values?: Record<string, unknown>) => string

export const KUN_PICKS = RECOMMENDED_ITEMS.filter((item) => !item.systemManaged)

function formatTime(ms: number, language: string): string {
  try {
    return new Date(ms).toLocaleString(language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(ms).toLocaleString()
  }
}

/** Everything the discover view shows for one tab, derived from catalogs and installs. */
export function usePluginDiscover(input: {
  t: Translate
  uiLanguage: string
  kind: PluginKind
  source: string
  category: string
  query: string
  market: MarketCatalogsState
  configText: string
  mcpRows: readonly InstalledMcpRow[]
  skills: readonly SkillListItem[]
}) {
  const { t, kind, source, category, query, market, configText, mcpRows, skills } = input

  const pool = useMemo(
    () => [...KUN_PICKS, ...market.catalogItems].filter((item) => item.kind === kind),
    [kind, market.catalogItems]
  )
  const labels = useMemo(
    () => categoryLabels(kind === 'mcp' ? market.taxa.mcp : market.taxa.skill, market.language, t),
    [kind, market.language, market.taxa, t]
  )
  const mcpRowIds = useMemo(() => new Set(mcpRows.filter((row) => !row.systemManaged).map((row) => row.id)), [mcpRows])
  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills])

  const stateOf = useCallback((item: MarketplaceItem): DiscoverState => {
    if (item.kind === 'mcp') {
      const ids = item.serverIds?.length ? item.serverIds : [item.id]
      const installed = mcpConfigHasServers(configText, ids) || ids.every((id) => mcpRowIds.has(id))
      if (!installed) return 'new'
      return missingEnvForServer(readMcpServer(configText, item.id), requiredKeysOf(item)).length > 0 ? 'needs-config' : 'added'
    }
    const skill = skillById.get(item.id)
    if (!skill) return 'new'
    const latest = item.market?.version
    const installed = skill.market?.version
    return item.market && skill.market?.sourceId === item.market.sourceId && latest && installed && compareVersions(latest, installed) > 0
      ? 'update'
      : 'installed'
  }, [configText, mcpRowIds, skillById])

  const sources = useMemo<RailOption[]>(() => [
    { id: 'all', label: t('pluginsSourceAll'), count: pool.length },
    { id: 'builtin', label: t('pluginsSourceKun'), count: pool.filter((item) => !item.market).length },
    ...market.sources.map((entry) => ({
      id: entry.id,
      label: market.sourceLabels.get(entry.id) ?? entry.id,
      count: pool.filter((item) => item.market?.sourceId === entry.id).length
    }))
  ], [market.sourceLabels, market.sources, pool, t])

  const sourcePool = useMemo(() => pool.filter((item) => matchesMarketSource(item, source)), [pool, source])
  const categories = useMemo<CategoryOption[]>(() => categoryOptions(sourcePool, labels), [labels, sourcePool])

  const cards = useMemo<DiscoverCardModel[]>(
    () => filterDiscoverItems(pool, { source, category, query, t })
      .map((item) => buildDiscoverCard(item, { t, state: stateOf(item), categoryLabels: labels })),
    [category, labels, pool, query, source, stateOf, t]
  )

  const sourceLabel = sources.find((option) => option.id === source)?.label ?? t('pluginsSourceAll')
  const scopeLabel = category === 'all' ? sourceLabel : `${sourceLabel} · ${labels.get(category) ?? category}`
  const status = market.statuses.find((entry) => entry.sourceId === source)
  const empty: DiscoverEmpty | null = cards.length > 0 ? null
    : status?.error && status.fetchedAt === undefined ? { kind: 'unavailable', source: status.label, message: status.error }
      : query.trim() ? { kind: 'query', query: query.trim(), scope: scopeLabel }
        : { kind: 'filter', scope: scopeLabel }
  const loading = !market.loaded && cards.length === 0 && source !== 'builtin'

  const sync = useMemo<RailSync | null>(() => {
    if (market.sources.length === 0) return null
    if (market.syncing) return { text: t('pluginsSyncing'), tone: 'muted', syncing: true }
    const failing = market.statuses.find((entry) => entry.error && entry.fetchedAt === undefined)
    if (failing) return { text: t('pluginsSyncFailed', { source: failing.label, message: failing.error }), tone: 'error', syncing: false }
    const offline = market.statuses.find((entry) => entry.offline && entry.fetchedAt !== undefined)
    if (offline) {
      return { text: t('pluginsSyncOffline', { source: offline.label, time: formatTime(offline.fetchedAt as number, input.uiLanguage) }), tone: 'warn', syncing: false }
    }
    const times = market.statuses.flatMap((entry) => (entry.fetchedAt === undefined ? [] : [entry.fetchedAt]))
    if (times.length === 0) return null
    return {
      text: t('pluginsSyncedAt', { source: market.statuses.map((entry) => entry.label).join(' · '), time: formatTime(Math.min(...times), input.uiLanguage) }),
      tone: 'muted',
      syncing: false
    }
  }, [input.uiLanguage, market.sources.length, market.statuses, market.syncing, t])

  return { pool, labels, stateOf, sources, categories, categoryTotal: sourcePool.length, cards, scopeLabel, empty, loading, sync }
}
