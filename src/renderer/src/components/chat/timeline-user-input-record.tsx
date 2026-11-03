import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Clock3 } from 'lucide-react'
import type { ChatBlock, UserInputQuestion } from '../../agent/types'
import { answerDisplayValues, answersByQuestionId } from './user-input-panel-logic'
import './timeline-records.css'

type UserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>
type Translate = (key: string, options?: Record<string, unknown>) => string

/** One answered question as the record shows it: a short label and its answers. */
export type UserInputRecordAnswer = {
  id: string
  label: string
  question: string
  values: string[]
}

export type UserInputRecordState =
  | { kind: 'waiting'; questionCount: number; firstQuestion: string }
  | { kind: 'answered-one'; answer: UserInputRecordAnswer }
  | { kind: 'answered-many'; answers: UserInputRecordAnswer[] }
  | { kind: 'skipped'; question: string }
  | { kind: 'ended'; question: string }
  | { kind: 'timeout'; question: string }
  | { kind: 'error'; message: string; answers: UserInputRecordAnswer[] }

/**
 * The runtime sends a placeholder header ("Input") when it has nothing better;
 * the record then labels the row with the question itself.
 */
export function userInputRecordLabel(question: UserInputQuestion): string {
  const header = question.header?.trim() ?? ''
  if (header && header.toLowerCase() !== 'input') return header
  return question.question.trim().replace(/[?？]+$/u, '') || header
}

function recordAnswers(block: UserInputBlock): UserInputRecordAnswer[] {
  const byId = answersByQuestionId(block.answers)
  return block.questions.map((question) => ({
    id: question.id,
    label: userInputRecordLabel(question),
    question: question.question.trim(),
    values: answerDisplayValues(byId[question.id])
  }))
}

/**
 * Which record an ask-user block renders as. Only a live request is waiting:
 * a persisted `pending` block reopened from history has no runtime gate left
 * behind it, so it reads as ended instead of advertising a dead action.
 */
export function userInputRecordState(block: UserInputBlock): UserInputRecordState {
  const firstQuestion = block.questions[0]?.question.trim() ?? ''
  switch (block.status) {
    case 'pending':
      return block.live === true
        ? { kind: 'waiting', questionCount: block.questions.length, firstQuestion }
        : { kind: 'ended', question: firstQuestion }
    case 'submitted': {
      const answers = recordAnswers(block)
      return answers.length === 1
        ? { kind: 'answered-one', answer: answers[0]! }
        : { kind: 'answered-many', answers }
    }
    case 'cancelled':
      return { kind: 'skipped', question: firstQuestion }
    case 'timeout':
      return { kind: 'timeout', question: firstQuestion }
    case 'error':
      return {
        kind: 'error',
        message: block.errorMessage?.trim() ?? '',
        answers: recordAnswers(block).filter((answer) => answer.values.length > 0)
      }
  }
}

function joinAnswers(values: string[], t: Translate): string {
  return values.length > 0 ? values.join(t('composerRecords.answerSeparator')) : t('composerRecords.noAnswer')
}

function RecordIcon({ tone, children }: { tone?: 'success' | 'danger' | 'warning' | 'accent'; children: ReactNode }): ReactElement {
  return (
    <span className="ds-timeline-record-icon" data-tone={tone} aria-hidden="true">
      {children}
    </span>
  )
}

/** The bare check / alert glyphs, shared with the approval records. */
export function RecordCheckIcon(): ReactElement {
  return <RecordIcon tone="success"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /></RecordIcon>
}

export function RecordAlertIcon(): ReactElement {
  return (
    <RecordIcon tone="danger">
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-current text-[9px] font-bold leading-none">
        !
      </span>
    </RecordIcon>
  )
}

export function RecordDashIcon(): ReactElement {
  return <RecordIcon><span className="ds-timeline-record-dash" /></RecordIcon>
}

export function RecordWaitingDot(): ReactElement {
  return <RecordIcon tone="accent"><span className="ds-timeline-record-dot" /></RecordIcon>
}

/**
 * Transcript record of an ask-user request. Answering happens in the card that
 * takes the composer's place; the timeline only says what was asked and what
 * came of it, collapsed to one line (several answers become a small Q -> A card).
 */
