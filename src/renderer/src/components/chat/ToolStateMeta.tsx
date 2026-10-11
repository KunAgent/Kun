import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../../agent/types'
import { readToolPresentation } from '../../agent/tool-presentation'
import { formatDuration } from './message-timeline-tools'

/** Compact evidence belongs to the real process row, including collapsed tools. */
export function ToolStateMeta({ block }: { block: ToolBlock }): ReactElement | null {
  const { t } = useTranslation('common')
  const presentation = readToolPresentation(block)
  const state = presentation.state
  const label = state === 'pending' ? t('toolStatePending')
    : state === 'running' ? t('toolStateRunning')
      : state === 'failed' ? t('toolStateFailed')
        : state === 'canceled' ? t('toolStateCanceled') : null
  const duration = typeof presentation.durationMs === 'number' &&
    Number.isFinite(presentation.durationMs) && presentation.durationMs >= 0
    ? formatDuration(presentation.durationMs) : null
  const exitCodes = [...new Set((presentation.terminals ?? [])
    .flatMap((terminal) => typeof terminal.exitCode === 'number' ? [terminal.exitCode] : []))]
  if (!label && !duration && exitCodes.length === 0) return null
  return (
    <span data-tool-state={state}
      className="ml-1 inline-flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[11px] font-normal tabular-nums text-ds-muted">
      {label ? <span className={state === 'failed' ? 'text-orange-700 dark:text-orange-300' : undefined}>{label}</span> : null}
      {duration ? <span title={t('toolStateDuration')}>{duration}</span> : null}
      {exitCodes.length > 0 ? <span title={t('toolStateExitCode')}>{t('toolStateExit', { code: exitCodes.join(', ') })}</span> : null}
    </span>
  )
}
