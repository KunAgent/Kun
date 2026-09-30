import type { Dispatch, ReactElement, SetStateAction } from 'react'
import {
  ChevronDown,
  Download,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings
} from 'lucide-react'
import type { SkillListItem } from '@shared/kun-gui-api'
import type { SkillRootId } from '../lib/skill-root-preference'
import { NoticeView, TabButton, type MarketplaceNotice } from './PluginMarketplaceParts'
import type { McpMarketplaceOverlay } from './plugin-marketplace-runtime'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'
import {
  normalizeSkillId,
  type MarketplaceItem,
  type PluginFilter,
  type PluginKind,
  type SkillRootOption
} from './plugin-marketplace-config'
import {
  CustomPluginPanel,
  OAuthConnectorPreviewDialog,
  PluginSection
} from './PluginMarketplaceItemPanels'
import {
  GitHubSkillImportPanel,
  McpRuntimeOverlayPanel
} from './PluginMarketplaceRuntimePanels'

type Translate = (key: string, values?: Record<string, unknown>) => string

type PluginMarketplaceContentProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  t: Translate
  activeKind: PluginKind
  setActiveKind: Dispatch<SetStateAction<PluginKind>>
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  filter: PluginFilter
  setFilter: Dispatch<SetStateAction<PluginFilter>>
  customOpen: boolean
  setCustomOpen: Dispatch<SetStateAction<boolean>>
  githubImportOpen: boolean
  setGithubImportOpen: Dispatch<SetStateAction<boolean>>
  selectedSkillRoot?: SkillRootOption
  skillRootOptions: SkillRootOption[]
  setSkillRootId: Dispatch<SetStateAction<SkillRootId>>
  openManageTarget: () => Promise<void>
  refreshSkillList: () => Promise<void>
  refreshSkillRoots: () => Promise<void>
  skillListLoading: boolean
  skillListError: string
  discoveredSkills: SkillListItem[]
  disabledSkillIds: string[]
  mcpRuntimeOverlay: McpMarketplaceOverlay
  runtimeOverlayLoading: boolean
  runtimeOverlayError: string
  refreshMcpRuntimeOverlay: () => Promise<unknown>
  customName: string
  setCustomName: Dispatch<SetStateAction<string>>
  customDescription: string
  setCustomDescription: Dispatch<SetStateAction<string>>
  customCommand: string
  setCustomCommand: Dispatch<SetStateAction<string>>
  customArgs: string
  setCustomArgs: Dispatch<SetStateAction<string>>
  customConfig: string
  setCustomConfig: Dispatch<SetStateAction<string>>
  customSkillBody: string
  setCustomSkillBody: Dispatch<SetStateAction<string>>
  busyId: string | null
  addCustom: () => Promise<void>
  githubImportUrl: string
  setGithubImportUrl: Dispatch<SetStateAction<string>>
  githubImportBusy: boolean
  githubImportSummary: { count: number; names: string[] } | null
  addFromGitHub: () => Promise<void>
  notice: MarketplaceNotice | null
  oauthPreviewItem: MarketplaceItem | null
  setOauthPreviewItem: Dispatch<SetStateAction<MarketplaceItem | null>>
  confirmOauthInstall: (item: MarketplaceItem) => Promise<void>
  builtInItems: MarketplaceItem[]
  recommendedItems: MarketplaceItem[]
  personalItems: MarketplaceItem[]
  isInstalled: (item: Pick<MarketplaceItem, 'kind' | 'id'> & Partial<Pick<MarketplaceItem, 'group' | 'serverIds'>>) => boolean
  addItem: (item: MarketplaceItem) => Promise<void>
  skillToggleBusyId: string | null
  toggleSkillEnabled: (id: string, enabled: boolean) => Promise<void>
  mcpConfigText: string
  mcpToggleBusyId: string | null
  toggleMcpEnabled: (id: string, enabled: boolean) => Promise<void>
}

