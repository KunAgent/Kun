import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, FolderOpen, Plus, Search, Settings } from 'lucide-react'
import { BUILTIN_GITHUB_MCP_SERVER_ID } from '@shared/github-mcp'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useChatStore } from '../store/chat-store'
export {
  auditMarketplaceInstall,
  auditMcpConfigSupplyChain,
  buildMcpConfig,
  buildRemoteMcpConfig,
  customMcpConfigFragment,
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
import { OAuthConnectorPreviewDialog } from './PluginMarketplaceItemPanels'
import { useGitHubSkillImport } from './use-github-skill-import'
import { useMarketCatalogs } from './use-market-catalogs'
import { useGitHubMcpAuthorization } from './use-github-mcp-authorization'
import { RECOMMENDED_ITEMS, itemDescription, itemTitle, isSystemManagedMcpServerId, skillRootShortLabel } from './plugin-marketplace-catalog'
import {
  auditMcpConfigSupplyChain,
  buildMcpConfig,
  buildSkillContent,
  customMcpConfigFragment,
  mergeMcpJsonConfig,
  normalizePluginId,
  type MarketplaceItem,
  type PluginKind,
  type Props
} from './plugin-marketplace-config'
import { PluginsPage } from './plugins/PluginsPage'
import { PluginsRail } from './plugins/PluginsRail'
import { PluginDiscover, type DiscoverCardModel } from './plugins/PluginDiscover'
import { PluginDetailDrawer } from './plugins/PluginDetailDrawer'
import { McpConfigSheet } from './plugins/McpConfigSheet'
import { PluginsInstalledMcp, type McpSummary } from './plugins/PluginsInstalledMcp'
import { PluginsInstalledSkills } from './plugins/PluginsInstalledSkills'
import { ConfirmDialog, PluginToast, type PluginToastState } from './plugins/PluginDialogs'
import { CustomPluginSheet, GitHubImportSheet, type CustomPluginFields } from './plugins/PluginCustomSheets'
import { pluginButton } from './plugins/PluginPrimitives'
import { paginate } from './plugins/plugin-pagination'
import { buildPluginDetail } from './plugins/plugin-discover'
import { buildInstalledMcpRows, buildInstalledSkillRows, type InstalledSkillRow } from './plugins/plugin-installed'
import { usePluginMcp } from './plugins/use-plugin-mcp'
import { usePluginSkills } from './plugins/use-plugin-skills'
import { KUN_PICKS, usePluginDiscover } from './plugins/use-plugin-discover'
import { usePluginMcpActions } from './plugins/use-plugin-mcp-actions'

type PluginView = 'installed' | 'discover'
const VIEW_STORAGE_KEY = 'kun.plugins.view'

function loadViews(): Record<PluginKind, PluginView> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(VIEW_STORAGE_KEY) ?? '{}') as Partial<Record<PluginKind, PluginView>>
    return { mcp: parsed.mcp === 'installed' ? 'installed' : 'discover', skill: parsed.skill === 'installed' ? 'installed' : 'discover' }
  } catch {
    return { mcp: 'discover', skill: 'discover' }
  }
}

