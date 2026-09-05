import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Download, FolderOpen, Info, Loader2, Plus, RefreshCw, Search, Settings } from 'lucide-react'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { loadPreferredSkillRootId, savePreferredSkillRootId, type SkillRootId } from '../lib/skill-root-preference'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { getProvider } from '../agent/registry'
import type { SkillListItem, SkillRootListItem } from '@shared/kun-gui-api'
import { BUILTIN_GITHUB_MCP_SERVER_ID } from '@shared/github-mcp'
import type { CoreRuntimeInfoJson, CoreRuntimeToolDiagnosticsJson } from '../agent/kun-contract'
import { useChatStore } from '../store/chat-store'
import { NoticeView, TabButton, type MarketplaceNotice } from './PluginMarketplaceParts'
import { buildMcpMarketplaceOverlay, type McpMarketplaceOverlay, type McpMarketplaceOverlayStatus } from './plugin-marketplace-runtime'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
export {
  auditMarketplaceInstall,
  auditMcpConfigSupplyChain,
  buildMcpConfig,
  buildRemoteMcpConfig,
  customMcpConfigFragment,
  googleWorkspaceMcpServerIds,
  googleWorkspaceMcpServers,
  isAllowedDocsUrl,
  isHttpsUrl,
  mcpConfigHasServer,
  mcpConfigHasServers,
  mergeMcpJsonConfig,
  setMcpServerEnabled
} from './plugin-marketplace-config'
export {
  mcpMarketplaceItemsFromConfigAndDiagnostics,
  hasUserConfiguredGitHubMcp,
  isSystemManagedMcpServerId,
  overlaySystemManagedMcpDiagnostics,
  recommendedMarketplaceItemsForMcpConfig,
  recommendedMarketplaceItemIds,
  skillMarketplaceItemsFromDiscoveredSkills,
  skillRootOptionsFromRoots,
  skillRootShortLabel
} from './plugin-marketplace-catalog'
import { GitHubMcpAuthorizationDialog } from './GitHubMcpAuthorizationDialog'
import { useGitHubMcpAuthorization } from './use-github-mcp-authorization'
import { PluginMarketplaceContent } from './PluginMarketplaceContent'
import { runtimeOverlayErrorMessage } from './PluginMarketplaceRuntimePanels'
import { RECOMMENDED_ITEMS, isSystemManagedMcpServerId, itemDescription, itemTitle, mcpMarketplaceItemsFromConfigAndDiagnostics, overlaySystemManagedMcpDiagnostics, recommendedMarketplaceItemsForMcpConfig, skillMarketplaceItemsFromDiscoveredSkills, skillNameLooksValid, skillRootOptionsFromRoots } from './plugin-marketplace-catalog'
import {
  auditMarketplaceInstall,
  auditMcpConfigSupplyChain,
  buildMcpConfig,
  buildSkillContent,
  customMcpConfigFragment,
  GUI_SCHEDULE_MCP_SERVER_ID,
  loadInstalledPlugins,
  mcpConfigHasServer,
  mcpConfigHasServers,
  mergeMcpJsonConfig,
  normalizeDisabledSkillIds,
  normalizePluginId,
  normalizeSkillId,
  saveInstalledPlugins,
  setMcpServerEnabled,
  storageKey,
  type JsonRecord,
  type MarketplaceItem,
  type Notice,
  type PluginFilter,
  type PluginKind,
  type Props,
  type SkillRootOption
} from './plugin-marketplace-config'

