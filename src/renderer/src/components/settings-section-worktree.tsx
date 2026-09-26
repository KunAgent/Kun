import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { GitBranch, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { NormalizedThread } from '../agent/types'
import type { GitBranchWorktreeRow, GitBranchWorktreesResult } from '@shared/git-branches'
import type { KunWorktreeSharedPathV1 } from '@shared/app-settings'
import type { PreservedBranchInfo } from '@shared/task-workspace'
import { DEFAULT_GIT_BRANCH_PREFIX } from '@shared/app-settings'
import { getProvider } from '../agent/registry'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import { useChatStore } from '../store/chat-store'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

type WorktreeDisplayRow = GitBranchWorktreeRow & {
  threadTitle: string
  createdAt: string
}

export function WorktreeSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, kun, updateKun } = ctx
  const compactHomePath = typeof ctx.compactHomePath === 'function'
    ? ctx.compactHomePath as (path: string) => string
    : (path: string) => path
  const expandHomePath = typeof ctx.expandHomePath === 'function'
    ? ctx.expandHomePath as (path: string) => string
    : (path: string) => path
  const locale = String(ctx.locale || 'zh-CN')
  const threads = useMemo(() => (ctx.threads ?? []) as NormalizedThread[], [ctx.threads])
  const worktreeRoot = ctx.form?.worktreeRootPath
    ? expandHomePath(String(ctx.form.worktreeRootPath))
    : undefined
  const projectPath = expandHomePath(String(ctx.form?.workspaceRoot || ctx.kun?.workspaceRoot || '')).trim()
  const [result, setResult] = useState<GitBranchWorktreesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const composerIsolation = useChatStore((state) => state.composerIsolation)
  const setComposerIsolation = useChatStore((state) => state.setComposerIsolation)
  const [preserved, setPreserved] = useState<PreservedBranchInfo[] | null>(null)
  const sharedPaths = useMemo(
    () => (kun?.worktrees?.sharedPaths?.[projectPath] ?? []) as KunWorktreeSharedPathV1[],
    [kun?.worktrees?.sharedPaths, projectPath]
  )
  const [draftSharedPath, setDraftSharedPath] = useState('')
  const [draftSharedMode, setDraftSharedMode] = useState<KunWorktreeSharedPathV1['mode']>('symlink')

  const setSharedPaths = useCallback(
    (next: KunWorktreeSharedPathV1[]): void => {
      if (!projectPath) return
      const all = { ...(kun?.worktrees?.sharedPaths ?? {}) }
      if (next.length) all[projectPath] = next
      else delete all[projectPath]
      updateKun({ worktrees: { sharedPaths: all } })
    },
    [kun?.worktrees?.sharedPaths, projectPath, updateKun]
  )

  const loadPreserved = useCallback(async (): Promise<void> => {
    if (!projectPath || !getProvider().listPreservedBranches) {
      setPreserved(null)
      return
    }
    try {
      const response = await getProvider().listPreservedBranches!(projectPath)
      setPreserved(response.branches)
    } catch {
      setPreserved(null)
    }
  }, [projectPath])

  useEffect(() => {
    void loadPreserved()
  }, [loadPreserved])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = projectPath
        ? await window.kunGui.listGitBranchWorktrees({ projectPath, worktreeRoot })
        : null
      setResult(next)
      if (next && !next.ok) setError(next.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [projectPath, worktreeRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows = useMemo<WorktreeDisplayRow[]>(() => {
    if (!result?.ok) return []
    const registry = readThreadWorktreeRegistry().worktrees
    return result.worktrees.map((worktree) => {
      const record = Object.entries(registry).find(([, item]) => item.worktreePath === worktree.path)
      const thread = record ? threads.find((item) => item.id === record[0]) : null
      return {
        ...worktree,
        threadTitle: thread?.title?.trim() || '',
        createdAt: record?.[1]?.createdAt || ''
      }
    })
  }, [result, threads])

  const formatCreatedAt = (value: string): string => {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  const removeWorktree = async (path: string): Promise<void> => {
    if (!projectPath || !path) return
    setBusyPath(path)
    setError(null)
    try {
      await window.kunGui.removeGitBranchWorktree({
        workspaceRoot: projectPath,
        worktreePath: path
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPath(null)
    }
  }

  return (
    <SettingsCard title={t('sectionWorktree')}>
      <SettingRow
        title={t('labPlanWorktreeEnabled')}
        description={t('labPlanWorktreeEnabledDesc')}
        control={(
          <Toggle
            checked={kun?.planExecution?.useWorktreeByDefault !== false}
            ariaLabel={t('labPlanWorktreeEnabled')}
            onChange={(useWorktreeByDefault) => updateKun({
              planExecution: { useWorktreeByDefault }
            })}
          />
        )}
      />
      <SettingRow
        title={t('gitBranchPrefix')}
        description={t('gitBranchPrefixDesc')}
        control={
          <input
            className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
            value={String(ctx.form?.gitBranchPrefix ?? DEFAULT_GIT_BRANCH_PREFIX)}
            placeholder={DEFAULT_GIT_BRANCH_PREFIX}
            spellCheck={false}
            onChange={(event) => ctx.update({ gitBranchPrefix: event.target.value })}
          />
        }
      />
      <SettingRow
        title={t('adeSettings.defaultIsolation')}
        description={t('adeSettings.defaultIsolationDesc')}
        control={
          <select
            className="w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
            value={composerIsolation}
            onChange={(event) =>
              setComposerIsolation(event.target.value as 'local' | 'worktree')
            }
          >
            <option value="local">{t('adeSettings.isolationLocal')}</option>
            <option value="worktree">{t('adeSettings.isolationWorktree')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('adeSettings.sharedPathsTitle')}
        description={t('adeSettings.sharedPathsDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-2">
            {sharedPaths.map((entry, index) => (
              <div key={`${entry.path}-${index}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ds-ink" title={entry.path}>
                  {entry.path}
                </span>
                <span className="shrink-0 rounded-md bg-ds-main/70 px-1.5 py-0.5 font-mono text-[11px] text-ds-muted">
                  {entry.mode}
                </span>
                <button
                  type="button"
                  aria-label={t('adeSettings.sharedPathRemove')}
                  onClick={() => setSharedPaths(sharedPaths.filter((_, i) => i !== index))}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-red-600 transition hover:bg-red-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ))}
            {sharedPaths.length === 0 ? (
              <div className="text-[12px] text-ds-faint">{t('adeSettings.sharedPathsEmpty')}</div>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
                value={draftSharedPath}
                placeholder={t('adeSettings.sharedPathPlaceholder')}
                spellCheck={false}
                disabled={!projectPath}
                onChange={(event) => setDraftSharedPath(event.target.value)}
              />
              <select
                className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-2 py-2 text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
                value={draftSharedMode}
                onChange={(event) =>
                  setDraftSharedMode(event.target.value as KunWorktreeSharedPathV1['mode'])
                }
              >
                <option value="symlink">symlink</option>
                <option value="clone">clone</option>
                <option value="copy">copy</option>
              </select>
              <button
                type="button"
                disabled={!projectPath || !draftSharedPath.trim()}
                onClick={() => {
                  setSharedPaths([
                    ...sharedPaths,
                    { path: draftSharedPath.trim(), mode: draftSharedMode }
                  ])
                  setDraftSharedPath('')
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-ds-border-muted px-2.5 py-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('adeSettings.sharedPathAdd')}
              </button>
            </div>
            {!projectPath ? (
              <div className="text-[11px] text-ds-faint">{t('adeSettings.sharedPathsNoProject')}</div>
            ) : null}
          </div>
        }
      />
      <SettingRow
        title={t('adeSettings.preservedBranchesTitle')}
        description={t('adeSettings.preservedBranchesDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-1.5">
            {!preserved?.length ? (
              <div className="text-[12px] text-ds-faint">{t('adeSettings.preservedBranchesEmpty')}</div>
            ) : (
              preserved.map((branch) => (
                <div
                  key={branch.branch}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ds-border-muted bg-ds-main/40 px-3 py-2"
                >
                  <span className="min-w-0 truncate font-mono text-[12px] text-ds-ink" title={branch.branch}>
                    {branch.branch}
                  </span>
                  <span className="shrink-0 text-[11px] text-ds-faint">
                    {branch.lastCommit ? `${branch.lastCommit} · ` : ''}
                    {t('adeSettings.preservedBranchAheadBy', { count: branch.aheadBy })}
                  </span>
                </div>
              ))
            )}
          </div>
        }
      />
      <SettingRow
        title={t('worktreeOverview')}
        description={t('worktreeOverviewDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_auto] items-start gap-3">
              <div className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="text-[12px] text-ds-faint">{t('worktreePoolDir')}</div>
                <div
                  className="mt-0.5 truncate font-mono text-[12px] text-ds-muted"
                  title={result?.ok ? compactHomePath(result.worktreeRoot) : undefined}
                >
                  {result?.ok ? compactHomePath(result.worktreeRoot) : '-'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                {t('worktreeRefresh')}
              </button>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-ds-border-muted bg-ds-main/35">
              {rows.length === 0 ? (
                <div className="px-3 py-4 text-[13px] text-ds-faint">{t('worktreeEmptyList')}</div>
              ) : rows.map((row) => {
                const displayPath = compactHomePath(row.path)
                return (
                  <div key={row.path} className="border-b border-ds-border-muted px-3 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                          <GitBranch className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.8} />
                          <span className="truncate">{row.branch ?? 'DETACHED'}</span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[12px] text-ds-muted" title={displayPath}>
                          {displayPath}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ds-faint">
                          {row.createdAt ? (
                            <span>
                              {t('worktreeCreatedAt')}: {formatCreatedAt(row.createdAt)}
                            </span>
                          ) : null}
                          <span>
                            {t('worktreeConversation')}: {row.threadTitle || t('worktreeNoConversation')}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeWorktree(row.path)}
                        disabled={busyPath === row.path}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-45"
                      >
                        {busyPath === row.path ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        )}
                        {t('worktreeRemove')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        }
      />
    </SettingsCard>
  )
}
