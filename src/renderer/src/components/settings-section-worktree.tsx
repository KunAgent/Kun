import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { GitBranch, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { NormalizedThread } from '../agent/types'
import type { GitBranchWorktreeRow, GitBranchWorktreesResult } from '@shared/git-branches'
import { DEFAULT_GIT_BRANCH_PREFIX } from '@shared/app-settings'
import { readThreadWorktreeRegistry } from '../lib/thread-worktree-registry'
import { SettingsCard, SettingRow } from './settings-controls'

type WorktreeDisplayRow = GitBranchWorktreeRow & {
  threadTitle: string
  createdAt: string
}

export function WorktreeSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t } = ctx
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

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectPath) return
    setLoading(true)
    setError(null)
    try {
      const next = await window.kunGui.listGitBranchWorktrees({
        projectPath,
        worktreeRoot
      })
      setResult(next)
      if (!next.ok) setError(next.message)
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
