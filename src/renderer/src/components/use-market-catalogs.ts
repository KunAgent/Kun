import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SkillListItem } from '@shared/kun-gui-api'
import type { MarketCatalogResult, MarketSourceInfo } from '@shared/market/market-types'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { RECOMMENDED_ITEMS } from './plugin-marketplace-catalog'
import {
  GUI_SCHEDULE_MCP_SERVER_ID,
  type MarketplaceItem,
  type Notice
} from './plugin-marketplace-config'
import {
  groupMarketItemsBySource,
  marketItemsFromCatalogs,
  marketLanguage,
  marketPlanPermissions,
  marketSourceLabel,
  matchesMarketSource,
  mcpConfigFromMarketPlan,
  type MarketItemSection,
  type MarketSourceFilter
} from './plugin-marketplace-market'

type Translate = (key: string, values?: Record<string, unknown>) => string
type SyncedCatalog = Extract<MarketCatalogResult, { ok: true }>

const MCP_ORIGIN_STORAGE_KEY = 'kun.marketInstalledMcp'

export type MarketSyncStatus = {
  sourceId: string
  label: string
  /** Epoch ms of the last successful sync behind the data on screen. */
  fetchedAt?: number
  /** The data on screen came from the offline cache. */
  offline: boolean
  error?: string
}

function loadMcpOrigins(): Record<string, string> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(MCP_ORIGIN_STORAGE_KEY) ?? '{}') as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

function marketApi(): Window['kunGui'] | null {
  return typeof window.kunGui?.marketListSources === 'function' ? window.kunGui : null
}

/**
 * Remote market catalogs for the plugin marketplace. The main process owns
 * fetching and the disk cache; this hook paints the cache immediately, then
 * revalidates, and turns catalog entries into marketplace cards.
 */
