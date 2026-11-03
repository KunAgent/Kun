import { useEffect, useId, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { GitTurnUndoPreflight } from '@shared/git-turn-undo'
import { isTurnUndoAvailable, preflightTurnUndoRange } from '../../store/turn-undo-store'
import { buildTurnUndoTarget } from '../../store/turn-undo-target'

const CONFLICT_PREVIEW_LIMIT = 3

type ChoiceState =
  | { phase: 'hidden' }
  | { phase: 'checking' }
  | { phase: 'ready'; preflight: GitTurnUndoPreflight }

/**
 * Edit-and-resend option: reset the conversation and the files later turns
 * changed, or the conversation only. Any unsafe file disables the file reset,
 * so resending falls back to conversation-only without writing anything.
 */
export function RewindFileResetChoice({
  blockId,
  resetFiles,
  onChange
}: {
  blockId: string
  resetFiles: boolean
  onChange: (resetFiles: boolean) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const name = useId()
  const [state, setState] = useState<ChoiceState>({ phase: 'hidden' })

  useEffect(() => {
    let cancelled = false
    onChange(false)
    const target = isTurnUndoAvailable() ? buildTurnUndoTarget(blockId, { untilEnd: true }) : null
    if (!target || target.files.length === 0) {
      setState({ phase: 'hidden' })
      return
    }
    setState({ phase: 'checking' })
    void preflightTurnUndoRange(target).then((preflight) => {
      if (cancelled) return
      if (!preflight || (preflight.safe.length === 0 && preflight.unsafe.length === 0)) {
        setState({ phase: 'hidden' })
        return
      }
      setState({ phase: 'ready', preflight })
      onChange(preflight.canUndo)
    })
    return () => {
      cancelled = true
    }
    // `onChange` is a state setter from the editing bubble.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId])

  if (state.phase === 'hidden') return null
  if (state.phase === 'checking') {
    return (
      <p className="mt-2 flex items-center gap-2 text-[12px] text-ds-faint" data-rewind-file-reset="checking">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t('rewindResetChecking')}
      </p>
    )
  }

  const { preflight } = state
  const blocked = preflight.unsafe.length > 0
  const fileCount = preflight.safe.length + preflight.unsafe.length
  const conflictPaths = preflight.unsafe.slice(0, CONFLICT_PREVIEW_LIMIT).map((file) => file.path)
  const optionClass = 'flex items-start gap-2.5 text-[13px] leading-5'
  return (
    <fieldset
      className="mt-2 flex min-w-0 max-w-[min(72%,640px)] flex-col gap-2.5 rounded-[14px] border border-ds-border bg-ds-card px-3.5 py-3 text-left"
      data-rewind-file-reset={blocked ? 'blocked' : 'ready'}
    >
      <legend className="px-1 text-[12px] font-semibold text-ds-muted">{t('rewindResetLegend')}</legend>
      <label className={`${optionClass} ${blocked ? 'text-ds-faint' : 'text-ds-ink'}`}>
        <input
          type="radio"
          name={name}
          className="mt-1"
          checked={resetFiles}
          disabled={blocked}
          onChange={() => onChange(true)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t('rewindResetFiles')}</span>
          <span className={blocked ? '' : 'text-ds-muted'}>
            {fileCount === 1 ? t('rewindResetFilesDetailOne') : t('rewindResetFilesDetailMany', { count: fileCount })}
          </span>
        </span>
      </label>
      <label className={`${optionClass} text-ds-ink`}>
        <input type="radio" name={name} className="mt-1" checked={!resetFiles} onChange={() => onChange(false)} />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t('rewindResetConversation')}</span>
          <span className="text-ds-muted">{t('rewindResetConversationDetail')}</span>
        </span>
      </label>
      {blocked ? (
        <div role="status" className="flex items-start gap-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="flex min-w-0 flex-col gap-1">
            <span>
              {preflight.unsafe.length === 1
                ? t('rewindResetConflictOne')
                : t('rewindResetConflictMany', { count: preflight.unsafe.length })}
            </span>
            <span className="break-all font-mono text-[11.5px]">
              {conflictPaths.join(', ')}
              {preflight.unsafe.length > conflictPaths.length
                ? ` ${t('turnUndoIgnoredOverflow', { count: preflight.unsafe.length - conflictPaths.length })}`
                : ''}
            </span>
          </span>
        </div>
      ) : null}
    </fieldset>
  )
}
