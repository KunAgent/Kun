import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { CheckCircle2, GitBranch, GitMerge, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { MAX_WORKTREE_POOL_SIZE, parseWorktreeHasChangesError } from '@shared/worktree'
import type { WorktreePoolStatus } from '@shared/worktree'
import { useWorktreeStore } from '../stores/worktree-store'
import { SettingsCard, SettingRow } from './settings-controls'

export function WorktreeSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t } = ctx
  const { poolStatus, loading, error, lastMergeResult, lastSyncResult, setPoolStatus, setLoading, setError, setLastMergeResult, setLastSyncResult } =
    useWorktreeStore()
  const [busyPool, setBusyPool] = useState<number | null>(null)
  const [projectPath, setProjectPath] = useState<string>('')

  // Resolve current workspace root from the settings form.
  const worktreeRoot: string | undefined = ctx.form?.worktreeRootPath || undefined

  const refresh = useCallback(async () => {
    const path = ctx.form?.workspaceRoot || ctx.kun?.workspaceRoot || ''
    if (!path) return
    setProjectPath(path)
    setLoading(true)
    setError(null)
    try {
      const status: WorktreePoolStatus = await window.kunGui.listWorktrees({
        projectPath: path,
        worktreeRoot
      })
      setPoolStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPoolStatus(null)
    } finally {
      setLoading(false)
    }
  }, [ctx.form, ctx.kun, worktreeRoot, setLoading, setError, setPoolStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAcquire = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    setError(null)
    try {
      await window.kunGui.acquireWorktree({
        projectPath,
        poolIndex,
        taskId: `manual-${Date.now()}`,
        worktreeRoot
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleForceAcquire = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    setError(null)
    try {
      await window.kunGui.acquireWorktree({
        projectPath,
        poolIndex,
        taskId: `manual-${Date.now()}`,
        force: true,
        worktreeRoot
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleRelease = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    try {
      await window.kunGui.releaseWorktree({ projectPath, poolIndex })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleRemove = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    try {
      await window.kunGui.removeWorktree({ projectPath, poolIndex, worktreeRoot })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleMerge = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    setLastMergeResult(null)
    try {
      const result = await window.kunGui.mergeWorktree({ projectPath, poolIndex, worktreeRoot })
      setLastMergeResult(result)
      if (result.success) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleSync = async (poolIndex: number): Promise<void> => {
    setBusyPool(poolIndex)
    setLastSyncResult(null)
    try {
      const result = await window.kunGui.syncWorktreeFromMain({ projectPath, poolIndex, worktreeRoot })
      setLastSyncResult(result)
      if (result.success) await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleCleanup = async (): Promise<void> => {
    setBusyPool(-1)
    try {
      await window.kunGui.cleanupWorktrees({ projectPath, worktreeRoot })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPool(null)
    }
  }

  const handleAcquireClick = async (poolIndex: number): Promise<void> => {
    setError(null)
    // Try normal acquire first; if it fails with WORKTREE_HAS_CHANGES, the UI
    // will show a confirm to force-reset.
    setBusyPool(poolIndex)
    try {
      await window.kunGui.acquireWorktree({
        projectPath,
        poolIndex,
        taskId: `manual-${Date.now()}`,
        worktreeRoot
      })
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const parsed = parseWorktreeHasChangesError(msg)
      if (parsed) {
        const ok = window.confirm(
          t('worktreeForceConfirm').replace('{{count}}', String(parsed.changesCount))
        )
        if (ok) {
          await handleForceAcquire(poolIndex)
        }
      } else {
        setError(msg)
      }
    } finally {
      setBusyPool(null)
    }
  }

  const pools = poolStatus?.worktrees ?? []
  const poolByIndex = (i: number) => pools.find((w) => w.poolIndex === i)

  return (
    <SettingsCard title={t('sectionWorktree')}>
      <SettingRow
        title={t('worktreeOverview')}
        description={t('worktreeOverviewDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-3">
            {/* Overview stats */}
            <div className="grid grid-cols-4 gap-2 text-[12px]">
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="text-ds-faint">{t('worktreeMainBranch')}</div>
                <div className="mt-0.5 truncate font-mono text-[13px] font-semibold text-ds-ink">
                  {poolStatus?.mainBranch ?? '—'}
                </div>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="text-ds-faint">{t('worktreeInUse')}</div>
                <div className="mt-0.5 font-mono text-[15px] font-semibold text-ds-ink">
                  {poolStatus?.inUseCount ?? 0} / {MAX_WORKTREE_POOL_SIZE}
                </div>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="text-ds-faint">{t('worktreePoolDir')}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-ds-muted" title={poolStatus?.poolDir}>
                  {poolStatus?.poolDir ?? '—'}
                </div>
              </div>
              <div className="flex items-end justify-end">
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
            </div>

            {poolStatus?.isGitRepo === false ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                {t('worktreeNotGitRepo')}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </div>
            ) : null}

            {/* Pool cards */}
            <div className="flex flex-col gap-2">
              {Array.from({ length: MAX_WORKTREE_POOL_SIZE }, (_, i) => {
                const wt = poolByIndex(i)
                const isBusy = busyPool === i
                return (
                  <div
                    key={i}
                    className={`rounded-xl border px-3 py-2.5 transition ${
                      wt?.inUse
                        ? 'border-ds-ink/30 bg-ds-subtle/50'
                        : 'border-ds-border-muted bg-ds-main/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <GitBranch className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                            <span>
                              {t('worktreePool')} {i}
                            </span>
                            {wt?.inUse ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {t('worktreeBusy')}
                              </span>
                            ) : wt ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-ds-hover/60 px-2 py-0.5 text-[10px] font-medium text-ds-muted">
                                {t('worktreeIdle')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-ds-hover/30 px-2 py-0.5 text-[10px] font-medium text-ds-faint">
                                {t('worktreeEmpty')}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-ds-faint" title={wt?.path}>
                            {wt ? wt.path : t('worktreeNotCreated')}
                            {wt && wt.changesCount > 0 ? (
                              <span className="ml-2 text-amber-600 dark:text-amber-400">
                                · {wt.changesCount} {t('worktreeUncommitted')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-muted" strokeWidth={1.8} />}
                        {!wt && !isBusy && (
                          <button
                            type="button"
                            onClick={() => void handleAcquireClick(i)}
                            className="rounded-lg px-2 py-1 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover"
                          >
                            {t('worktreeCreate')}
                          </button>
                        )}
                        {wt && !wt.inUse && !isBusy && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleMerge(i)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                              title={t('worktreeMergeTitle')}
                            >
                              <GitMerge className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSync(i)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                              title={t('worktreeSyncTitle')}
                            >
                              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemove(i)}
                              className="rounded-lg p-1 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                              title={t('worktreeRemove')}
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                          </>
                        )}
                        {wt?.inUse && !isBusy && (
                          <button
                            type="button"
                            onClick={() => void handleRelease(i)}
                            className="rounded-lg px-2 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          >
                            {t('worktreeRelease')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Merge / Sync result feedback */}
            {lastMergeResult && (
              <div
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] ${
                  lastMergeResult.success
                    ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300'
                }`}
              >
                {lastMergeResult.success ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{lastMergeResult.message}</div>
                  {lastMergeResult.conflictedFiles.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-[11px] opacity-80">
                      {lastMergeResult.conflictedFiles.slice(0, 5).map((f) => (
                        <li key={f} className="truncate font-mono">
                          {f}
                        </li>
                      ))}
                      {lastMergeResult.conflictedFiles.length > 5 && (
                        <li>… +{lastMergeResult.conflictedFiles.length - 5}</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {lastSyncResult && (
              <div
                className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] ${
                  lastSyncResult.success
                    ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-500/10 dark:text-emerald-300'
                    : 'border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300'
                }`}
              >
                {lastSyncResult.success ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{lastSyncResult.message}</div>
                  {lastSyncResult.conflictedFiles.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-[11px] opacity-80">
                      {lastSyncResult.conflictedFiles.slice(0, 5).map((f) => (
                        <li key={f} className="truncate font-mono">
                          {f}
                        </li>
                      ))}
                      {lastSyncResult.conflictedFiles.length > 5 && (
                        <li>… +{lastSyncResult.conflictedFiles.length - 5}</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Cleanup button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleCleanup()}
                disabled={busyPool === -1 || pools.length === 0}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('worktreeCleanupAll')}
              </button>
            </div>
          </div>
        }
      />
    </SettingsCard>
  )
}