export function PluginMarketplaceView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = normalizeWorkspaceRoot(useChatStore((s) => s.workspaceRoot))
  const [activeKind, setActiveKind] = useState<PluginKind>('mcp')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [installed, setInstalled] = useState<string[]>(() => loadInstalledPlugins())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [githubImportOpen, setGithubImportOpen] = useState(false)
  const [githubImportUrl, setGithubImportUrl] = useState('')
  const [githubImportBusy, setGithubImportBusy] = useState(false)
  const [githubImportSummary, setGithubImportSummary] = useState<{
    count: number
    names: string[]
  } | null>(null)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [customConfig, setCustomConfig] = useState('')
  const [customSkillBody, setCustomSkillBody] = useState('')
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<CoreRuntimeToolDiagnosticsJson | null>(null)
  const [runtimeOverlayLoading, setRuntimeOverlayLoading] = useState(false)
  const [runtimeOverlayError, setRuntimeOverlayError] = useState('')
  const [mcpToggleBusyId, setMcpToggleBusyId] = useState<string | null>(null)
  const [discoveredSkills, setDiscoveredSkills] = useState<SkillListItem[]>([])
  const [skillListLoading, setSkillListLoading] = useState(false)
  const [skillListError, setSkillListError] = useState('')
  const [skillRoots, setSkillRoots] = useState<SkillRootListItem[]>([])
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([])
  const [skillToggleBusyId, setSkillToggleBusyId] = useState<string | null>(null)
  const [oauthPreviewItem, setOauthPreviewItem] = useState<MarketplaceItem | null>(null)

  const skillRootOptions = useMemo<SkillRootOption[]>(
    () => skillRootOptionsFromRoots(skillRoots, t),
    [skillRoots, t]
  )

  const selectedSkillRoot =
    skillRootOptions.find((option) => option.id === skillRootId) ??
    skillRootOptions.find((option) => option.enabled) ??
    skillRootOptions[0]

  useEffect(() => {
    if (skillRootOptions.length === 0) return
    if (skillRootOptions.some((option) => option.id === skillRootId)) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.enabled) ?? skillRootOptions[0]
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const readMcpConfig = useCallback(async (): Promise<string> => {
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return mcpConfigText
    const file = await window.kunGui.getKunConfigFile()
    setMcpConfigText(file.content)
    setMcpLoaded(true)
    return file.content
  }, [mcpConfigText])

  useEffect(() => {
    if (activeKind !== 'mcp' || mcpLoaded) return
    void readMcpConfig().catch((e) => {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    })
  }, [activeKind, mcpLoaded, readMcpConfig])

  const refreshMcpRuntimeOverlay = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.runtimeRequest !== 'function') {
      setRuntimeInfo(null)
      setToolDiagnostics(null)
      setRuntimeOverlayError(t('pluginMcpRuntimeUnavailable'))
      return
    }
    const provider = getProvider()
    if (!provider.getRuntimeInfo && !provider.getToolDiagnostics) {
      setRuntimeOverlayError(t('pluginMcpRuntimeUnavailable'))
      return
    }
    setRuntimeOverlayLoading(true)
    setRuntimeOverlayError('')
    try {
      const [runtimeResult, diagnosticsResult] = await Promise.allSettled([
        provider.getRuntimeInfo?.(),
        provider.getToolDiagnostics?.()
      ])
      if (runtimeResult.status === 'fulfilled' && runtimeResult.value) {
        setRuntimeInfo(runtimeResult.value)
      }
      if (diagnosticsResult.status === 'fulfilled' && diagnosticsResult.value) {
        setToolDiagnostics(diagnosticsResult.value)
      }
      const errors = [runtimeResult, diagnosticsResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => runtimeOverlayErrorMessage(result.reason, t('pluginMcpRuntimeUnavailable')))
      if (errors.length > 0) setRuntimeOverlayError(errors[0] ?? t('pluginActionFailed'))
    } finally {
      setRuntimeOverlayLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (activeKind !== 'mcp') return
    void refreshMcpRuntimeOverlay()
  }, [activeKind, refreshMcpRuntimeOverlay])

  const githubAuthorization = useGitHubMcpAuthorization({
    t,
    setNotice,
    refreshRuntime: refreshMcpRuntimeOverlay
  })

  const refreshSkillList = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkills !== 'function') {
      setDiscoveredSkills([])
      setSkillListError(t('pluginSkillScanUnavailable'))
      return
    }
    setSkillListLoading(true)
    setSkillListError('')
    try {
      const result = await window.kunGui.listSkills(workspaceRoot || undefined)
      if (!result.ok) {
        setDiscoveredSkills([])
        setSkillListError(result.message)
        return
      }
      setDiscoveredSkills(result.skills)
      if (result.validationErrors.length > 0) {
        setSkillListError(result.validationErrors[0]?.message ?? t('pluginSkillScanPartial'))
      }
    } catch (error) {
      setDiscoveredSkills([])
      setSkillListError(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillListLoading(false)
    }
  }, [t, workspaceRoot])

  const refreshSkillRoots = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkillRoots !== 'function') {
      setSkillRoots([])
      return
    }
    try {
      const result = await window.kunGui.listSkillRoots(workspaceRoot || undefined)
      setSkillRoots(result.ok ? result.roots : [])
    } catch {
      setSkillRoots([])
    }
  }, [workspaceRoot])

  useEffect(() => {
    if (activeKind !== 'skill') return
    void refreshSkillList()
    void refreshSkillRoots()
  }, [activeKind, refreshSkillList, refreshSkillRoots])

  useEffect(() => {
    if (activeKind !== 'skill') return
    let cancelled = false
    void rendererRuntimeClient.getSettings({ forceRefresh: true })
      .then((settings) => {
        if (!cancelled) setDisabledSkillIds(normalizeDisabledSkillIds(settings.disabledSkillIds))
      })
      .catch(() => {
        if (!cancelled) setDisabledSkillIds([])
      })
    return () => {
      cancelled = true
    }
  }, [activeKind])

  useEffect(() => {
    setNotice(null)
    setCustomOpen(false)
    setGithubImportOpen(false)
    setGithubImportSummary(null)
  }, [activeKind])

  const markInstalled = (key: string): void => {
    setInstalled((prev) => {
      const next = [...new Set([...prev, key])]
      saveInstalledPlugins(next)
      return next
    })
  }

  const discoveredSkillIds = useMemo(
    () => new Set(discoveredSkills.map((skill) => skill.id)),
    [discoveredSkills]
  )
  const discoveredSkillItems = useMemo(
    () => skillMarketplaceItemsFromDiscoveredSkills(discoveredSkills, {
      project: t('pluginSkillSourceProject'),
      global: t('pluginSkillSourceGlobal')
    }),
    [discoveredSkills, t]
  )
  const mcpRuntimeLabels = useMemo(() => ({
    configured: t('pluginMcpSourceConfigured'),
    connected: t('pluginMcpSourceConnected'),
    error: t('pluginMcpSourceError'),
    disabled: t('pluginMcpSourceDisabled')
  }), [t])
  const systemManagedGitHubMcp = useMemo(
    () => isSystemManagedMcpServerId(
      BUILTIN_GITHUB_MCP_SERVER_ID,
      mcpConfigText,
      toolDiagnostics
    ),
    [mcpConfigText, toolDiagnostics]
  )
  const discoveredMcpItems = useMemo(
    () => mcpMarketplaceItemsFromConfigAndDiagnostics(
      mcpConfigText,
      toolDiagnostics,
      mcpRuntimeLabels
    ).filter((item) => !isSystemManagedMcpServerId(item.id, mcpConfigText, toolDiagnostics)),
    [mcpConfigText, mcpRuntimeLabels, toolDiagnostics]
  )
  const discoveredMcpIds = useMemo(
    () => new Set(discoveredMcpItems.map((item) => item.id)),
    [discoveredMcpItems]
  )
  const catalogItems = useMemo(
    () => overlaySystemManagedMcpDiagnostics(
      recommendedMarketplaceItemsForMcpConfig(mcpConfigText, toolDiagnostics),
      toolDiagnostics,
      mcpRuntimeLabels
    ),
    [mcpConfigText, mcpRuntimeLabels, toolDiagnostics]
  )
  const marketplaceItems = useMemo(
    () => activeKind === 'skill'
      ? [...catalogItems, ...discoveredSkillItems]
      : [...catalogItems, ...discoveredMcpItems],
    [activeKind, catalogItems, discoveredMcpItems, discoveredSkillItems]
  )

  const isInstalled = useCallback((item: Pick<MarketplaceItem, 'kind' | 'id'> & Partial<Pick<MarketplaceItem, 'group' | 'serverIds'>>): boolean => {
    if ('group' in item && item.group === 'personal') return true
    const catalogItem = RECOMMENDED_ITEMS.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
    if (catalogItem?.systemManaged) return true
    if (item.kind === 'skill' && discoveredSkillIds.has(item.id)) return true
    if (item.kind === 'mcp' && discoveredMcpIds.has(item.id)) return true
    if (item.kind === 'mcp' && item.serverIds?.length) return mcpConfigHasServers(mcpConfigText, item.serverIds)
    const key = storageKey(item.kind, item.id)
    if (installed.includes(key)) return true
    return item.kind === 'mcp' && mcpConfigHasServer(mcpConfigText, item.id)
  }, [discoveredMcpIds, discoveredSkillIds, installed, mcpConfigText])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return marketplaceItems.filter((item) => item.kind === activeKind)
      .filter((item) => {
        const title = itemTitle(item, t).toLowerCase()
        const description = itemDescription(item, t).toLowerCase()
        const source = item.sourceLabel?.toLowerCase() ?? ''
        return !normalizedQuery ||
          title.includes(normalizedQuery) ||
          description.includes(normalizedQuery) ||
          source.includes(normalizedQuery) ||
          item.id.includes(normalizedQuery)
      })
      .filter((item) => {
        if (filter === 'recommended') return item.group === 'recommended'
        if (filter === 'installed') return isInstalled(item)
        return true
      })
  }, [activeKind, filter, isInstalled, marketplaceItems, query, t])

  const builtInItems = visibleItems.filter((item) => item.systemManaged)
  const recommendedItems = visibleItems.filter((item) => !item.systemManaged && !isInstalled(item))
  const personalItems = visibleItems.filter((item) =>
    item.group === 'personal' ||
    (!item.systemManaged && isInstalled(item) && !discoveredSkillIds.has(item.id) && !discoveredMcpIds.has(item.id))
  )
  const mcpRuntimeOverlay = useMemo(
    () => buildMcpMarketplaceOverlay({
      runtimeInfo,
      toolDiagnostics,
      managedServers: [
        { id: GUI_SCHEDULE_MCP_SERVER_ID, toolCount: 4 },
        ...(systemManagedGitHubMcp
          ? [{ id: BUILTIN_GITHUB_MCP_SERVER_ID, toolCount: 0 }]
          : [])
      ]
    }),
    [runtimeInfo, systemManagedGitHubMcp, toolDiagnostics]
  )

  const appendMcpConfig = async (id: string, config: JsonRecord): Promise<void> => {
    const content = mcpLoaded ? mcpConfigText : await readMcpConfig()
    const merged = mergeMcpJsonConfig(content, config)
    if (merged.alreadyExists) {
      markInstalled(storageKey('mcp', id))
      setNotice({ tone: 'info', message: t('pluginAlreadyAdded') })
      return
    }
    const result = await window.kunGui.setKunConfigFile(merged.text)
    setMcpConfigText(merged.text)
    setMcpLoaded(true)
    markInstalled(storageKey('mcp', id))
    setNotice({ tone: 'success', message: t('pluginMcpAdded', { path: result.path }) })
  }

  const installMcpItem = async (item: MarketplaceItem): Promise<void> => {
    if (!item.mcpConfig) return
    const audit = auditMarketplaceInstall(item, workspaceRoot)
    if (!audit.ok) throw new Error(audit.errors.join('\n'))
    await appendMcpConfig(item.id, item.mcpConfig(workspaceRoot))
  }

  const addItem = async (item: MarketplaceItem): Promise<void> => {
    if (item.id === BUILTIN_GITHUB_MCP_SERVER_ID) {
      await githubAuthorization.inspect()
      return
    }
    if (item.kind === 'mcp' && item.oauth) {
      setNotice(null)
      setOauthPreviewItem(item)
      return
    }
    setBusyId(storageKey(item.kind, item.id))
    setNotice(null)
    try {
      if (item.kind === 'mcp') {
        await installMcpItem(item)
        return
      }

      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      if (item.group === 'personal') return
      const title = itemTitle(item, t)
      const description = itemDescription(item, t)
      const content = buildSkillContent(
        item.id,
        title,
        description,
        item.skillInstructions ?? description
      )
      const result = await window.kunGui.saveSkillFile(selectedSkillRoot.path, item.id, content)
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      markInstalled(storageKey('skill', item.id))
      await Promise.all([refreshSkillList(), refreshSkillRoots()])
      setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const confirmOauthInstall = async (item: MarketplaceItem): Promise<void> => {
    setOauthPreviewItem(null)
    setBusyId(storageKey(item.kind, item.id))
    setNotice(null)
    try {
      await installMcpItem(item)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyId(null)
    }
  }

  const addCustom = async (): Promise<void> => {
    const id = normalizePluginId(customName)
    if (!id) {
      setNotice({ tone: 'error', message: t('pluginCustomNameRequired') })
      return
    }
    const description = customDescription.trim() || t('pluginCustomFallbackDesc')
    setBusyId(`custom:${activeKind}`)
    setNotice(null)
    try {
      if (activeKind === 'mcp') {
        const fallback = buildMcpConfig(
          id,
          customCommand.trim() || 'npx',
          customArgs
            .split('\n')
            .map((arg) => arg.trim())
            .filter(Boolean)
        )
        const fragment = customMcpConfigFragment(id, customConfig, fallback)
        const audit = auditMcpConfigSupplyChain(fragment)
        if (!audit.ok) throw new Error(audit.errors.join('\n'))
        await appendMcpConfig(id, fragment)
      } else {
        if (!selectedSkillRoot?.path) {
          setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
          return
        }
        const body = customSkillBody.trim() || t('pluginCustomSkillFallbackBody')
        const content = buildSkillContent(id, customName.trim() || id, description, body)
        const result = await window.kunGui.saveSkillFile(selectedSkillRoot.path, id, content)
        if (!result.ok) {
          setNotice({ tone: 'error', message: result.message })
          return
        }
        markInstalled(storageKey('skill', id))
        await Promise.all([refreshSkillList(), refreshSkillRoots()])
        setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      }
      setCustomName('')
      setCustomDescription('')
      setCustomCommand('')
      setCustomArgs('')
      setCustomConfig('')
      setCustomSkillBody('')
      setCustomOpen(false)
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const toggleSkillEnabled = async (id: string, enabled: boolean): Promise<void> => {
    const normalizedId = normalizeSkillId(id)
    if (!normalizedId) return
    setSkillToggleBusyId(normalizedId)
    setNotice(null)
    try {
      const next = enabled
        ? disabledSkillIds.filter((item) => item !== normalizedId)
        : [...new Set([...disabledSkillIds, normalizedId])]
      const settings = await rendererRuntimeClient.setSettings({ disabledSkillIds: next })
      const normalized = normalizeDisabledSkillIds(settings.disabledSkillIds)
      setDisabledSkillIds(normalized)
      useChatStore.setState({ disabledSkillIds: normalized })
      setNotice({
        tone: 'success',
        message: enabled ? t('pluginSkillEnabled') : t('pluginSkillDisabled')
      })
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSkillToggleBusyId(null)
    }
  }

  const toggleMcpEnabled = async (id: string, enabled: boolean): Promise<void> => {
    setMcpToggleBusyId(id)
    setNotice(null)
    try {
      const content = mcpLoaded ? mcpConfigText : await readMcpConfig()
      const nextText = setMcpServerEnabled(content, id, enabled)
      await window.kunGui.setKunConfigFile(nextText)
      setMcpConfigText(nextText)
      setMcpLoaded(true)
      setNotice({
        tone: 'success',
        message: enabled ? t('pluginMcpEnabled') : t('pluginMcpDisabled')
      })
      await refreshMcpRuntimeOverlay()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setMcpToggleBusyId(null)
    }
  }

  const openManageTarget = async (): Promise<void> => {
    try {
      if (activeKind === 'mcp') {
        const result = await window.kunGui.openKunConfigDir()
        if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
        return
      }
      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      const result = await window.kunGui.openSkillRoot(selectedSkillRoot.path)
      if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const addFromGitHub = async (): Promise<void> => {
    if (!selectedSkillRoot?.path) {
      setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
      return
    }
    const trimmedUrl = githubImportUrl.trim()
    if (!trimmedUrl) {
      setNotice({ tone: 'error', message: t('pluginGithubImportUrlRequired') })
      return
    }
    setGithubImportBusy(true)
    setNotice(null)
    setGithubImportSummary(null)
    try {
      const result = await window.kunGui.importSkillsFromGitHub(selectedSkillRoot.path, trimmedUrl)
      if (!result.ok) {
        throw new Error(result.message)
      }
      await Promise.all([refreshSkillList(), refreshSkillRoots()])
      setGithubImportSummary({
        count: result.count,
        names: result.names
      })
      setNotice({ tone: 'success', message: t('pluginGithubImportSuccess', { count: result.count }) })
      setGithubImportUrl('')
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setGithubImportBusy(false)
    }
  }

  return (
    <>
      <PluginMarketplaceContent
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={onToggleLeftSidebar}
      t={t}
      activeKind={activeKind}
      setActiveKind={setActiveKind}
      query={query}
      setQuery={setQuery}
      filter={filter}
      setFilter={setFilter}
      customOpen={customOpen}
      setCustomOpen={setCustomOpen}
      githubImportOpen={githubImportOpen}
      setGithubImportOpen={setGithubImportOpen}
      selectedSkillRoot={selectedSkillRoot}
      skillRootOptions={skillRootOptions}
      setSkillRootId={setSkillRootId}
      openManageTarget={openManageTarget}
      refreshSkillList={refreshSkillList}
      refreshSkillRoots={refreshSkillRoots}
      skillListLoading={skillListLoading}
      skillListError={skillListError}
      discoveredSkills={discoveredSkills}
      disabledSkillIds={disabledSkillIds}
      mcpRuntimeOverlay={mcpRuntimeOverlay}
      runtimeOverlayLoading={runtimeOverlayLoading}
      runtimeOverlayError={runtimeOverlayError}
      refreshMcpRuntimeOverlay={refreshMcpRuntimeOverlay}
      customName={customName}
      setCustomName={setCustomName}
      customDescription={customDescription}
      setCustomDescription={setCustomDescription}
      customCommand={customCommand}
      setCustomCommand={setCustomCommand}
      customArgs={customArgs}
      setCustomArgs={setCustomArgs}
      customConfig={customConfig}
      setCustomConfig={setCustomConfig}
      customSkillBody={customSkillBody}
      setCustomSkillBody={setCustomSkillBody}
      busyId={busyId}
      addCustom={addCustom}
      githubImportUrl={githubImportUrl}
      setGithubImportUrl={setGithubImportUrl}
      githubImportBusy={githubImportBusy}
      githubImportSummary={githubImportSummary}
      addFromGitHub={addFromGitHub}
      notice={notice}
      oauthPreviewItem={oauthPreviewItem}
      setOauthPreviewItem={setOauthPreviewItem}
      confirmOauthInstall={confirmOauthInstall}
      builtInItems={builtInItems}
      recommendedItems={recommendedItems}
      personalItems={personalItems}
      isInstalled={isInstalled}
      addItem={addItem}
      skillToggleBusyId={skillToggleBusyId}
      toggleSkillEnabled={toggleSkillEnabled}
      mcpConfigText={mcpConfigText}
      mcpToggleBusyId={mcpToggleBusyId}
      toggleMcpEnabled={toggleMcpEnabled}
      />
      <GitHubMcpAuthorizationDialog
        preflight={githubAuthorization.preflight ?? undefined}
        busy={githubAuthorization.busy}
        onCancel={githubAuthorization.close}
        onBind={(host) => void githubAuthorization.bind(host)}
        onDisable={() => void githubAuthorization.disable()}
        onConfirm={(input) => void githubAuthorization.confirm(input)}
        t={t}
      />
    </>
  )
}