export function PluginMarketplaceContent({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  t,
  activeKind,
  setActiveKind,
  query,
  setQuery,
  filter,
  setFilter,
  customOpen,
  setCustomOpen,
  githubImportOpen,
  setGithubImportOpen,
  selectedSkillRoot,
  skillRootOptions,
  setSkillRootId,
  openManageTarget,
  refreshSkillList,
  refreshSkillRoots,
  skillListLoading,
  skillListError,
  discoveredSkills,
  disabledSkillIds,
  mcpRuntimeOverlay,
  runtimeOverlayLoading,
  runtimeOverlayError,
  refreshMcpRuntimeOverlay,
  customName,
  setCustomName,
  customDescription,
  setCustomDescription,
  customCommand,
  setCustomCommand,
  customArgs,
  setCustomArgs,
  customConfig,
  setCustomConfig,
  customSkillBody,
  setCustomSkillBody,
  busyId,
  addCustom,
  githubImportUrl,
  setGithubImportUrl,
  githubImportBusy,
  githubImportSummary,
  addFromGitHub,
  notice,
  oauthPreviewItem,
  setOauthPreviewItem,
  confirmOauthInstall,
  builtInItems,
  recommendedItems,
  personalItems,
  isInstalled,
  addItem,
  skillToggleBusyId,
  toggleSkillEnabled,
  mcpConfigText,
  mcpToggleBusyId,
  toggleMcpEnabled
}: PluginMarketplaceContentProps): ReactElement {
  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <h1 className="sr-only">{t('plugins')}</h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-7 md:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-ds-subtle p-1">
            <TabButton active={activeKind === 'mcp'} onClick={() => setActiveKind('mcp')}>
              {t('pluginTabMcp')}
            </TabButton>
            <TabButton active={activeKind === 'skill'} tone="skill" onClick={() => setActiveKind('skill')}>
              {t('pluginTabSkill')}
            </TabButton>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openManageTarget()}
              className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
            >
              <Settings className="h-4 w-4" strokeWidth={1.75} />
              {t('pluginManage')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomOpen((value) => !value)
                setGithubImportOpen(false)
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
              {t('pluginCreate')}
            </button>
            {activeKind === 'skill' ? (
              <button
                type="button"
                onClick={() => {
                  setGithubImportOpen((value) => !value)
                  setCustomOpen(false)
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                <Download className="h-4 w-4" strokeWidth={1.9} />
                {t('pluginGithubImport')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-9 flex flex-col items-center text-center">
          <h1 className="text-[32px] font-semibold text-ds-ink md:text-[40px]">
            {activeKind === 'mcp' ? t('pluginMcpTitle') : t('pluginSkillTitle')}
          </h1>
        </div>

        <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-[15px] text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={activeKind === 'mcp' ? t('pluginSearchMcp') : t('pluginSearchSkill')}
            />
          </label>
          <label className="relative w-full md:w-[168px]">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as PluginFilter)}
              className="h-11 w-full appearance-none rounded-2xl border border-ds-border bg-ds-card px-4 pr-9 text-[15px] font-medium text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            >
              <option value="all">{t('pluginFilterAll')}</option>
              <option value="recommended">{t('pluginFilterRecommended')}</option>
              <option value="installed">{t('pluginFilterInstalled')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
          </label>
        </div>

        {activeKind === 'skill' ? (
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <select
              value={selectedSkillRoot?.id ?? ''}
              onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
              disabled={skillRootOptions.length === 0}
              className="h-10 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skillRootOptions.length === 0 ? (
                <option value="">{t('pluginSkillRootNone')}</option>
              ) : (
                skillRootOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.enabled ? option.label : `${option.label} · ${t('pluginSkillStatusDisabled')}`}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => void openManageTarget()}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
            >
              <FolderOpen className="h-4 w-4" />
              {t('pluginOpenLocation')}
            </button>
            <button
              type="button"
              onClick={() => void Promise.all([refreshSkillList(), refreshSkillRoots()])}
              disabled={skillListLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skillListLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('pluginSkillRefresh')}
            </button>
            {skillListError ? (
              <span className="text-[12px] text-red-700 dark:text-red-300">
                {skillListError}
              </span>
            ) : (
              <span className="text-[12px] text-ds-faint">
                {t('pluginSkillDiscoveredCountWithEnabled', {
                  count: discoveredSkills.length,
                  enabled: discoveredSkills.filter((skill) => !disabledSkillIds.includes(normalizeSkillId(skill.id))).length
                })}
              </span>
            )}
          </div>
        ) : null}

        {activeKind === 'mcp' ? (
          <McpRuntimeOverlayPanel
            overlay={mcpRuntimeOverlay}
            loading={runtimeOverlayLoading}
            error={runtimeOverlayError}
            onRefresh={() => void refreshMcpRuntimeOverlay()}
            t={t}
          />
        ) : null}

        {customOpen ? (
          <CustomPluginPanel
            activeKind={activeKind}
            customName={customName}
            customDescription={customDescription}
            customCommand={customCommand}
            customArgs={customArgs}
            customConfig={customConfig}
            customSkillBody={customSkillBody}
            busy={busyId === `custom:${activeKind}`}
            onNameChange={setCustomName}
            onDescriptionChange={setCustomDescription}
            onCommandChange={setCustomCommand}
            onArgsChange={setCustomArgs}
            onConfigChange={setCustomConfig}
            onSkillBodyChange={setCustomSkillBody}
            onAdd={() => void addCustom()}
          />
        ) : null}

        {activeKind === 'skill' && githubImportOpen ? (
          <GitHubSkillImportPanel
            url={githubImportUrl}
            busy={githubImportBusy}
            summary={githubImportSummary}
            onUrlChange={setGithubImportUrl}
            onImport={() => void addFromGitHub()}
          />
        ) : null}

        {notice ? <NoticeView notice={notice} /> : null}
        {oauthPreviewItem?.oauth ? (
          <OAuthConnectorPreviewDialog
            item={oauthPreviewItem}
            onClose={() => setOauthPreviewItem(null)}
            onConfirm={() => void confirmOauthInstall(oauthPreviewItem)}
            t={t}
          />
        ) : null}

        {activeKind === 'mcp' ? (
          <PluginSection
            title={t('pluginBuiltIn')}
            emptyText={t('pluginNoResults')}
            items={builtInItems}
            busyId={busyId}
            isInstalled={isInstalled}
            onAdd={addItem}
            disabledSkillIds={disabledSkillIds}
            skillToggleBusyId={skillToggleBusyId}
            onToggleSkillEnabled={toggleSkillEnabled}
            mcpConfigText={mcpConfigText}
            mcpToggleBusyId={mcpToggleBusyId}
            onToggleMcpEnabled={toggleMcpEnabled}
            t={t}
          />
        ) : null}

        <PluginSection
          title={t('pluginRecommended')}
          emptyText={t('pluginNoResults')}
          items={recommendedItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          disabledSkillIds={disabledSkillIds}
          skillToggleBusyId={skillToggleBusyId}
          onToggleSkillEnabled={toggleSkillEnabled}
          mcpConfigText={mcpConfigText}
          mcpToggleBusyId={mcpToggleBusyId}
          onToggleMcpEnabled={toggleMcpEnabled}
          t={t}
        />

        <PluginSection
          title={t('pluginPersonal')}
          emptyText={t('pluginPersonalEmpty')}
          items={personalItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          disabledSkillIds={disabledSkillIds}
          skillToggleBusyId={skillToggleBusyId}
          onToggleSkillEnabled={toggleSkillEnabled}
          mcpConfigText={mcpConfigText}
          mcpToggleBusyId={mcpToggleBusyId}
          onToggleMcpEnabled={toggleMcpEnabled}
          t={t}
        />

        {activeKind === 'mcp' ? (
          <div className="mt-8 flex items-center gap-2 text-[12px] text-ds-faint">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('pluginMcpRestartHint')}</span>
          </div>
        ) : null}
        </div>
      </main>
    </div>
  )
}
