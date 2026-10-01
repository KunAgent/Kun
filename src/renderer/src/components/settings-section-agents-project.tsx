import {
  Ban,
  FolderOpen,
  Loader2,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import { type ReactElement } from 'react'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard
} from './settings-controls'
import { AdeProjectDefaultsPanel } from './settings-section-ade-project-defaults'

const loadLocalProjectDefaults = async (projectPath: string) => {
  if (typeof window === 'undefined' || typeof window.kunGui?.getAdeProjectDefaults !== 'function') {
    throw new Error('Project defaults require a current desktop runtime.')
  }
  return window.kunGui.getAdeProjectDefaults({ projectPath })
}
const saveLocalProjectDefaults = async (request: Parameters<typeof window.kunGui.saveAdeProjectDefaults>[0]) => {
  if (typeof window === 'undefined' || typeof window.kunGui?.saveAdeProjectDefaults !== 'function') {
    throw new Error('Project defaults cannot be saved from this client.')
  }
  return window.kunGui.saveAdeProjectDefaults(request)
}

export function AgentsProjectSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, kun, form, compactHomePath, activeProjectWorkspaceRoot, projectConfig, projectConfigText, setProjectConfigText, projectConfigLoading, projectConfigBusy, projectConfigNotice, loadProjectConfig, saveProjectConfig, setProjectConfigTrust, openProjectConfigDir, activePanel } = view
  return (
    <>
              <div
                id="agents-settings-panel-project"
                role="tabpanel"
                aria-labelledby="agents-settings-tab-project"
                className={activePanel === 'project' ? '' : 'hidden'}
              >
                <AdeProjectDefaultsPanel
                  t={t}
                  projectPath={activeProjectWorkspaceRoot ?? ''}
                  kun={kun}
                  providers={form?.provider?.providers ?? []}
                  load={loadLocalProjectDefaults}
                  save={saveLocalProjectDefaults}
                  onDraftChange={view.onAdeProjectDraftChange}
                />
                <SettingsCard title={t('projectConfigTitle')}>
                  <div className="space-y-3 px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('projectConfigDescription') }} />
                    <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                      {t('projectConfigSecurityHint')}
                    </div>
                  </div>
                  {!activeProjectWorkspaceRoot ? (
                    <div className="px-3 pb-4">
                      <InlineNoticeView notice={{ tone: 'info', message: t('projectConfigWorkspaceRequired') }} />
                    </div>
                  ) : (
                    <>
                      <SettingRow
                        title={t('projectConfigWorkspace')}
                        description={t('projectConfigWorkspaceDesc')}
                        wideControl
                        control={
                          <div className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm">
                            <div className="break-all">{compactHomePath(activeProjectWorkspaceRoot)}</div>
                            <div className="mt-1 break-all text-ds-muted">
                              {compactHomePath(projectConfig?.path ?? `${activeProjectWorkspaceRoot}/.kun/project.json`)}
                            </div>
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigStatus')}
                        description={t('projectConfigStatusDesc')}
                        wideControl
                        control={
                          <div className="flex w-full flex-col gap-2">
                            <div className="flex flex-wrap gap-2 text-[12px]">
                              <span className="rounded-full border border-ds-border bg-ds-main/70 px-2.5 py-1 font-medium text-ds-ink">
                                {projectConfigLoading
                                  ? t('loading')
                                  : t(`projectConfigStatus_${projectConfig?.status ?? 'missing'}`)}
                              </span>
                              <span className={`rounded-full border px-2.5 py-1 font-medium ${
                                projectConfig?.trust === 'trusted'
                                  ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                                  : projectConfig?.trust === 'stale'
                                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                                    : 'border-ds-border bg-ds-main/70 text-ds-muted'
                              }`}>
                                {t(`projectConfigTrust_${projectConfig?.trust ?? 'untrusted'}`)}
                              </span>
                              {projectConfig?.digest ? (
                                <span className="rounded-full border border-ds-border bg-ds-main/70 px-2.5 py-1 font-mono text-ds-muted">
                                  sha256:{projectConfig.digest.slice(0, 12)}
                                </span>
                              ) : null}
                            </div>
                            {projectConfig?.message ? (
                              <div className="rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
                                {projectConfig.message}
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigSummary')}
                        description={t('projectConfigSummaryDesc')}
                        wideControl
                        control={
                          <div className="grid w-full gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigMcpServers')}: <span className="font-mono text-ds-ink">{projectConfig?.serverSummaries.length ?? 0}</span>
                            </div>
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigSkillRoots')}: <span className="font-mono text-ds-ink">{projectConfig?.skillRootCount ?? 0}</span>
                            </div>
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              {t('projectConfigDisabledSkills')}: <span className="font-mono text-ds-ink">{projectConfig?.disabledSkillCount ?? 0}</span>
                            </div>
                            {projectConfig?.serverSummaries.length ? (
                              <div className="sm:col-span-3 rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                                {projectConfig.serverSummaries.map((server: { id: string; target: string; enabled: boolean }) => (
                                  <div key={server.id} className="flex min-w-0 items-center justify-between gap-3 py-0.5">
                                    <span className="font-mono text-ds-ink">{server.id}</span>
                                    <span className="min-w-0 truncate font-mono" title={server.target}>{server.target}</span>
                                    <span>{server.enabled ? t('projectConfigServerEnabled') : t('projectConfigServerDisabled')}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                      <SettingRow
                        title={t('projectConfigEditor')}
                        description={t('projectConfigEditorDesc')}
                        wideControl
                        control={
                          <textarea
                            value={projectConfigText ?? ''}
                            onChange={(event) => setProjectConfigText?.(event.target.value)}
                            disabled={projectConfigLoading || projectConfigBusy}
                            spellCheck={false}
                            aria-label={t('projectConfigEditor')}
                            className="min-h-64 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[12.5px] leading-5 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
                          />
                        }
                      />
                      <SettingRow
                        title={t('projectConfigActions')}
                        description={t('projectConfigActionsDesc')}
                        wideControl
                        control={
                          <div className="flex w-full flex-col gap-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void saveProjectConfig?.()}
                                disabled={projectConfigBusy || projectConfigLoading}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                              >
                                {projectConfigBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                {t('projectConfigSave')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void loadProjectConfig?.()}
                                disabled={projectConfigBusy || projectConfigLoading}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-subtle disabled:opacity-55"
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${projectConfigLoading ? 'animate-spin' : ''}`} />
                                {t('projectConfigRefresh')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void openProjectConfigDir?.()}
                                disabled={projectConfigBusy}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-subtle disabled:opacity-55"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                {t('projectConfigOpenDir')}
                              </button>
                              {projectConfig?.trust !== 'trusted' ? (
                                <button
                                  type="button"
                                  onClick={() => void setProjectConfigTrust?.(true)}
                                  disabled={projectConfigBusy || projectConfig?.status !== 'valid'}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-[13px] font-medium text-emerald-700 transition hover:bg-emerald-500/15 disabled:opacity-55 dark:text-emerald-200"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  {projectConfig?.trust === 'stale' ? t('projectConfigReapprove') : t('projectConfigApprove')}
                                </button>
                              ) : null}
                              {projectConfig?.trust === 'trusted' || projectConfig?.trust === 'stale' ? (
                                <button
                                  type="button"
                                  onClick={() => void setProjectConfigTrust?.(false)}
                                  disabled={projectConfigBusy}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-[13px] font-medium text-red-700 transition hover:bg-red-500/15 disabled:opacity-55 dark:text-red-200"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  {t('projectConfigRevoke')}
                                </button>
                              ) : null}
                            </div>
                            {projectConfigNotice ? <InlineNoticeView notice={projectConfigNotice} /> : null}
                          </div>
                        }
                      />
                    </>
                  )}
                </SettingsCard>
              </div>

    </>
  )
}
