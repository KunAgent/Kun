import {
  AlertTriangle,
  Archive,
  Bug,
  ChevronLeft,
  FileArchive,
  FolderCode,
  Globe2,
  PanelTop,
  Puzzle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SidebarTitlebarToggleButton } from '../components/sidebar/SidebarPrimitives'
import { ExtensionAccountManagement } from './ExtensionAccountManagement'
import { extensionHostIconUrl } from './contribution-registry'
import {
  extensionWorkbenchClient,
  type BundledExtensionSeedDiagnostic,
  type ExtensionHostDiagnostic,
  type ExtensionManagementEntry
} from './extension-workbench-client'
import { boundedPlainText } from './safe-text'

type Tab = 'installed' | 'install' | 'diagnostics'

function boundedText(value: unknown, max = 4_096): string {
  return boundedPlainText(value, max)
}

function selectedRecord(entry: ExtensionManagementEntry) {
  if (entry.useDevelopment && entry.development) return entry.development
  return entry.versions.find((version) => version.version === entry.selectedVersion)
}

export function extensionEffectiveEnabled(entry: ExtensionManagementEntry, workspaceRoot: string): boolean {
  if (typeof entry.effectiveEnabled === 'boolean') return entry.effectiveEnabled
  if (typeof entry.effectiveWorkspaceEnabled === 'boolean') return entry.effectiveWorkspaceEnabled
  if (!workspaceRoot) return entry.globallyEnabled
  return entry.workspaceEnablement[workspaceRoot] ?? entry.globallyEnabled
}

export function extensionCanRollback(entry: ExtensionManagementEntry): boolean {
  return Boolean(entry.previousSelectedVersion && entry.previousSelectedVersion !== entry.selectedVersion)
}

export function extensionCardLogoUrl(extensionId: string, icon?: string): string | undefined {
  return icon ? extensionHostIconUrl(extensionId, icon) : undefined
}

