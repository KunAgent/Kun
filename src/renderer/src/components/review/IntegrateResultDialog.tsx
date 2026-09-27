import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Loader2, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  TaskWorkspaceIntegrateMode,
  TaskWorkspaceIntegrateResponse,
  TaskWorkspaceRecord
} from '@shared/task-workspace'
import { cleanupWorkspace, useReviewStore } from '../../store/review-store'
import { openTerminalAt } from '../terminal/terminal-open'

/**
 * Result of a user-initiated integrate (docs/ade/11 §7.1): success offers
 * non-destructive worktree cleanup; `needs_human`/`conflict` explain the
 * reason with recovery steps and a "open this worktree in a terminal"
 * escape hatch that lands in the in-app terminal panel.
 */
export function IntegrateResultDialog({
  binding,
  mode,
  response,
  onClose
}: {
  binding: TaskWorkspaceRecord
  mode: TaskWorkspaceIntegrateMode
  response: TaskWorkspaceIntegrateResponse
  onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const cleaningUp = useReviewStore(
    (s) => s.workspaces[binding.workspaceId]?.actionPending === 'cleanup'
  )
  const done = response.outcome === 'applied' || response.outcome === 'merged'
  const modeLabel =
    mode === 'merge-branch' ? t('reviewMergeBranch') : t('reviewApplyPatch')
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/35"
      role="dialog"
      aria-label={t('reviewIntegrateResultTitle')}
    >
      <div className="w-[380px] rounded-[12px] border border-ds-border bg-white p-4 shadow-xl dark:bg-ds-card">
        <div className="flex items-center gap-2">
          {done ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={1.8} />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={1.8} />
          )}
          <div className="text-[13px] font-semibold text-ds-ink">
            {done
              ? t('reviewIntegrateDone', { mode: modeLabel })
              : response.outcome === 'needs_human'
                ? t('reviewIntegrateNeedsHuman')
                : t('reviewIntegrateConflict')}
          </div>
        </div>

        {response.reason ? (
          <p className="mt-2 break-words text-[12px] text-ds-muted">{response.reason}</p>
        ) : null}

        {response.recovery?.length ? (
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11.5px] text-ds-muted">
            {response.recovery.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}

        <div className="mt-3 flex items-center justify-end gap-2">
          {!done && binding.path ? (
            <button
              type="button"
              onClick={() => openTerminalAt(binding.path)}
              className="mr-auto inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-ds-border-muted px-2.5 text-[11.5px] text-ds-muted hover:text-ds-ink"
            >
              <TerminalSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('reviewOpenInTerminal')}
            </button>
          ) : null}
          {done && response.record.state === 'integrated' ? (
            <button
              type="button"
              disabled={cleaningUp}
              onClick={() => {
                void cleanupWorkspace(binding.workspaceId).then(() => onClose())
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-ds-border-muted px-2.5 text-[11.5px] text-ds-muted hover:text-ds-ink disabled:opacity-50"
            >
              {cleaningUp ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : null}
              {t('reviewCleanup')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-[7px] bg-sky-600 px-3 text-[11.5px] font-medium text-white hover:bg-sky-500"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
