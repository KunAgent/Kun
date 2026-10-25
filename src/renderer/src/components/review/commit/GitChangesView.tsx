import { useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, Minus, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitChangeEntry, GitWorkingState } from '@shared/git-commit'
import { GitChangeRow, GitRowAction } from './GitChangeRow'
import { GitDiffPreview } from './GitDiffPreview'
import { GitDiscardDialog } from './GitDiscardDialog'
import { GitErrorCard, type GitErrorInfo } from './GitErrorCard'
import { gitCommitApi } from './use-git-working-state'

type ReadyState = Extract<GitWorkingState, { ok: true }>

/** Unstaged or staged files with per-file and bulk actions, above a diff of the selected file. */
export function GitChangesView({
  workspaceRoot,
  side,
  state,
  revision,
  onChanged
}: {
  workspaceRoot: string
  side: 'unstaged' | 'staged'
  state: ReadyState
  revision: number
  onChanged: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const entries = side === 'staged' ? state.staged : state.unstaged
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [discarding, setDiscarding] = useState<GitChangeEntry[] | null>(null)
  const [error, setError] = useState<GitErrorInfo | null>(null)
  const selected = entries.find((entry) => entry.path === selectedPath) ?? entries[0]

  useEffect(() => {
    setError(null)
  }, [side, workspaceRoot])

  const run = async (task: () => Promise<{ ok: boolean; message?: string; output?: string }>): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await task()
      if (!result.ok) {
        setError({ title: t('changesOperationFailed'), hint: result.message ?? '', output: result.output })
      } else {
        setError(null)
      }
      return result.ok
    } catch (failure) {
      setError({ title: t('changesOperationFailed'), hint: failure instanceof Error ? failure.message : String(failure) })
      return false
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const api = gitCommitApi()
  const stage = (paths?: string[]): void => {
    if (api) void run(() => api.stageGitPaths({ workspaceRoot, ...(paths ? { paths } : {}) }))
  }
  const unstage = (paths?: string[]): void => {
    if (api) void run(() => api.unstageGitPaths({ workspaceRoot, ...(paths ? { paths } : {}) }))
  }
  const confirmDiscard = (): void => {
    const targets = discarding
    if (!api || !targets) return
    void run(() => api.discardGitPaths({ workspaceRoot, paths: targets.map((entry) => entry.path), confirmed: true }))
      .then(() => setDiscarding(null))
  }
  const statusLabel = (entry: GitChangeEntry): string => t(`changesStatus.${entry.status}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center py-1.5 pl-3 pr-2">
        <span className="text-[11px] font-semibold text-ds-muted">
          {t(side === 'staged' ? 'changesSectionStaged' : 'changesSectionUnstaged', { count: entries.length })}
        </span>
        {entries.length ? (
          <div className="ml-auto flex items-center gap-0.5">
            {side === 'unstaged' ? (
              <>
                <GitRowAction label={t('changesDiscardAll')} disabled={busy} onClick={() => setDiscarding(entries.filter((entry) => entry.status !== 'conflicted'))}>
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                </GitRowAction>
                <GitRowAction label={t('changesStageAll')} disabled={busy} onClick={() => stage()}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                </GitRowAction>
              </>
            ) : (
              <GitRowAction label={t('changesUnstageAll')} disabled={busy} onClick={() => unstage()}>
                <Minus className="h-3.5 w-3.5" strokeWidth={1.8} />
              </GitRowAction>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="shrink-0 px-3 pb-2">
          <GitErrorCard error={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}

      {!entries.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-ds-muted">
          <CheckCircle2 className="h-6 w-6 text-ds-faint" strokeWidth={1.3} />
          <span className="text-[12px] font-medium">
            {side === 'staged' ? t('changesEmptyStaged') : t('changesCleanTree')}
          </span>
          {side === 'unstaged' && state.staged.length ? (
            <span className="text-[11px]">{t('changesStagedWaiting', { count: state.staged.length })}</span>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="m-0 max-h-[42%] shrink-0 list-none overflow-y-auto px-1 py-0" aria-label={t(side === 'staged' ? 'changesSourceStaged' : 'changesSourceUnstaged')}>
            {entries.map((entry) => (
              <GitChangeRow
                key={`${entry.previousPath ?? ''}\n${entry.path}`}
                entry={entry}
                selected={entry.path === selected?.path}
                statusLabel={statusLabel(entry)}
                onSelect={() => setSelectedPath(entry.path)}
                actions={side === 'unstaged' ? (
                  <>
                    <GitRowAction
                      label={entry.status === 'untracked' ? t('changesMoveToTrash') : t('changesDiscard')}
                      disabled={busy || entry.status === 'conflicted'}
                      onClick={() => setDiscarding([entry])}
                    >
                      <RotateCcw className="h-[13px] w-[13px]" strokeWidth={1.8} />
                    </GitRowAction>
                    <GitRowAction label={t('changesStage')} disabled={busy} onClick={() => stage([entry.path])}>
                      <Plus className="h-[13px] w-[13px]" strokeWidth={1.8} />
                    </GitRowAction>
                  </>
                ) : (
                  <GitRowAction
                    label={t('changesUnstage')}
                    disabled={busy}
                    onClick={() => unstage(entry.previousPath ? [entry.previousPath, entry.path] : [entry.path])}
                  >
                    <Minus className="h-[13px] w-[13px]" strokeWidth={1.8} />
                  </GitRowAction>
                )}
              />
            ))}
          </ul>
          {state.truncated ? (
            <p className="m-0 shrink-0 px-3 pt-1 text-[11px] text-ds-muted">{t('changesTruncated', { count: entries.length })}</p>
          ) : null}
          <div className="min-h-[120px] flex-1 px-3 pb-1 pt-2">
            {selected ? (
              <GitDiffPreview workspaceRoot={workspaceRoot} side={side} entry={selected} revision={revision} />
            ) : null}
          </div>
        </>
      )}

      {discarding ? (
        <GitDiscardDialog
          entries={discarding}
          busy={busy}
          onCancel={() => setDiscarding(null)}
          onConfirm={confirmDiscard}
        />
      ) : null}
    </div>
  )
}
