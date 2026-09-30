import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskWorkspaceRecord } from '@shared/task-workspace'
import { useReviewStore } from '../../store/review-store'

export function ReviewRevisionSummary({ binding }: { binding: TaskWorkspaceRecord }): ReactElement {
  const { t } = useTranslation('common')
  const revision = useReviewStore((s) => s.workspaces[binding.workspaceId]?.revision)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ds-border-muted px-3 py-1.5 text-[11px] text-ds-muted">
      <span className="min-w-0 break-all" title={binding.path}>
        {t('reviewScopeWorkspace')}: {binding.label || binding.branch || binding.workspaceId}
      </span>
      <span className="min-w-0 break-all" title={binding.sourceRoot}>
        {t('reviewScopeTarget')}: {binding.targetBranch || binding.sourceRoot}
      </span>
      <span className="font-mono" title={revision?.contentHash}>
        {revision?.completeness === 'complete' && revision.contentHash
          ? t('reviewContentVersion', { version: revision.contentHash.slice(0, 8) })
          : t('reviewRevision_unknown')}
      </span>
    </div>
  )
}