export function useMarketCatalogs(input: {
  t: Translate
  language: string
  discoveredSkills: readonly SkillListItem[]
}) {
  const { t, discoveredSkills } = input
  const language = marketLanguage(input.language)
  const [sources, setSources] = useState<MarketSourceInfo[]>([])
  const [results, setResults] = useState<Record<string, SyncedCatalog>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [syncing, setSyncing] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<MarketSourceFilter>('all')
  const [mcpOrigins, setMcpOrigins] = useState<Record<string, string>>(() => loadMcpOrigins())
  const mounted = useRef(true)

  const load = useCallback(async (mode: 'auto' | 'refresh'): Promise<void> => {
    const api = marketApi()
    if (!api) return
    setSyncing(true)
    try {
      const list = await api.marketListSources()
      if (!mounted.current) return
      setSources(list)
      await Promise.all(list.map(async (source) => {
        if (mode === 'auto') {
          // Show whatever is cached right away; the revalidation below only
          // hits the network when that cache is older than the TTL.
          const cached = await api.marketGetCatalog({ sourceId: source.id, mode: 'cache-only' })
          if (mounted.current && cached.ok) setResults((prev) => ({ ...prev, [source.id]: cached }))
        }
        const synced = await api.marketGetCatalog({ sourceId: source.id, mode })
        if (!mounted.current) return
        if (synced.ok) {
          setResults((prev) => ({ ...prev, [source.id]: synced }))
          setErrors((prev) => {
            const rest = { ...prev }
            delete rest[source.id]
            return synced.refreshError ? { ...rest, [source.id]: synced.refreshError } : rest
          })
        } else {
          setErrors((prev) => ({ ...prev, [source.id]: synced.message }))
        }
      }))
    } catch (error) {
      if (mounted.current) setErrors((prev) => ({ ...prev, '*': error instanceof Error ? error.message : String(error) }))
    } finally {
      if (mounted.current) setSyncing(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void load('auto')
    return () => {
      mounted.current = false
    }
  }, [load])

  const sourceLabels = useMemo(
    () => new Map(sources.map((source) => [source.id, marketSourceLabel(source, language)])),
    [language, sources]
  )

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ id: source.id, label: marketSourceLabel(source, language) })),
    [language, sources]
  )

  const catalogItems = useMemo(
    () => marketItemsFromCatalogs(
      sources.flatMap((source) => results[source.id] ? [{ source, catalog: results[source.id]!.catalog }] : []),
      {
        language,
        t,
        reservedIds: {
          skill: new Set(RECOMMENDED_ITEMS.filter((item) => item.kind === 'skill').map((item) => item.id)),
          mcp: new Set([
            GUI_SCHEDULE_MCP_SERVER_ID,
            ...RECOMMENDED_ITEMS.filter((item) => item.kind === 'mcp').map((item) => item.id)
          ])
        }
      }
    ),
    [language, results, sources, t]
  )

  const skillOrigins = useMemo(
    () => new Map(discoveredSkills.flatMap((skill) => skill.market ? [[skill.id, skill.market] as const] : [])),
    [discoveredSkills]
  )

  /** Tags an installed (discovered) skill/MCP card with the market it came from. */
  const attribute = useCallback((item: MarketplaceItem): MarketplaceItem => {
    if (item.market) return item
    const origin = item.kind === 'skill'
      ? skillOrigins.get(item.id)
      : mcpOrigins[item.id] ? { sourceId: mcpOrigins[item.id] as string, version: undefined } : undefined
    const label = origin ? sourceLabels.get(origin.sourceId) : undefined
    return origin && label
      ? { ...item, market: { sourceId: origin.sourceId, sourceLabel: label, ...(origin.version ? { version: origin.version } : {}) } }
      : item
  }, [mcpOrigins, skillOrigins, sourceLabels])

  const statuses = useMemo<MarketSyncStatus[]>(() => sources.map((source) => {
    const result = results[source.id]
    return {
      sourceId: source.id,
      label: marketSourceLabel(source, language),
      ...(result ? { fetchedAt: result.catalog.fetchedAt } : {}),
      offline: Boolean(result && (result.refreshError || errors[source.id])),
      ...(errors[source.id] ? { error: errors[source.id] } : {})
    }
  }), [errors, language, results, sources])

  const split = useCallback((items: readonly MarketplaceItem[]): { plain: MarketplaceItem[]; sections: MarketItemSection[] } => ({
    plain: items.filter((item) => !item.market),
    sections: groupMarketItemsBySource(items.filter((item) => item.market), sources, language)
  }), [language, sources])

  const matchesSource = useCallback(
    (item: MarketplaceItem) => matchesMarketSource(item, sourceFilter),
    [sourceFilter]
  )

  const installSkill = useCallback(async (item: MarketplaceItem, rootPath: string): Promise<Notice & { installed: boolean }> => {
    const api = marketApi()
    if (!api || !item.market) return { tone: 'error', message: t('pluginActionFailed'), installed: false }
    const result = await api.marketInstallSkill({ sourceId: item.market.sourceId, skillId: item.id, rootPath })
    return result.ok
      ? {
          tone: 'success',
          message: t('marketSkillInstalled', { name: item.title ?? item.id, source: item.market.sourceLabel, path: result.path }),
          installed: true
        }
      : { tone: 'error', message: t('marketSkillInstallFailed', { name: item.title ?? item.id, message: result.message }), installed: false }
  }, [t])

  /** Resolves a catalog MCP card into an installable one with a pinned config. */
  const planMcpItem = useCallback(async (item: MarketplaceItem): Promise<MarketplaceItem> => {
    const api = marketApi()
    if (!api || !item.market) throw new Error(t('pluginActionFailed'))
    const result = await api.marketPlanMcpInstall({ sourceId: item.market.sourceId, serverId: item.id })
    if (!result.ok) throw new Error(t('marketMcpPlanFailed', { name: item.title ?? item.id, message: result.message }))
    const { plan } = result
    return {
      ...item,
      mcpConfig: () => mcpConfigFromMarketPlan(plan),
      supplyChain: {
        source: plan.transport === 'stdio' ? 'mcp' : 'remote-mcp',
        permissions: marketPlanPermissions(plan),
        ...(plan.transport === 'stdio' && plan.pinned ? { packageName: plan.pinned.packageName, version: plan.pinned.version } : {})
      }
    }
  }, [t])

  /** Remembers where an MCP server came from and returns a follow-up notice when it needs keys. */
  const afterMcpInstall = useCallback((item: MarketplaceItem): Notice | null => {
    if (!item.market) return null
    const requiredKeys = item.market.requiredEnvKeys ?? []
    const next = { ...mcpOrigins, [item.id]: item.market.sourceId }
    setMcpOrigins(next)
    writeBrowserStorageItem(MCP_ORIGIN_STORAGE_KEY, JSON.stringify(next))
    return requiredKeys.length > 0
      ? { tone: 'info', message: t('marketMcpNeedsKeys', { name: item.title ?? item.id, keys: requiredKeys.join(', ') }) }
      : null
  }, [mcpOrigins, t])

  return {
    sourceOptions,
    sourceFilter,
    setSourceFilter,
    syncing,
    statuses,
    refresh: () => load('refresh'),
    catalogItems,
    attribute,
    split,
    matchesSource,
    installSkill,
    planMcpItem,
    afterMcpInstall
  }
}

export type MarketCatalogsState = ReturnType<typeof useMarketCatalogs>