export function ExtensionManagementCenter({
  leftSidebarCollapsed,
  workspaceRoot,
  onToggleLeftSidebar,
  onOpenIntegrations,
  onOpenView
}: {
  leftSidebarCollapsed: boolean
  workspaceRoot: string
  onToggleLeftSidebar: () => void
  onOpenIntegrations: () => void
  onOpenView: (contributionId: string) => Promise<void>
}): ReactElement {
  const { i18n } = useTranslation()
  const zh = i18n.language.toLowerCase().startsWith('zh')
  const copy = (chinese: string, english: string): string => zh ? chinese : english
  const [tab, setTab] = useState<Tab>('installed')
  const [entries, setEntries] = useState<ExtensionManagementEntry[]>([])
  const [diagnostics, setDiagnostics] = useState<Map<string, {
    host: ExtensionHostDiagnostic
    seed?: BundledExtensionSeedDiagnostic
  }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null)
  const [indexUrl, setIndexUrl] = useState('')
  const [indexExtensionId, setIndexExtensionId] = useState('')
  const [indexVersion, setIndexVersion] = useState('')
  const [permissionEditorId, setPermissionEditorId] = useState<string | null>(null)
  const [permissionDraft, setPermissionDraft] = useState<string[]>([])
  const refreshGeneration = useRef(0)
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.id.localeCompare(b.id)), [entries])

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++refreshGeneration.current
    setLoading(true)
    try {
      const [nextEntries, nextDiagnostics] = await Promise.all([
        extensionWorkbenchClient.listExtensions(workspaceRoot || undefined, i18n.language),
        extensionWorkbenchClient.listDiagnostics()
      ])
      if (generation !== refreshGeneration.current) return
      setEntries(nextEntries)
      setDiagnostics(new Map(nextDiagnostics.map((item) => [item.extensionId, {
        host: item.host,
        ...(item.seed ? { seed: item.seed } : {})
      }])))
    } catch (error) {
      if (generation !== refreshGeneration.current) return
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (generation === refreshGeneration.current) setLoading(false)
    }
  }, [i18n.language, workspaceRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (id: string, operation: () => Promise<void>, success: string): Promise<boolean> => {
    setBusyId(id)
    setNotice(null)
    try {
      await operation()
      setNotice({ tone: 'success', text: success })
      await refresh()
      return true
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      setBusyId(null)
    }
  }

  const openView = async (extensionId: string, contributionId: string): Promise<void> => {
    setBusyId(extensionId)
    setNotice(null)
    try {
      await onOpenView(contributionId)
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyId(null)
    }
  }

  const installArchive = async (): Promise<void> => {
    const path = await extensionWorkbenchClient.pickPackage()
    if (!path) return
    await run(path, async () => {
      await extensionWorkbenchClient.install({ source: 'archive', path })
    }, copy('扩展包已安装。', 'Extension package installed.'))
  }

  const installDevelopment = async (): Promise<void> => {
    const path = await extensionWorkbenchClient.pickDevelopmentDirectory()
    if (!path) return
    await run(path, () => extensionWorkbenchClient.install({ source: 'development', path }), copy('开发目录已注册。', 'Development directory registered.'))
  }

  const installIndexVersion = async (): Promise<void> => {
    const request = {
      source: 'index' as const,
      indexUrl: indexUrl.trim(),
      extensionId: indexExtensionId.trim(),
      version: indexVersion.trim()
    }
    await run(request.extensionId || 'index', () => extensionWorkbenchClient.install(request), copy('指定版本已安装。', 'Exact index version installed.'))
  }

  const uninstall = async (entry: ExtensionManagementEntry): Promise<void> => {
    await run(entry.id, () => extensionWorkbenchClient.uninstall(entry.id), copy('扩展已卸载，数据仍保留。', 'Extension uninstalled; its data was preserved.'))
  }

  return (
    <section className="ds-extension-center flex h-full min-h-0 flex-1 flex-col bg-ds-main" aria-label={copy('Kun 扩展管理中心', 'Kun Extension Center')}>
      <header className="ds-drag flex h-14 shrink-0 items-center gap-3 border-b border-ds-border-muted px-4">
        <SidebarTitlebarToggleButton
          onClick={onToggleLeftSidebar}
          title={leftSidebarCollapsed ? copy('展开侧栏', 'Expand sidebar') : copy('收起侧栏', 'Collapse sidebar')}
          ariaLabel={leftSidebarCollapsed ? copy('展开侧栏', 'Expand sidebar') : copy('收起侧栏', 'Collapse sidebar')}
        />
        <Puzzle className="h-5 w-5 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-ds-ink">{copy('扩展', 'Extensions')}</h1>
          <div className="truncate text-[10.5px] text-ds-faint">{copy('完整应用、Agent、工具和 Provider 扩展', 'Full apps, Agent, tool, and Provider extensions')}</div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ds-no-drag inline-flex items-center gap-2 rounded-lg border border-ds-border px-2.5 py-1.5 text-[11px] font-semibold text-ds-muted hover:bg-ds-hover disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {copy('刷新', 'Refresh')}
        </button>
      </header>

      <div className="ds-no-drag border-b border-ds-border-muted px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {([
            ['installed', copy('已安装', 'Installed')],
            ['install', copy('安装', 'Install')],
            ['diagnostics', copy('诊断与日志', 'Diagnostics & logs')]
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${tab === id ? 'bg-accent text-white' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-[11.5px] leading-5 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{copy('Node 扩展是受信任代码，会以当前用户的操作系统权限运行；权限清单用于 Broker 授权和风险披露，不是操作系统沙箱。Direct DOM 同样属于高风险且不受兼容性保证。Kun 不会自动检查扩展更新。', 'Node extensions are trusted code running with the current user’s OS privileges. Broker permissions are authorization and disclosure, not an OS sandbox. Direct DOM is also high risk and outside compatibility guarantees. No automatic update checks are performed.')}</span>
          </div>

          <button
            type="button"
            onClick={onOpenIntegrations}
            className="mb-5 flex w-full items-center gap-3 rounded-xl border border-ds-border bg-ds-card p-3 text-left hover:bg-ds-hover"
          >
            <ChevronLeft className="h-4 w-4 shrink-0 text-ds-faint" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-ds-ink">{copy('寻找 UI 外观包、MCP 或 Skill？', 'Looking for UI appearance packs, MCP, or Skills?')}</span>
              <span className="mt-0.5 block text-[11px] text-ds-faint">{copy('这些系统保持独立，不会转换成 .kunx 扩展。', 'Those systems remain separate and are not converted into .kunx extensions.')}</span>
            </span>
          </button>

          {notice ? (
            <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-xl border px-3 py-2 text-[12px] ${notice.tone === 'error' ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/25 dark:text-red-200' : notice.tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200' : 'border-ds-border bg-ds-card text-ds-muted'}`}>
              {boundedText(notice.text)}
            </div>
          ) : null}

          {tab === 'install' ? (
            <div className="grid gap-4 md:grid-cols-3">
              <InstallCard icon={<FileArchive className="h-5 w-5" />} title={copy('本地 .kunx', 'Local .kunx')} description={copy('选择本地扩展包；检查完成后在受保护窗口审核权限和来源。', 'Choose a local package, then review its source and permissions in a protected window.')} action={copy('选择扩展包', 'Choose package')} disabled={busyId !== null} onClick={() => void installArchive()} />
              <InstallCard icon={<FolderCode className="h-5 w-5" />} title={copy('开发目录', 'Development directory')} description={copy('显式注册可变开发目录；Kun 不复制内容，也不会自动重载。', 'Explicitly register a mutable development directory. Kun never copies or auto-reloads it.')} action={copy('选择目录', 'Choose directory')} disabled={busyId !== null} onClick={() => void installDevelopment()} />
              <div className="rounded-xl border border-ds-border bg-ds-card p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink"><Globe2 className="h-5 w-5" />{copy('自定义 HTTPS Index', 'Custom HTTPS Index')}</div>
                <p className="mt-2 text-[11px] leading-5 text-ds-faint">{copy('仅在你明确操作时读取 Index 并安装指定版本；不会自动检查更新。', 'Read an Index only on explicit action and install an exact version. No automatic update checks.')}</p>
                <div className="mt-3 space-y-2">
                  <input aria-label="HTTPS Index URL" value={indexUrl} onChange={(event) => setIndexUrl(event.currentTarget.value)} placeholder="https://example.com/index.json" className="w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[11px]" />
                  <input aria-label="Extension ID" value={indexExtensionId} onChange={(event) => setIndexExtensionId(event.currentTarget.value)} placeholder="publisher.name" className="w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[11px]" />
                  <input aria-label="Exact version" value={indexVersion} onChange={(event) => setIndexVersion(event.currentTarget.value)} placeholder="1.2.3" className="w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[11px]" />
                  <button type="button" disabled={busyId !== null || !indexUrl.trim() || !indexExtensionId.trim() || !indexVersion.trim()} onClick={() => void installIndexVersion()} className="w-full rounded-lg bg-accent px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50">{copy('审核并安装指定版本', 'Review and install exact version')}</button>
                </div>
              </div>
            </div>
          ) : tab === 'diagnostics' ? (
            <div className="space-y-3">
              {sortedEntries.map((entry) => <DiagnosticCard key={entry.id} entry={entry} diagnostic={diagnostics.get(entry.id)?.host} seed={diagnostics.get(entry.id)?.seed} copy={copy} onOpenLogs={() => void window.kunGui.openLogDir()} />)}
              {!loading && sortedEntries.length === 0 ? <EmptyState text={copy('没有扩展诊断。', 'No extension diagnostics.')} /> : null}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedEntries.map((entry) => {
                const selected = selectedRecord(entry)
                const enabled = extensionEffectiveEnabled(entry, workspaceRoot)
                return (
                  <article key={entry.id} className="rounded-xl border border-ds-border bg-ds-card p-4" data-extension-id={entry.id}>
                    <div className="flex flex-wrap items-start gap-3">
                      <ExtensionCardLogo
                        key={`${entry.id}:${selected?.version ?? ''}:${selected?.icon ?? ''}`}
                        extensionId={entry.id}
                        icon={selected?.icon}
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-[13px] font-semibold text-ds-ink">{boundedText(selected?.displayName) || entry.id}</h2>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ds-faint"><span>{entry.id}</span><span>v{selected?.version ?? entry.selectedVersion ?? '—'}</span><span>{selected?.mutable ? copy('开发源', 'development') : boundedText(selected?.source.type) || copy('本地', 'local')}</span></div>
                        {selected?.description ? <p className="mt-2 max-w-2xl text-[11px] leading-5 text-ds-muted">{boundedText(selected.description, 1_024)}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${enabled ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-ds-subtle text-ds-muted'}`}>
                          {enabled ? copy('当前工作区已启用', 'Enabled here') : copy('当前工作区已禁用', 'Disabled here')}
                        </span>
                        {workspaceRoot && entry.workspaceTrusted === false ? (
                          <span className="rounded-lg bg-amber-500/12 px-3 py-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                            {copy('工作区未信任：先审核权限', 'Workspace untrusted: review permissions')}
                          </span>
                        ) : null}
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => {
                              const nextEnabled = !entry.globallyEnabled
                              void run(
                                entry.id,
                                () => nextEnabled && selected && workspaceRoot
                                  ? extensionWorkbenchClient.setPermissionsAndEnable(
                                      entry.id,
                                      selected.version,
                                      (entry.workspaceGrantedPermissions ?? selected.grantedPermissions).filter(
                                        (permission) => selected.requestedPermissions.includes(permission)
                                      ),
                                      workspaceRoot,
                                      'global'
                                    )
                                  : extensionWorkbenchClient.setEnabled(entry.id, nextEnabled),
                                nextEnabled ? copy('权限已确认，扩展已全局启用。', 'Permissions confirmed and extension enabled globally.') : copy('扩展已全局禁用。', 'Extension disabled globally.')
                              )
                            }}
                            className="rounded-md border border-ds-border px-2 py-1 text-[10px] text-ds-muted hover:bg-ds-hover disabled:opacity-50"
                          >
                            {entry.globallyEnabled ? copy('全局关闭', 'Disable globally') : copy('全局开启', 'Enable globally')}
                          </button>
                          {workspaceRoot ? (
                            <button
                              type="button"
                              disabled={busyId !== null || !entry.globallyEnabled}
                              onClick={() => {
                                const nextEnabled = !enabled
                                void run(
                                  entry.id,
                                  () => nextEnabled && selected
                                    ? extensionWorkbenchClient.setPermissionsAndEnable(
                                        entry.id,
                                        selected.version,
                                        (entry.workspaceGrantedPermissions ?? selected.grantedPermissions).filter(
                                          (permission) => selected.requestedPermissions.includes(permission)
                                        ),
                                        workspaceRoot,
                                        'workspace'
                                      )
                                    : extensionWorkbenchClient.setEnabled(entry.id, nextEnabled, workspaceRoot),
                                  nextEnabled ? copy('权限已确认，扩展已在当前工作区启用。', 'Permissions confirmed and extension enabled in this workspace.') : copy('已在当前工作区禁用。', 'Disabled in this workspace.')
                                )
                              }}
                              className="rounded-md border border-ds-border px-2 py-1 text-[10px] text-ds-muted hover:bg-ds-hover disabled:opacity-50"
                            >
                              {enabled ? copy('此工作区关闭', 'Disable here') : copy('此工作区开启', 'Enable here')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-ds-border-muted pt-3">
                      {selected?.mutable ? <ActionButton icon={<RefreshCw className="h-3.5 w-3.5" />} label={copy('显式重载', 'Reload')} disabled={busyId !== null} onClick={() => void run(entry.id, () => extensionWorkbenchClient.reload(entry.id), copy('开发扩展已重载。', 'Development extension reloaded.'))} /> : null}
                      <ActionButton icon={<RotateCcw className="h-3.5 w-3.5" />} label={copy('回滚', 'Rollback')} disabled={busyId !== null || !extensionCanRollback(entry)} onClick={() => void run(entry.id, () => extensionWorkbenchClient.rollback(entry.id), copy('扩展已回滚。', 'Extension rolled back.'))} />
                      <ActionButton
                        icon={<ShieldCheck className="h-3.5 w-3.5" />}
                        label={copy('管理权限', 'Manage permissions')}
                        disabled={busyId !== null || !selected || !workspaceRoot}
                        onClick={() => {
                          if (!selected) return
                          setPermissionEditorId((current) => current === entry.id ? null : entry.id)
                          setPermissionDraft(
                            (entry.workspaceGrantedPermissions ?? selected.grantedPermissions).filter((permission) =>
                              selected.requestedPermissions.includes(permission))
                          )
                        }}
                      />
                      {selected ? (selected.views ?? []).map((view) => {
                        const canOpen = enabled && entry.workspaceTrusted !== false &&
                          (entry.workspaceGrantedPermissions ?? selected.grantedPermissions).includes('ui.views') &&
                          (entry.workspaceGrantedPermissions ?? selected.grantedPermissions).includes('webview')
                        return (
                          <ActionButton
                            key={`${view.point}:${view.id}`}
                            icon={<PanelTop className="h-3.5 w-3.5" />}
                            label={canOpen
                              ? copy(`打开 ${view.title}`, `Open ${view.title}`)
                              : copy(`授权后打开 ${view.title}`, `Authorize to open ${view.title}`)}
                            disabled={busyId !== null || !selected || !workspaceRoot || !entry.globallyEnabled}
                            onClick={() => {
                              if (canOpen) {
                                void openView(entry.id, `extension:${entry.id}/${view.id}`)
                                return
                              }
                              setPermissionEditorId(entry.id)
                              setPermissionDraft(selected.requestedPermissions)
                            }}
                          />
                        )
                      }) : null}
                      <ActionButton icon={<Trash2 className="h-3.5 w-3.5" />} label={copy('卸载', 'Uninstall')} disabled={busyId !== null} danger onClick={() => void uninstall(entry)} />
                    </div>
                    {selected?.requestedPermissions.length ? <div className="mt-3 text-[10.5px] text-ds-faint">{copy('请求权限：', 'Requested permissions: ')}{selected.requestedPermissions.map((permission) => boundedText(permission, 256)).join(', ')}</div> : null}
                    {permissionEditorId === entry.id && selected && workspaceRoot ? (
                      <PermissionEditor
                        requested={selected.requestedPermissions}
                        selected={permissionDraft}
                        copy={copy}
                        disabled={busyId !== null}
                        onToggle={(permission) => setPermissionDraft((current) =>
                          current.includes(permission)
                            ? current.filter((item) => item !== permission)
                            : [...current, permission].sort()
                        )}
                        onCancel={() => setPermissionEditorId(null)}
                        onApply={() => void run(
                          entry.id,
                          () => extensionWorkbenchClient.setPermissions(
                            entry.id,
                            selected.version,
                            permissionDraft,
                            workspaceRoot
                          ),
                          copy('权限已更新。', 'Permissions updated.')
                        ).then((applied) => {
                          if (applied) setPermissionEditorId(null)
                        })}
                      />
                    ) : null}
                    {selected ? (
                      <ExtensionAccountManagement
                        extensionId={entry.id}
                        version={selected}
                        workspaceRoot={workspaceRoot}
                        disabled={busyId !== null || (Boolean(workspaceRoot) && entry.workspaceTrusted === false)}
                        copy={copy}
                      />
                    ) : null}
                  </article>
                )
              })}
              {!loading && sortedEntries.length === 0 ? <EmptyState text={copy('尚未安装 .kunx 扩展。', 'No .kunx extensions are installed.')} /> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function InstallCard({ icon, title, description, action, disabled, onClick }: { icon: ReactElement; title: string; description: string; action: string; disabled: boolean; onClick: () => void }): ReactElement {
  return <div className="rounded-xl border border-ds-border bg-ds-card p-4"><div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">{icon}{title}</div><p className="mt-2 min-h-20 text-[11px] leading-5 text-ds-faint">{description}</p><button type="button" disabled={disabled} onClick={onClick} className="mt-3 w-full rounded-lg border border-ds-border px-3 py-2 text-[11px] font-semibold text-ds-ink hover:bg-ds-hover disabled:opacity-50">{action}</button></div>
}

function ExtensionCardLogo({ extensionId, icon }: {
  extensionId: string
  icon?: string
}): ReactElement {
  const [failed, setFailed] = useState(false)
  const src = extensionCardLogoUrl(extensionId, icon)
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent/10 text-accent">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className="h-8 w-8 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Puzzle className="h-5 w-5" aria-hidden />
      )}
    </div>
  )
}

