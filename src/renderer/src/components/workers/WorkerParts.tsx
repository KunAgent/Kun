import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowUp, Check, Circle, Clock3, HelpCircle, Loader2 } from 'lucide-react'
import type { AdeQuestionRecord } from '@shared/ade-teams'
import { AgentIcon } from '../agent-icon'
import { workerHue, type WorkerStatusKind } from './worker-presentation'

/** Tinted tile with the worker's agent mark; the tint tells teammates apart. */
export function WorkerAvatar({
  workerId,
  harnessId,
  size = 32
}: {
  workerId: string
  harnessId?: string
  size?: 24 | 32
}): ReactElement {
  return (
    <span
      className={`ds-worker-avatar ${size === 24 ? 'h-6 w-6 rounded-[7px]' : 'h-8 w-8 rounded-[10px]'}`}
      data-hue={workerHue(workerId)}
      aria-hidden
    >
      <AgentIcon harnessId={harnessId ?? 'kun'} size={size === 24 ? 13 : 16} />
    </span>
  )
}

export function WorkerStatusGlyph({
  kind,
  size = 13
}: {
  kind: WorkerStatusKind
  size?: number
}): ReactElement {
  const style = { width: size, height: size }
  if (kind === 'working') return <Loader2 style={style} className="shrink-0 animate-spin text-ds-status-running" strokeWidth={2.4} aria-hidden />
  if (kind === 'question' || kind === 'approval') return <HelpCircle style={style} className="shrink-0" strokeWidth={2.2} aria-hidden />
  if (kind === 'waiting') return <Clock3 style={style} className="shrink-0" strokeWidth={2.2} aria-hidden />
  if (kind === 'failed') return <AlertCircle style={style} className="shrink-0" strokeWidth={2.2} aria-hidden />
  if (kind === 'done') return <Check style={style} className="shrink-0 text-ds-status-success" strokeWidth={2.6} aria-hidden />
  return <Circle style={style} className="shrink-0 text-ds-faint" strokeWidth={0} fill="currentColor" aria-hidden />
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
