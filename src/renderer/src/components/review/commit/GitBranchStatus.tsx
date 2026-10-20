import type { ReactElement } from 'react'
import { GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitWorkingState } from '@shared/git-commit'

type ReadyState = Extract<GitWorkingState, { ok: true }>

/** Branch, its upstream and ahead / behind counts, under the source picker. */
export function GitBranchStatus({ state }: { state: ReadyState }): ReactElement {
  const { t } = useTranslation('common')
  const aheadBehind = state.upstream
    ? t('changesAheadBehind', { ahead: state.ahead, behind: state.behind, upstream: state.upstream })
    : ''
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-ds-muted" data-git-branch-status>
      <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate font-mono text-ds-ink" title={state.branch ?? state.head ?? ''}>
        {state.branch ?? t('changesDetached', { sha: state.head ?? '' })}
      </span>
      {state.upstream ? (
        <span className="min-w-0 shrink truncate" title={state.upstream}>→ {state.upstream}</span>
      ) : state.branch && state.pushRemote ? (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 leading-5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
          {t('changesNoUpstream')}
        </span>
      ) : null}
      {state.upstream ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5" title={aheadBehind} aria-label={aheadBehind}>
          <span className="text-ds-ink">↑{state.ahead}</span>
          <span className={state.behind ? 'text-amber-700 dark:text-amber-300' : ''}>↓{state.behind}</span>
        </span>
      ) : null}
    </div>
  )
}
