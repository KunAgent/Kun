import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowUp, Check, HelpCircle, Loader2 } from 'lucide-react'
import type { AdeQuestionRecord } from '@shared/ade-teams'
import { AgentIcon } from '../agent-icon'
import { workerHue, type WorkerStatusKind } from './worker-presentation'
import { WorkerSeatGlyph } from './worker-seat'

const AVATAR_CLASS = { 24: 'h-6 w-6', 32: 'h-8 w-8', 36: 'h-9 w-9' } as const
const AVATAR_GLYPH = { 24: 12, 32: 15, 36: 17 } as const

/**
 * A member's seat: a solid hue tile with the seat glyph. Status sits on the
 * tile instead of a text line: a spinning accent ring while it works, an
 * amber ring while it waits on you, a green or red badge once it settles.
 */
export function WorkerAvatar({
  workerId,
  seat,
  status,
  harnessId,
  size = 32
}: {
  workerId: string
  seat: number
  /** An external harness (Codex, Claude Code…) shows its mark in the corner; Kun's own does not. */
  harnessId?: string
  status?: WorkerStatusKind
  size?: 24 | 32 | 36
}): ReactElement {
  const ring = status === 'working' ? 'running'
    : status === 'question' || status === 'approval' || status === 'waiting' ? 'warning'
      : undefined
  const badge = status === 'done' ? 'success' : status === 'failed' ? 'danger' : undefined
  return (
    <span
      className={`ds-worker-avatar ${AVATAR_CLASS[size]}`}
      data-hue={workerHue(workerId)}
      data-ring={ring}
      data-status={status}
      aria-hidden
    >
      {harnessId && harnessId !== 'kun' ? (
        <span className="ds-worker-avatar-harness" data-harness={harnessId}>
          <AgentIcon harnessId={harnessId} size={size === 24 ? 8 : 10} />
        </span>
      ) : null}
      <WorkerSeatGlyph seat={seat} size={AVATAR_GLYPH[size]} />
      {badge ? (
        <span className="ds-worker-avatar-badge" data-tone={badge}>
          {badge === 'success'
            ? <Check strokeWidth={3.2} aria-hidden />
            : <AlertCircle strokeWidth={3} aria-hidden />}
        </span>
      ) : null}
    </span>
  )
}

/**
 * An open worker question. `inline` (the list) answers in place with its own
 * input; `header` sits on top of the worker tab composer, which then sends
 * the typed answer.
 */
export function WorkerQuestionCard({
  question,
  busy,
  onAnswer,
  variant,
  workerLabel
}: {
  question: AdeQuestionRecord
  busy: boolean
  onAnswer: (questionId: string, answer: string) => void
  variant: 'inline' | 'header'
  workerLabel?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [answer, setAnswer] = useState('')
  const options = (question.options ?? []).filter((option) => option.trim())
  const submit = (value: string): void => {
    const trimmed = value.trim()
    if (trimmed && !busy) onAnswer(question.questionId, trimmed)
  }
  return (
    <div
      data-worker-question={question.questionId}
      data-variant={variant}
      className={variant === 'inline'
        ? 'ds-worker-question flex flex-col gap-2 rounded-[11px] px-3 py-2.5'
        : 'ds-worker-question flex flex-col gap-2 px-3 pb-3 pt-2.5'}
    >
      <div className="flex items-start gap-2">
        {variant === 'header' ? (
          <span className="ds-worker-tone ds-worker-tone-text mt-[3px]" data-tone="warning">
            <HelpCircle className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {variant === 'header' ? (
            <div className="ds-worker-tone ds-worker-tone-text text-[11.5px] font-semibold" data-tone="warning">
              {t('workersQuestion.waitingOn', { name: workerLabel ?? '' })}
            </div>
          ) : null}
          <p className={`whitespace-pre-wrap break-words text-ds-ink ${variant === 'header' ? 'mt-0.5 text-[13px] leading-[1.55]' : 'text-[12.5px] leading-[1.55]'}`}>
            {question.question}
          </p>
        </div>
      </div>
      {options.length ? (
        <div className={`flex flex-wrap gap-1.5 ${variant === 'header' ? 'pl-[23px]' : ''}`}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => submit(option)}
              data-worker-question-option={option}
              className="ds-worker-question-option h-7 rounded-lg px-3 text-[12px] font-semibold text-ds-ink transition disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      {variant === 'inline' ? (
        <div className="flex h-[30px] items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card pl-2.5 pr-[3px] ds-worker-field">
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent?.isComposing) submit(answer)
            }}
            aria-label={t('workersAnswerPlaceholder')}
            placeholder={options.length ? t('workersQuestion.otherAnswer') : t('workersAnswerPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
          <button
            type="button"
            disabled={!answer.trim() || busy}
            onClick={() => submit(answer)}
            aria-label={t('workersAnswerSend')}
            className="grid h-6 w-6 place-items-center rounded-md bg-ds-subtle text-ds-muted transition enabled:hover:bg-ds-hover enabled:hover:text-ds-ink disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />}
          </button>
        </div>
      ) : null}
    </div>
  )
}
