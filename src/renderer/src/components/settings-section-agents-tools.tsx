import { settingsButtonClass } from './settings-button'
import type {
  SkillRootListItem
} from '@shared/kun-gui-api'
import {
  FolderOpen,
  Loader2,
  RefreshCw,
  Settings
} from 'lucide-react'
import { type ReactElement } from 'react'
import { McpServersEditor } from './mcp/McpServersEditor'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  Toggle
} from './settings-controls'
import {
  skillRootShortLabel
} from './settings-section-agents-utils'

export function AgentsToolsSettingsPanels({ view }: { view: Record<string, any> }): ReactElement {
  const { t, tCommon, form, update, selectControlClass, compactHomePath, compactHomePathList, expandHomePathList, skillSectionRef, mcpSectionRef, skillRoots, skillRootsLoading, toggleSkillRoot, skillNotice, openSkillRoot, openPlugins, mcpConfigPath, mcpConfigExists, mcpConfigText, setMcpConfigText, mcpLoading, mcpBusy, mcpNotice, saveMcpConfig, loadMcpConfig, openMcpConfigDir, runtimeInfo, toolDiagnostics, splitSettingsList, mcpSearch, mcpRawMode, setMcpRawMode, activePanel, skillPermissionSummary, mcpPermissionSummary, updateMcpSearch } = view
  return (
    <>
              <div
                id="agents-settings-panel-skills"
                ref={skillSectionRef}
                role="tabpanel"
                aria-labelledby="agents-settings-tab-skills"
                className={activePanel === 'skills' ? '' : 'hidden'}
              >
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsDetectedDirs')}
                    description={t('skillsDetectedDirsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        {skillRootsLoading && skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('loading')}
                          </div>
                        ) : skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('skillsDetectedDirsEmpty')}
                          </div>
                        ) : (
                          skillRoots.map((root: SkillRootListItem) => (
                            <div
                              key={`${root.id}:${root.path}`}
                              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 shadow-sm ${
                                root.enabled ? 'border-ds-border bg-ds-card' : 'border-ds-border-muted bg-ds-main/40'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[13px] font-medium text-ds-ink">
                                    {root.labelKey ? tCommon(root.labelKey) : skillRootShortLabel(root.path)}
                                  </span>
                                  <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-muted">
                                    {root.scope === 'project' ? t('skillsScopeProject') : t('skillsScopeGlobal')}
                                  </span>
                                  {root.exists ? (
                                    <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                                      {t('skillsDirSkillCount', { count: root.skillCount })}
                                    </span>
                                  ) : (
                                    <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint">
                                      {t('skillsDirNotFound')}
                                    </span>
                                  )}
                                </div>
                                <code className="mt-1 block break-all font-mono text-[12px] text-ds-muted">
                                  {compactHomePath(root.path)}
                                </code>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => void openSkillRoot(root.path)}
                                  className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                                  aria-label={t('skillsOpenRoot')}
                                  title={t('skillsOpenRoot')}
                                >
                                  <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                                <Toggle checked={root.enabled} onChange={(value) => toggleSkillRoot(root, value)} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsPermissionSources')}
                    description={t('skillsPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-5">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionEnabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.enabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionWorkspaceRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.workspaceRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionGlobalRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.globalRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledIds')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledSkillIds}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                          {t('skillsPermissionRuntimeNote')}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={compactHomePathList(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: expandHomePathList(splitSettingsList(event.target.value))
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={'~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className={settingsButtonClass({ variant: 'primary' })}
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div
                id="agents-settings-panel-tools"
                ref={mcpSectionRef}
                role="tabpanel"
                aria-labelledby="agents-settings-tab-tools"
                className={activePanel === 'tools' ? '' : 'hidden'}
              >
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('mcpSearchEnabled')}
                    description={t('mcpSearchEnabledDesc')}
                    control={
                      <Toggle
                        checked={mcpSearch.enabled}
                        onChange={(v) => updateMcpSearch({ enabled: v })}
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('mcpAdvanced')}
                      description={t('mcpAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('mcpSearchMode')}
                    description={t('mcpSearchModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={mcpSearch.mode}
                        disabled={!mcpSearch.enabled}
                        onChange={(e) => updateMcpSearch({ mode: e.target.value })}
                      >
                        <option value="auto">{t('mcpSearchModeAuto')}</option>
                        <option value="search">{t('mcpSearchModeSearch')}</option>
                        <option value="direct">{t('mcpSearchModeDirect')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchLimits')}
                    description={t('mcpSearchLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchAutoThreshold')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.autoThresholdToolCount}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ autoThresholdToolCount: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKDefault')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKDefault}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKDefault: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKMax')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKMax}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKMax: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchMinScore')}
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.minScore}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ minScore: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchDiagnostics')}
                    description={t('mcpSearchDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchStatus')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.active ? t('mcpSearchActive') : t('mcpSearchInactive')}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchIndexed')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.indexedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.indexedToolCount ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchAdvertised')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.advertisedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.advertisedToolCount ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpPermissionSources')}
                    description={t('mcpPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-4">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.enabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionDisabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.disabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionUserServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.userScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionWorkspaceServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionVisibleServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceVisibleServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionLocalServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.localServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionRemoteServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.remoteServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnvServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.envServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionHeaderServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.headerServers}</span>
                          </div>
                        </div>
                        {mcpPermissionSummary.parseError ? (
                          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
                            {t('mcpPermissionParseError')}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                            {t('mcpPermissionRuntimeNote')}
                          </div>
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {compactHomePath(mcpConfigPath)}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <McpServersEditor
                          value={mcpConfigText}
                          onChange={setMcpConfigText}
                          disabled={mcpLoading}
                          rawMode={mcpRawMode}
                          onToggleRawMode={setMcpRawMode}
                          loadingPlaceholder={mcpLoading ? t('loading') : ''}
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button aria-busy={Boolean(mcpBusy)}
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className={settingsButtonClass({ variant: 'primary' })}
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button aria-busy={Boolean(mcpLoading)} className={settingsButtonClass()}
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button className={settingsButtonClass()}
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

    </>
  )
}