export function UserInputRecord({
  block,
  nested = false
}: {
  block: UserInputBlock
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const state = userInputRecordState(block)
  const allQuestions = block.questions.map((question) => question.question.trim()).filter(Boolean).join('\n')
  const common = {
    'data-user-input-record': state.kind,
    'data-timeline-block-id': block.id,
    'data-nested': nested ? 'true' : undefined
  }
  // A non-error request can still carry a runtime note (e.g. a late resolve).
  const extraError = block.status !== 'error' && block.errorMessage?.trim()
    ? <p className="ds-timeline-record-danger mt-1 pl-[22px] text-[12px] leading-[18px]">{block.errorMessage}</p>
    : null

  if (state.kind === 'answered-many') {
    return (
      <section {...common} className="ds-timeline-record-card" aria-label={t('composerRecords.answeredCount', { count: state.answers.length })}>
        <div className="ds-timeline-record">
          <RecordCheckIcon />
          <span className="ds-timeline-record-label">
            {t('composerRecords.answeredCount', { count: state.answers.length })}
          </span>
        </div>
        <dl className="ds-timeline-record-grid">
          {state.answers.map((answer) => (
            <div key={answer.id} className="contents">
              <dt title={answer.question}>{answer.label}</dt>
              <dd data-empty={answer.values.length === 0 ? 'true' : undefined} title={joinAnswers(answer.values, t)}>
                {joinAnswers(answer.values, t)}
              </dd>
            </div>
          ))}
        </dl>
        {extraError}
      </section>
    )
  }

  let line: ReactElement
  if (state.kind === 'waiting') {
    line = (
      <div className="ds-timeline-record" title={allQuestions || undefined}>
        <RecordWaitingDot />
        <span className="ds-timeline-record-label">
          {state.questionCount > 1
            ? t('composerRecords.waitingCount', { count: state.questionCount })
            : t('composerRecords.waiting')}
        </span>
        <span className="ds-timeline-record-faint" data-grow="true">{t('composerRecords.answerBelow')}</span>
      </div>
    )
  } else if (state.kind === 'answered-one') {
    const answer = joinAnswers(state.answer.values, t)
    const answered = state.answer.values.length > 0
    // Question and answer each get their own budget: a long question is cut
    // to one line instead of pushing the answer out of a shared clamp.
    line = (
      <div className="ds-timeline-record" title={`${state.answer.question}\n${answer}`}>
        <RecordCheckIcon />
        <span className="ds-timeline-record-pair">
          <span className="ds-timeline-record-lead ds-timeline-record-muted">{state.answer.question}</span>
          <span
            className={answered ? 'ds-timeline-record-tail ds-timeline-record-ink' : 'ds-timeline-record-tail'}
            data-empty={answered ? undefined : 'true'}
          >
            {answer}
          </span>
        </span>
      </div>
    )
  } else if (state.kind === 'error') {
    const yourAnswer = state.answers.map((answer) => joinAnswers(answer.values, t)).join(' · ')
    const message = state.message
      ? t('composerRecords.notDelivered', { message: state.message })
      : t('composerRecords.notDeliveredGeneric')
    // Same split as an answered question, so a long error cannot hide what
    // the user answered; alone, the error wraps and clamps like any body.
    line = (
      <div className="ds-timeline-record" data-tone="danger" title={allQuestions || undefined}>
        <RecordAlertIcon />
        {yourAnswer ? (
          <span className="ds-timeline-record-pair">
            <span className="ds-timeline-record-lead ds-timeline-record-danger" title={message}>{message}</span>
            <span className="ds-timeline-record-tail ds-timeline-record-muted">
              {t('composerRecords.yourAnswer', { answer: yourAnswer })}
            </span>
          </span>
        ) : (
          <span className="ds-timeline-record-body ds-timeline-record-danger">{message}</span>
        )}
      </div>
    )
  } else {
    const icon = state.kind === 'timeout'
      ? <RecordIcon tone="warning"><Clock3 className="h-3.5 w-3.5" strokeWidth={2.2} /></RecordIcon>
      : <RecordDashIcon />
    const label = state.kind === 'timeout'
      ? t('composerRecords.timedOut')
      : state.kind === 'skipped'
        ? t('composerRecords.skipped')
        : t('userInputCancelled')
    line = (
      <div className="ds-timeline-record" title={allQuestions || undefined}>
        {icon}
        <span className="ds-timeline-record-label">{label}</span>
        {state.question ? (
          <span className="ds-timeline-record-faint" data-grow="true">{state.question}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div {...common} className="min-w-0">
      {line}
      {extraError}
    </div>
  )
}
