import { useEffect, useState, type ReactElement } from 'react'
import { Info, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitBranchComparison, GitWorkingState } from '@shared/git-commit'
import { GitChangeRow } from './GitChangeRow'
import { GitDiffPreview } from './GitDiffPreview'
import { gitCommitApi } from './use-git-working-state'

type ReadyState = Extract<GitWorkingState, { ok: true }>

/** Read-only view of everything on the branch since it forked from its base. */
export function GitBranchView({
  workspaceRoot,
  state,
  revision
}: {
  workspaceRoot: string
  state: ReadyState
  revision: number
}): ReactElement {
  const { t } = useTranslation('common')
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    const api = gitCommitApi()
    if (!api) return
    let cancelled = false
    void api.getGitBranchComparison(workspaceRoot).then((value) => {
      if (!cancelled) setComparison(value)
    }).catch((error: unknown) => {
      if (!cancelled) setComparison({ ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      cancelled = true
    }
  }, [workspaceRoot, revision])

  if (!comparison) {
    return (
      <div className="flex h-full items-center justify-center text-ds-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }
  if (!comparison.ok) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-ds-muted">
        {comparison.reason === 'no_base' ? t('changesBranchNoBase') : comparison.message}
      </div>
    )
  }
  const selected = comparison.files.find((file) => file.path === selectedPath) ?? comparison.files[0]
  return (
    <div className="flex h-full min-h-0 flex-col" data-git-branch-view={comparison.base}>
      <div className="mx-3 mt-2.5 flex shrink-0 items-start gap-2 rounded-[8px] bg-ds-hover px-2.5 py-1.5 text-[11.5px] leading-4 text-ds-muted">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span>
          {t('changesBranchCompare', {
            base: comparison.base,
            sha: comparison.mergeBase.slice(0, 7),
            ahead: comparison.ahead,
            behind: comparison.behind
          })}{' '}
          {t('changesBranchReadOnly')}
        </span>
      </div>
      <div className="shrink-0 px-3 pb-1 pt-2 text-[11px] font-semibold text-ds-muted">
        {t('changesSectionFiles', { count: comparison.files.length })}
      </div>
      <ul className="m-0 max-h-[32%] shrink-0 list-none overflow-y-auto px-1 py-0" aria-label={t('changesSourceBranch')}>
        {comparison.files.map((file) => (
          <GitChangeRow
            key={`${file.previousPath ?? ''}\n${file.path}`}
            entry={file}
            selected={file.path === selected?.path}
            statusLabel={t(`changesStatus.${file.status}`)}
            onSelect={() => setSelectedPath(file.path)}
          />
        ))}
      </ul>
      {comparison.commits.length ? (
        <>
          <div className="shrink-0 px-3 pb-1 pt-2.5 text-[11px] font-semibold text-ds-muted">
            {t('changesSectionCommits', { base: comparison.base, count: comparison.ahead })}
          </div>
          <ul className="m-0 max-h-[22%] shrink-0 list-none overflow-y-auto px-3 py-0">
            {comparison.commits.map((commit) => (
              <li key={commit.sha} className="flex h-[26px] items-center gap-2 text-[12px]">
                <span className="shrink-0 font-mono text-[11px] text-ds-muted">{commit.sha.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-ds-ink" title={commit.subject}>{commit.subject}</span>
                {!commit.pushed && state.pushRemote ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10.5px] leading-[18px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                    {t('changesCommitUnpushed')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="min-h-[120px] flex-1 px-3 pb-1 pt-2">
        {selected ? (
          <GitDiffPreview
            workspaceRoot={workspaceRoot}
            side="branch"
            entry={selected}
            mergeBase={comparison.mergeBase}
            revision={revision}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-ds-muted">{t('changesDiffEmpty')}</div>
        )}
      </div>
    </div>
  )
}