function ActionButton({ icon, label, disabled = false, danger = false, onClick }: { icon: ReactElement; label: string; disabled?: boolean; danger?: boolean; onClick?: () => void }): ReactElement {
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-[10.5px] font-semibold hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'}`}>{icon}{label}</button>
}

function PermissionEditor({
  requested,
  selected,
  disabled,
  copy,
  onToggle,
  onCancel,
  onApply
}: {
  requested: string[]
  selected: string[]
  disabled: boolean
  copy: (zh: string, en: string) => string
  onToggle: (permission: string) => void
  onCancel: () => void
  onApply: () => void
}): ReactElement {
  return (
    <section className="mt-3 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/15">
      <div className="text-[11px] font-semibold text-ds-ink">
        {copy('工作区 Broker 权限', 'Workspace Broker permissions')}
      </div>
      <p className="mt-1 text-[10.5px] leading-5 text-ds-muted">
        {copy('选择只会缩小或恢复 Manifest 请求的权限。应用时，Main 会在不加载扩展内容的受保护窗口中再次显示实际参数并要求确认。Node 直接访问仍不受这些 Broker 权限约束。', 'Selections can only narrow or restore Manifest-requested permissions. Applying opens a protected Main-owned review showing the actual parameters, with no extension content attached. Direct Node access is still outside these Broker grants.')}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {requested.map((permission) => (
          <label key={permission} className="flex items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-2.5 py-2 text-[10.5px] text-ds-muted">
            <input
              type="checkbox"
              checked={selected.includes(permission)}
              disabled={disabled}
              onChange={() => onToggle(permission)}
            />
            <span className="min-w-0 truncate font-mono" title={boundedText(permission, 256)}>
              {boundedText(permission, 256)}
            </span>
          </label>
        ))}
        {requested.length === 0 ? (
          <div className="text-[10.5px] text-ds-faint">{copy('此版本未请求 Broker 权限。', 'This version requests no Broker permissions.')}</div>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={disabled} onClick={onCancel} className="rounded-lg border border-ds-border px-3 py-1.5 text-[10.5px] font-semibold text-ds-muted hover:bg-ds-hover disabled:opacity-50">
          {copy('取消', 'Cancel')}
        </button>
        <button type="button" disabled={disabled} onClick={onApply} className="rounded-lg bg-accent px-3 py-1.5 text-[10.5px] font-semibold text-white disabled:opacity-50">
          {copy('在受保护窗口审核并应用', 'Review and apply in protected window')}
        </button>
      </div>
    </section>
  )
}

function DiagnosticCard({ entry, diagnostic, seed, copy, onOpenLogs }: {
  entry: ExtensionManagementEntry
  diagnostic?: ExtensionHostDiagnostic
  seed?: BundledExtensionSeedDiagnostic
  copy: (zh: string, en: string) => string
  onOpenLogs: () => void
}): ReactElement {
  const state = diagnostic?.lifecycleState ?? 'inactive'
  const seedNeedsAttention = seed?.outcome === 'failed' || seed?.outcome.startsWith('skipped-')
  return (
    <article className="rounded-xl border border-ds-border bg-ds-card p-4">
      <div className="flex items-center gap-3">
        <Bug className="h-5 w-5 text-ds-faint" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ds-ink">{entry.id}</div>
          <div className="mt-0.5 text-[10.5px] text-ds-faint">
            {state} · {copy('重启', 'restarts')} {diagnostic?.restartCount ?? 0} · {diagnostic?.circuitOpen ? copy('熔断已打开', 'circuit open') : copy('熔断关闭', 'circuit closed')}
          </div>
        </div>
        <ActionButton icon={<Archive className="h-3.5 w-3.5" />} label={copy('日志', 'Logs')} onClick={onOpenLogs} />
      </div>
      {seed ? (
        <div className={`mt-3 rounded-lg px-3 py-2 text-[10.5px] leading-5 ${seedNeedsAttention ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'}`}>
          <strong>{copy('内置扩展更新', 'Bundled extension update')}:</strong>{' '}
          {boundedText(seed.outcome, 128)} · v{boundedText(seed.version, 128)}
          {seed.outcome === 'skipped-permission-change'
            ? ` — ${copy('新版本请求的权限发生变化，请在扩展中心审核后手动安装。', 'The new version changes requested permissions; review and install it manually in the Extension Center.')}`
            : ''}
          {seed.code ? ` (${boundedText(seed.code, 128)})` : ''}
          {seed.message ? ` — ${boundedText(seed.message)}` : ''}
        </div>
      ) : null}
      {diagnostic?.lastError?.message ? (
        <div className="mt-3 rounded-lg bg-red-500/8 px-3 py-2 text-[10.5px] leading-5 text-red-700 dark:text-red-200">
          {boundedText(diagnostic.lastError.code, 128)}: {boundedText(diagnostic.lastError.message)}
        </div>
      ) : null}
      {diagnostic?.logPath ? (
        <div className="mt-2 truncate font-mono text-[10px] text-ds-faint" title={boundedText(diagnostic.logPath)}>
          {boundedText(diagnostic.logPath)}
        </div>
      ) : null}
    </article>
  )
}

function EmptyState({ text }: { text: string }): ReactElement {
  return <div className="rounded-xl border border-dashed border-ds-border px-6 py-12 text-center text-[12px] text-ds-faint">{text}</div>
}