function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PluginMarketplaceView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = normalizeWorkspaceRoot(useChatStore((s) => s.workspaceRoot))
  const [kind, setKind] = useState<PluginKind>('mcp')
  const [views, setViews] = useState<Record<PluginKind, PluginView>>(() => loadViews())
  const view = views[kind]
  const [source, setSource] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [location, setLocation] = useState('all')
  const [toast, setToast] = useState<PluginToastState | null>(null)
  const [detailItem, setDetailItem] = useState<MarketplaceItem | null>(null)
  const [skillBusyKey, setSkillBusyKey] = useState<string | null>(null)
  const [skillUpdatingId, setSkillUpdatingId] = useState<string | null>(null)
  const [customKind, setCustomKind] = useState<PluginKind | null>(null)
  const [customBusy, setCustomBusy] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const notify = useCallback((next: PluginToastState | null) => setToast(next), [])
  const dismissToast = useCallback(() => setToast(null), [])
  const mcp = usePluginMcp({ t, active: kind === 'mcp' })
  const skills = usePluginSkills({ t, workspaceRoot, active: kind === 'skill' })
  const market = useMarketCatalogs({ t, language: i18n.language })
  const github = useGitHubSkillImport({ t, skillRootPath: skills.selectedRoot?.path, setNotice: notify, refreshSkills: skills.refresh })
  const githubAuthorization = useGitHubMcpAuthorization({ t, setNotice: notify, refreshRuntime: mcp.refreshOverlay })

  useEffect(() => setPageNumber(1), [kind, source, category, query])
  useEffect(() => setCategory('all'), [kind, source])
  useEffect(() => {
    setDetailItem(null)
    setQuery('')
    setAddMenuOpen(false)
  }, [kind])

  const setView = (next: PluginView): void => {
    setViews((prev) => {
      const updated = { ...prev, [kind]: next }
      writeBrowserStorageItem(VIEW_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  const builtinMcpItems = useMemo(() => RECOMMENDED_ITEMS.filter((item) =>
    item.kind === 'mcp' && item.systemManaged &&
    (item.id !== BUILTIN_GITHUB_MCP_SERVER_ID || isSystemManagedMcpServerId(item.id, mcp.configText, mcp.diagnostics))
  ), [mcp.configText, mcp.diagnostics])
  const mcpRows = useMemo(() => buildInstalledMcpRows({
    configText: mcp.configText,
    diagnostics: mcp.diagnostics,
    builtins: builtinMcpItems,
    kunPicks: KUN_PICKS.filter((item) => item.kind === 'mcp'),
    market: market.mcpOriginInfo,
    translate: (item) => ({ title: itemTitle(item, t), description: itemDescription(item, t) })
  }), [builtinMcpItems, market.mcpOriginInfo, mcp.configText, mcp.diagnostics, t])
  const skillRows = useMemo(() => buildInstalledSkillRows({
    skills: skills.skills,
    disabledIds: skills.disabledIds,
    marketLabel: (id) => market.sourceLabels.get(id),
    latestVersion: market.latestSkillVersion
  }), [market.latestSkillVersion, market.sourceLabels, skills.disabledIds, skills.skills])

  const discover = usePluginDiscover({
    t, uiLanguage: i18n.language, kind, source, category, query, market,
    configText: mcp.configText, mcpRows, skills: skills.skills
  })
  const actions = usePluginMcpActions({
    t, workspaceRoot, mcp, market, rows: mcpRows, notify,
    inspectGithub: githubAuthorization.inspect
  })

  const mcpSummary: McpSummary = {
    services: mcpRows.length,
    connected: mcpRows.filter((row) => row.status === 'connected').length,
    tools: mcpRows.reduce((sum, row) => sum + (row.toolCount ?? 0), 0),
    attention: mcpRows.filter((row) => row.group === 'attention').length,
    runtimeAvailable: Boolean(mcp.runtimeInfo || mcp.diagnostics),
    loading: mcp.overlayLoading
  }
  const skillUpdates = skillRows.filter((row) => row.canUpdate).length
  const installedBadge = kind === 'mcp'
    ? (mcpSummary.attention > 0 ? { tone: 'warn' as const, label: t('pluginsNeedsConfigCount', { count: mcpSummary.attention }) } : undefined)
    : (skillUpdates > 0 ? { tone: 'kun' as const, label: t('pluginsUpdatesCount', { count: skillUpdates }) } : undefined)

  const groupLabel = useCallback((rootPath: string, readOnly: boolean): string => {
    if (readOnly) return t('pluginsSkillReadOnly')
    const option = skills.rootOptions.find((entry) => comparablePath(entry.path) === comparablePath(rootPath))
    const short = skillRootShortLabel(rootPath)
    return option && option.label !== short ? `${option.label} · ${short}` : short
  }, [skills.rootOptions, t])
  const locations = useMemo(() => {
    const groups = new Map<string, { label: string; count: number }>()
    for (const row of skillRows) {
      const id = row.readOnly ? '__builtin' : comparablePath(row.rootPath)
      const entry = groups.get(id) ?? { label: groupLabel(row.rootPath, row.readOnly), count: 0 }
      entry.count += 1
      groups.set(id, entry)
    }
    return [{ id: 'all', label: t('pluginsLocationAll'), count: skillRows.length }, ...[...groups].map(([id, entry]) => ({ id, ...entry }))]
  }, [groupLabel, skillRows, t])
  const visibleSkillRows = location === 'all' ? skillRows
    : skillRows.filter((row) => (row.readOnly ? '__builtin' : comparablePath(row.rootPath)) === location)

  const installSkill = async (item: MarketplaceItem, busyKey: string): Promise<void> => {
    const root = skills.selectedRoot?.path
    if (!root) {
      notify({ tone: 'error', message: t('pluginSkillRootMissing') })
      return
    }
    setSkillBusyKey(busyKey)
    try {
      const title = itemTitle(item, t)
      if (item.market) {
        const result = await market.installSkill(item, root)
        if (!result.ok) throw new Error(result.message)
        notify({ tone: 'success', message: t('marketSkillInstalled', { name: title, source: item.market.sourceLabel, path: result.path }) })
      } else {
        const content = buildSkillContent(item.id, title, itemDescription(item, t), item.skillInstructions ?? itemDescription(item, t))
        const result = await window.kunGui.saveSkillFile(root, item.id, content)
        if (!result.ok) throw new Error(result.message)
        notify({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      }
      await skills.refresh()
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    } finally {
      setSkillBusyKey(null)
    }
  }

  const updateSkill = async (row: InstalledSkillRow, quiet = false): Promise<boolean> => {
    if (!row.market) return false
    const result = await market.installSkill({ id: row.id, title: row.name, market: { sourceId: row.market.sourceId, sourceLabel: row.market.label } }, row.rootPath, true)
    if (!result.ok) {
      notify({ tone: 'error', message: result.message })
      return false
    }
    if (!quiet) notify({ tone: 'success', message: t('pluginsSkillUpdated', { name: row.name }) })
    return true
  }

  const discoverAction = (item: MarketplaceItem, key: string): void => {
    const state = discover.stateOf(item)
    if (item.kind === 'mcp') {
      if (state === 'new') void actions.startInstall(item, key)
      else actions.openEdit(item.id)
      return
    }
    if (state === 'new') void installSkill(item, key)
    else if (state === 'update') {
      const row = skillRows.find((entry) => entry.id === item.id)
      if (row) {
        setSkillBusyKey(key)
        void updateSkill(row).then(() => skills.refresh()).finally(() => setSkillBusyKey(null))
      }
    }
  }

  const addCustom = async (customKindValue: PluginKind, fields: CustomPluginFields): Promise<boolean> => {
    const id = normalizePluginId(fields.name)
    if (!id) {
      notify({ tone: 'error', message: t('pluginCustomNameRequired') })
      return false
    }
    setCustomBusy(true)
    try {
      if (customKindValue === 'mcp') {
        const fallback = buildMcpConfig(id, fields.command.trim() || 'npx', fields.args.split('\n').map((arg) => arg.trim()).filter(Boolean))
        const fragment = customMcpConfigFragment(id, fields.config, fallback)
        const audit = auditMcpConfigSupplyChain(fragment)
        if (!audit.ok) throw new Error(audit.errors.join('\n'))
        const currentText = await mcp.current()
        const merged = mergeMcpJsonConfig(currentText, fragment)
        if (merged.alreadyExists) throw new Error(t('pluginAlreadyAdded'))
        const result = await mcp.write(merged.text, currentText)
        notify({ tone: 'success', message: t('pluginMcpAdded', { path: result.path }) })
        void mcp.refreshOverlay()
      } else {
        const root = skills.selectedRoot?.path
        if (!root) throw new Error(t('pluginSkillRootMissing'))
        const description = fields.description.trim() || t('pluginCustomFallbackDesc')
        const body = fields.skillBody.trim() || t('pluginCustomSkillFallbackBody')
        const result = await window.kunGui.saveSkillFile(root, id, buildSkillContent(id, fields.name.trim() || id, description, body))
        if (!result.ok) throw new Error(result.message)
        await skills.refresh()
        notify({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      }
      setCustomKind(null)
      return true
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
      return false
    } finally {
      setCustomBusy(false)
    }
  }

  const openPath = async (open: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    try {
      const result = await open()
      if (!result.ok) notify({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error) })
    }
  }

  const headerActions = kind === 'mcp' ? (
    <>
      <button type="button" className={pluginButton.base} onClick={() => void openPath(() => window.kunGui.openKunConfigDir())}>
        <Settings className="h-4 w-4" strokeWidth={1.8} />
        {t('pluginsOpenConfig')}
      </button>
      <button type="button" className={pluginButton.dark} onClick={() => setCustomKind('mcp')}>
        <Plus className="h-4 w-4" strokeWidth={2.2} />
        {t('pluginsAddCustomMcp')}
      </button>
    </>
  ) : (
    <>
      <button type="button" className={pluginButton.base} disabled={!skills.selectedRoot} onClick={() => skills.selectedRoot && void openPath(() => window.kunGui.openSkillRoot(skills.selectedRoot!.path))}>
        <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
        {t('pluginsOpenSkillFolder')}
      </button>
      <div className="relative">
        <button type="button" className={pluginButton.dark} aria-haspopup="menu" aria-expanded={addMenuOpen} onClick={() => setAddMenuOpen((open) => !open)}>
          <Plus className="h-4 w-4" strokeWidth={2.2} />
          {t('pluginsAddSkill')}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {addMenuOpen ? (
          <>
            <div className="fixed inset-0 z-10" onMouseDown={() => setAddMenuOpen(false)} />
            <div role="menu" className="absolute right-0 top-11 z-20 w-[200px] rounded-xl border border-ds-border bg-ds-card p-1 shadow-[0_18px_48px_rgba(32,55,90,0.14)]">
              <button type="button" role="menuitem" className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-ds-ink hover:bg-ds-subtle" onClick={() => { setAddMenuOpen(false); setCustomKind('skill') }}>{t('pluginsNewSkill')}</button>
              <button type="button" role="menuitem" className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-ds-ink hover:bg-ds-subtle" onClick={() => { setAddMenuOpen(false); setGithubOpen(true) }}>{t('pluginsImportGithub')}</button>
            </div>
          </>
        ) : null}
      </div>
    </>
  )

  const renderDiscover = (compact: boolean): ReactElement => {
    const pageSize = compact ? 8 : kind === 'mcp' ? 9 : 12
    const page = paginate(discover.cards, pageNumber, pageSize)
    const toolbar = (
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] min-w-0 flex-[1_1_240px] items-center gap-2 rounded-[11px] border border-ds-border bg-ds-card px-3 text-ds-muted focus-within:border-[#6f8bff]">
          <Search className="h-4 w-4 shrink-0" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'mcp' ? t('pluginsSearchMcp') : t('pluginsSearchSkill')} aria-label={kind === 'mcp' ? t('pluginsSearchMcp') : t('pluginsSearchSkill')} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ds-ink outline-none focus-visible:outline-none" />
        </label>
        {kind === 'skill' ? (
          <label className="flex h-[38px] min-w-0 items-center gap-2 rounded-[11px] border border-ds-border bg-ds-card px-3 text-[12.5px]">
            <span className="shrink-0 text-ds-muted">{t('pluginsInstallTarget')}</span>
            <select value={skills.selectedRoot?.id ?? ''} disabled={skills.rootOptions.length === 0} onChange={(event) => skills.setRootId(event.target.value)} aria-label={t('pluginsInstallTarget')} className="min-w-0 max-w-[260px] border-0 bg-transparent font-semibold text-ds-ink outline-none focus-visible:outline-none">
              {skills.rootOptions.length === 0 ? <option value="">{t('pluginSkillRootNone')}</option> : skills.rootOptions.map((option) => {
                const short = skillRootShortLabel(option.path)
                return <option key={option.id} value={option.id}>{option.label === short ? short : `${option.label} · ${short}`}</option>
              })}
            </select>
          </label>
        ) : null}
      </div>
    )
    const busyKey = kind === 'mcp' ? actions.busyKey : skillBusyKey
    return (
      <PluginDiscover
        t={t}
        toolbar={toolbar}
        scopeLabel={discover.scopeLabel}
        page={page}
        pageSize={pageSize}
        compact={compact}
        loading={discover.loading}
        empty={discover.empty}
        busyKey={busyKey}
        onPage={setPageNumber}
        onOpen={(card: DiscoverCardModel) => setDetailItem(card.item)}
        onAction={(card: DiscoverCardModel) => discoverAction(card.item, card.key)}
        onClearFilters={() => { setQuery(''); setCategory('all'); setSource('all') }}
        onOnlyKun={() => setSource('builtin')}
        onRetry={() => void market.refresh()}
      />
    )
  }

  const renderMain = (compact: boolean): ReactElement => {
    if (view === 'discover') return renderDiscover(compact)
    if (kind === 'mcp') {
      return (
        <PluginsInstalledMcp
          t={t}
          rows={mcpRows}
          summary={mcpSummary}
          toggleBusyId={actions.toggleBusyId}
          onRefreshStatus={() => void mcp.refreshOverlay()}
          onToggle={(row, enabled) => void actions.toggle(row, enabled)}
          onConfigure={(row) => actions.openEdit(row.id)}
          onDelete={(row) => actions.setConfirmRow(row)}
          onCopy={(row) => void actions.copy(row)}
          onManageBuiltin={() => void githubAuthorization.inspect()}
          onDiscover={() => setView('discover')}
        />
      )
    }
    return (
      <PluginsInstalledSkills
        t={t}
        rows={visibleSkillRows}
        groupLabel={groupLabel}
        loading={skills.loading}
        error={skills.error}
        toggleBusyId={skills.toggleBusyId}
        updatingId={skillUpdatingId}
        onRefresh={() => void skills.refresh()}
        onToggle={(row, enabled) => {
          void skills.setEnabled(row.id, enabled)
            .then(() => notify({ tone: 'success', message: enabled ? t('pluginSkillEnabled') : t('pluginSkillDisabled') }))
            .catch((error: unknown) => notify({ tone: 'error', message: errorMessage(error) }))
        }}
        onUpdate={(row) => {
          setSkillUpdatingId(row.id)
          void updateSkill(row).then(() => skills.refresh()).finally(() => setSkillUpdatingId(null))
        }}
        onUpdateAll={() => {
          setSkillUpdatingId('*')
          void (async () => {
            let done = 0
            for (const row of skillRows.filter((entry) => entry.canUpdate)) if (await updateSkill(row, true)) done += 1
            await skills.refresh()
            if (done > 0) notify({ tone: 'success', message: t('pluginsSkillsUpdated', { count: done }) })
          })().finally(() => setSkillUpdatingId(null))
        }}
        onOpenFolder={(row) => void openPath(() => window.kunGui.openSkillRoot(row.skillDir))}
        onDiscover={() => setView('discover')}
      />
    )
  }

  const detail = detailItem ? buildPluginDetail(detailItem, { t, state: discover.stateOf(detailItem), categoryLabels: discover.labels }) : null
  const detailKey = detailItem ? `${detailItem.market?.sourceId ?? 'kun'}:${detailItem.kind}:${detailItem.id}` : ''

  return (
    <PluginsPage
      t={t}
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={onToggleLeftSidebar}
      kind={kind}
      onKind={setKind}
      actions={headerActions}
      renderRail={(compact) => (
        <PluginsRail
          t={t}
          compact={compact}
          view={view}
          installedCount={kind === 'mcp' ? mcpRows.length : skillRows.length}
          installedBadge={installedBadge}
          onInstalled={() => setView('installed')}
          sources={discover.sources}
          source={source}
          onSource={(id) => { setSource(id); setView('discover') }}
          categories={discover.categories}
          categoryTotal={discover.categoryTotal}
          category={category}
          onCategory={setCategory}
          locations={kind === 'skill' ? locations : undefined}
          location={location}
          onLocation={setLocation}
          sync={discover.sync}
          onRefresh={() => void market.refresh()}
        />
      )}
      renderMain={renderMain}
      overlays={(
        <>
          {detail && detailItem ? (
            <PluginDetailDrawer
              t={t}
              detail={detail}
              busy={(kind === 'mcp' ? actions.busyKey : skillBusyKey) === detailKey}
              onClose={() => setDetailItem(null)}
              onPrimary={() => {
                const item = detailItem
                if (item.kind === 'mcp') setDetailItem(null)
                discoverAction(item, detailKey)
              }}
            />
          ) : null}
          {actions.sheet ? (
            <McpConfigSheet
              key={`${actions.sheet.mode}:${actions.sheet.form.id}`}
              t={t}
              mode={actions.sheet.mode}
              title={actions.sheet.title}
              initial={actions.sheet.form}
              requiredKeys={actions.sheet.requiredKeys}
              sourceBadge={actions.sheet.sourceBadge}
              statusPill={actions.sheet.statusPill}
              pinned={actions.sheet.pinned}
              lastError={actions.sheet.lastError}
              busy={actions.sheetBusy}
              saveError={actions.sheetError}
              onCancel={actions.closeSheet}
              onSave={(form) => void actions.saveSheet(form)}
              onDelete={actions.sheet.mode === 'edit' ? () => {
                const row = mcpRows.find((entry) => entry.id === actions.sheet?.form.id)
                if (row) actions.setConfirmRow(row)
              } : undefined}
            />
          ) : null}
          {actions.confirmRow ? (
            <ConfirmDialog
              t={t}
              title={t('pluginsDeleteTitle', { name: actions.confirmRow.title })}
              body={t('pluginsDeleteBody')}
              confirmLabel={t('pluginsDelete')}
              onCancel={() => actions.setConfirmRow(null)}
              onConfirm={() => actions.confirmRow && void actions.remove(actions.confirmRow)}
            />
          ) : null}
          {actions.oauthItem?.oauth ? (
            <OAuthConnectorPreviewDialog
              item={actions.oauthItem}
              onClose={() => actions.setOauthItem(null)}
              onConfirm={() => actions.oauthItem && void actions.confirmOauth(actions.oauthItem)}
              t={t}
            />
          ) : null}
          {customKind ? (
            <CustomPluginSheet t={t} kind={customKind} busy={customBusy} onCancel={() => setCustomKind(null)} onSubmit={(fields) => addCustom(customKind, fields)} />
          ) : null}
          {githubOpen ? (
            <GitHubImportSheet
              t={t}
              url={github.url}
              busy={github.busy}
              summary={github.summary}
              onUrlChange={github.setUrl}
              onImport={() => void github.importSkills()}
              onCancel={() => { setGithubOpen(false); github.reset() }}
            />
          ) : null}
          <GitHubMcpAuthorizationDialog
            preflight={githubAuthorization.preflight ?? undefined}
            busy={githubAuthorization.busy}
            onCancel={githubAuthorization.close}
            onBind={(host) => void githubAuthorization.bind(host)}
            onDisable={() => void githubAuthorization.disable()}
            onConfirm={(input) => void githubAuthorization.confirm(input)}
            t={t}
          />
          {toast ? <PluginToast t={t} toast={toast} onDismiss={dismissToast} /> : null}
        </>
      )}
    />
  )
}
