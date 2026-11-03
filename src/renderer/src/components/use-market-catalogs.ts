import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MarketCatalogResult,
  MarketMcpEntry,
  MarketMcpInstallPlan,
  MarketSourceInfo,
  MarketTaxon
} from '@shared/market/market-types'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { RECOMMENDED_ITEMS } from './plugin-marketplace-catalog'
import { GUI_SCHEDULE_MCP_SERVER_ID, type MarketplaceItem } from './plugin-marketplace-config'
import {
  marketItemsFromCatalogs,
  marketLanguage,
  marketSourceLabel,
  pickMarketText
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

function mergeTaxa(lists: readonly MarketTaxon[][]): MarketTaxon[] {
  const seen = new Map<string, MarketTaxon>()
  for (const list of lists) for (const taxon of list) if (!seen.has(taxon.id)) seen.set(taxon.id, taxon)
  return [...seen.values()]
}

/**
 * Remote market catalogs for the plugin marketplace. The main process owns
 * fetching and the disk cache; this hook paints the cache immediately, then
 * revalidates, and exposes cards, taxonomies and install actions.
 */
export function useMarketCatalogs(input: { t: Translate; language: string }) {
  const { t } = input
  const language = marketLanguage(input.language)
  const [sources, setSources] = useState<MarketSourceInfo[]>([])
  const [results, setResults] = useState<Record<string, SyncedCatalog>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [syncing, setSyncing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [mcpOrigins, setMcpOrigins] = useState<Record<string, string>>(() => loadMcpOrigins())
  const mounted = useRef(true)

  const load = useCallback(async (mode: 'auto' | 'refresh'): Promise<void> => {
    const api = marketApi()
    if (!api) {
      setLoaded(true)
      return
    }
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
      if (mounted.current) {
        setSyncing(false)
        setLoaded(true)
      }
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

  const synced = useMemo(
    () => sources.flatMap((source) => results[source.id] ? [{ source, catalog: results[source.id]!.catalog }] : []),
    [results, sources]
  )

  const catalogItems = useMemo(
    () => marketItemsFromCatalogs(synced, {
      language,
      reservedIds: {
        skill: new Set(RECOMMENDED_ITEMS.filter((item) => item.kind === 'skill').map((item) => item.id)),
        mcp: new Set([
          GUI_SCHEDULE_MCP_SERVER_ID,
          ...RECOMMENDED_ITEMS.filter((item) => item.kind === 'mcp').map((item) => item.id)
        ])
      }
    }),
    [language, synced]
  )

  const taxa = useMemo(() => ({
    mcp: mergeTaxa(synced.map(({ catalog }) => catalog.mcpCategories)),
    skill: mergeTaxa(synced.map(({ catalog }) => catalog.skillTags))
  }), [synced])

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

  /** The catalog entry an installed MCP server came from, when Kun remembers its market. */
  const mcpOrigin = useCallback((serverId: string): {
    sourceId: string
    label: string
    entry?: MarketMcpEntry
  } | undefined => {
    const sourceId = mcpOrigins[serverId]
    const label = sourceId ? sourceLabels.get(sourceId) : undefined
    if (!sourceId || !label) return undefined
    const entry = results[sourceId]?.catalog.mcpServers.find((server) => server.id === serverId)
    return { sourceId, label, ...(entry ? { entry } : {}) }
  }, [mcpOrigins, results, sourceLabels])

  const mcpOriginInfo = useCallback((serverId: string) => {
    const origin = mcpOrigin(serverId)
    if (!origin) return undefined
    return {
      sourceId: origin.sourceId,
      label: origin.label,
      requiredEnvKeys: origin.entry?.requiredEnvKeys ?? [],
      ...(origin.entry ? {
        title: pickMarketText(origin.entry.name, language),
        description: pickMarketText(origin.entry.description, language)
      } : {})
    }
  }, [language, mcpOrigin])

  const latestSkillVersion = useCallback((sourceId: string, skillId: string): string | undefined =>
    results[sourceId]?.catalog.skills.find((skill) => skill.id === skillId)?.version,
  [results])

  const installSkill = useCallback(async (
    item: Pick<MarketplaceItem, 'id' | 'title' | 'market'>,
    rootPath: string,
    overwrite = false
  ): Promise<{ ok: true; path: string } | { ok: false; message: string }> => {
    const api = marketApi()
    if (!api || !item.market) return { ok: false, message: t('pluginActionFailed') }
    const result = await api.marketInstallSkill({ sourceId: item.market.sourceId, skillId: item.id, rootPath, overwrite })
    return result.ok
      ? { ok: true, path: result.path }
      : { ok: false, message: t('marketSkillInstallFailed', { name: item.title ?? item.id, message: result.message }) }
  }, [t])

  /** Asks the main process to resolve and pin the server's version. */
  const planMcp = useCallback(async (item: Pick<MarketplaceItem, 'id' | 'title' | 'market'>): Promise<MarketMcpInstallPlan> => {
    const api = marketApi()
    if (!api || !item.market) throw new Error(t('pluginActionFailed'))
    const result = await api.marketPlanMcpInstall({ sourceId: item.market.sourceId, serverId: item.id })
    if (!result.ok) throw new Error(t('marketMcpPlanFailed', { name: item.title ?? item.id, message: result.message }))
    return result.plan
  }, [t])

  const setMcpOrigin = useCallback((serverId: string, sourceId: string | null): void => {
    setMcpOrigins((prev) => {
      const next = { ...prev }
      if (sourceId) next[serverId] = sourceId
      else delete next[serverId]
      writeBrowserStorageItem(MCP_ORIGIN_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return {
    sources,
    sourceLabels,
    syncing,
    loaded,
    statuses,
    refresh: () => load('refresh'),
    catalogItems,
    taxa,
    language,
    mcpOriginInfo,
    latestSkillVersion,
    installSkill,
    planMcp,
    setMcpOrigin
  }
}

export type MarketCatalogsState = ReturnType<typeof useMarketCatalogs>
