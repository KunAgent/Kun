import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Archive, Folder, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { NormalizedThread } from '../agent/types'
import { confirmDialog } from '../lib/confirm-dialog'
import { formatRelativeTime } from '../lib/format-relative-time'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { SettingsCard, SettingRow } from './settings-controls'

export function filterArchivedThreads(threads: NormalizedThread[], query: string): NormalizedThread[] {
  const normalizedQuery = query.trim().toLowerCase()
  return threads
    .filter((thread) => thread.archived === true)
    .filter((thread) => {
      if (!normalizedQuery) return true
      return [
        thread.title,
        thread.preview,
        thread.workspace,
        workspaceLabelFromPath(thread.workspace ?? ''),
        thread.model,
        thread.mode
      ].some((value) => value?.toLowerCase().includes(normalizedQuery))
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

function groupArchivedThreads(threads: NormalizedThread[]): Array<[string, NormalizedThread[]]> {
  const groups = new Map<string, NormalizedThread[]>()
  for (const thread of threads) {
    const workspace = thread.workspace?.trim() || ''
    const key = workspace || workspaceLabelFromPath('')
    const existing = groups.get(key) ?? []
    existing.push(thread)
    groups.set(key, existing)
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

export function ArchivedThreadsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    threads,
    runtimeReady,
    locale,
    refreshThreads,
    openCode,
    selectThread,
    archiveThread,
    deleteThread
  } = ctx

  const [query, setQuery] = useState('')
  const [busyThreadIds, setBusyThreadIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!runtimeReady || typeof refreshThreads !== 'function') return
    void refreshThreads()
  }, [refreshThreads, runtimeReady])

  const archivedThreads = useMemo(
    () => filterArchivedThreads(Array.isArray(threads) ? threads : [], query),
    [query, threads]
  )
  const groups = useMemo(() => groupArchivedThreads(archivedThreads), [archivedThreads])
  const totalArchived = (Array.isArray(threads) ? threads : []).filter((thread) => thread.archived === true).length

  const runThreadAction = async (threadId: string, action: () => Promise<void>): Promise<void> => {
    setBusyThreadIds((current) => ({ ...current, [threadId]: true }))
    try {
      await action()
    } finally {
      setBusyThreadIds((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
    }
  }

  const openThread = async (threadId: string): Promise<void> => {
    await runThreadAction(threadId, async () => {
      if (typeof openCode === 'function') await openCode()
      if (typeof selectThread === 'function') await selectThread(threadId)
    })
  }

  const restoreThread = async (threadId: string): Promise<void> => {
    await runThreadAction(threadId, async () => {
      if (typeof archiveThread === 'function') await archiveThread(threadId, false)
    })
  }

  const removeThread = async (thread: NormalizedThread): Promise<void> => {
    const ok = await confirmDialog(
      t('archivesDeleteConfirmTitle', { title: thread.title }),
      t('archivesDeleteConfirmDesc')
    )
    if (!ok) return
    await runThreadAction(thread.id, async () => {
      if (typeof deleteThread === 'function') await deleteThread(thread.id)
    })
  }

  const emptyMessage = !runtimeReady
    ? t('archivesOffline')
    : query.trim()
      ? t('archivesSearchEmpty')
      : t('archivesEmpty')

  return (
    <SettingsCard title={t('archivesTitle')}>
      <SettingRow
        title={t('archivesOverview')}
        description={t('archivesOverviewDesc')}
        wideControl
        control={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-ds-border bg-ds-main/70 px-3 py-2 shadow-sm">
                <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.75} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('archivesSearchPlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
                />
              </label>
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-ds-border-muted bg-ds-main/50 px-3 py-2 text-[12px] font-medium text-ds-muted">
                <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('archivesCount', { count: totalArchived })}
              </div>
            </div>

            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ds-border-muted bg-ds-main/40 px-4 py-10 text-center">
                <Archive className="h-7 w-7 text-ds-faint" strokeWidth={1.5} />
                <div className="text-[13px] text-ds-faint">{emptyMessage}</div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/35">
                {groups.map(([workspace, items]) => (
                  <div key={workspace} className="border-b border-ds-border-muted last:border-b-0">
                    <div className="flex items-center justify-between gap-2 bg-ds-hover/30 px-3 py-2 text-[12px] text-ds-faint">
                      <div className="flex min-w-0 items-center gap-2">
                        <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                        <span className="truncate font-medium text-ds-muted">
                          {workspaceLabelFromPath(workspace)}
                        </span>
                      </div>
                      <span>{t('archivesWorkspaceCount', { count: items.length })}</span>
                    </div>
                    {items.map((thread) => {
                      const busy = busyThreadIds[thread.id] === true
                      return (
                        <div
                          key={thread.id}
                          className="flex flex-col gap-3 border-t border-ds-border-muted px-3 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => void openThread(thread.id)}
                          >
                            <div className="truncate text-[14px] font-semibold text-ds-ink">
                              {thread.title || t('archivesUntitled')}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ds-faint">
                              <span>{formatRelativeTime(thread.updatedAt, locale)}</span>
                              <span>·</span>
                              <span className="truncate">{thread.model || 'auto'}</span>
                            </div>
                            {thread.preview ? (
                              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-ds-muted">
                                {thread.preview}
                              </div>
                            ) : null}
                          </button>
                          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                            <button
                              type="button"
                              disabled={busy || !runtimeReady}
                              onClick={() => void restoreThread(thread.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-ds-hover px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-subtle hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                              {t('archivesRestore')}
                            </button>
                            <button
                              type="button"
                              disabled={busy || !runtimeReady}
                              onClick={() => void removeThread(thread)}
                              aria-label={t('archivesDelete')}
                              title={t('archivesDelete')}
                              className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            <p className="text-[12px] leading-5 text-ds-faint">
              {tCommon('sidebarThreadRestore')} / {tCommon('sidebarThreadDelete')}
            </p>
          </div>
        }
      />
    </SettingsCard>
  )
}
