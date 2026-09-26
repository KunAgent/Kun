import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronRight, CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UserInputAnswer } from '../../agent/types'
import type { PendingUserInputBlock, ResolveUserInput } from '../../components/chat/use-composer-user-input'
import {
  allAnswered, answerFromOption, answersByQuestionId,
  isMultipleChoiceQuestion, isQuestionAnswered, orderedAnswers,
  questionMaxSelections, questionMinSelections, selectedOptionValues, toggleOptionAnswer
} from '../../components/chat/user-input-panel-logic'
import { UserInputTimeoutCountdownChip } from '../../components/chat/floating-composer-user-input-timeout'
import { MobileSheet } from '../sheets/MobileSheet'
import './mobile-user-input.css'

/** Key by request so polling never resets a draft, while a new request cannot inherit it. */
export function MobileUserInput({ input, resolve, autoOpen = true }: {
  input: PendingUserInputBlock
  resolve: ResolveUserInput
  autoOpen?: boolean
}) {
  return <MobileUserInputRequest key={input.id} input={input} resolve={resolve} autoOpen={autoOpen} />
}

function MobileUserInputRequest({ input, resolve, autoOpen }: {
  input: PendingUserInputBlock; resolve: ResolveUserInput; autoOpen: boolean
}) {
  const { t } = useTranslation('common')
  const name = useId()
  const [open, setOpen] = useState(autoOpen)
  const [answers, setAnswers] = useState(() => answersByQuestionId(input.answers))
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'submit' | 'cancel' | null>(null)
  const [error, setError] = useState(input.errorMessage ?? '')
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = contentRef.current?.closest('.kun-mobile-sheet-content')
    if (scroller) scroller.scrollTop = 0
  }, [index, open])
  const inFlight = useRef(false)
  const question = input.questions[Math.min(index, input.questions.length - 1)]
  if (!question) return null
  const answer = answers[question.id]
  const multiple = isMultipleChoiceQuestion(question)
  const selected = selectedOptionValues(answer)
  const custom = answer?.label === 'Other' || !question.options.length
  const maximum = questionMaxSelections(question) ?? question.options.length
  const complete = allAnswered(input.questions, answers)
  const updateAnswer = (next: UserInputAnswer | null) => {
    setError('')
    setAnswers((current) => {
      const updated = { ...current }
      if (next) updated[question.id] = next
      else delete updated[question.id]
      return updated
    })
  }
  const submit = async (cancel = false) => {
    if (inFlight.current || done || (!cancel && !complete)) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await resolve(input.id, cancel ? { kind: 'cancel' } : {
        kind: 'submit', answers: orderedAnswers(input.questions, answers)
      })
      setDone(cancel ? 'cancel' : 'submit')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { inFlight.current = false; setBusy(false) }
  }
  if (done) return <p className="kun-mobile-input-resolved" role="status">{t(done === 'cancel' ? 'mobileInputCancelled' : 'mobileInputSent')}</p>
  return <>
    <button type="button" className="kun-mobile-input-trigger" onClick={() => setOpen(true)}>
      <CircleHelp size={20} aria-hidden /><span><strong>{t('userInputTitle')}</strong>
        <small>{question.question}</small></span><ChevronRight size={18} aria-hidden />
    </button>
    <MobileSheet open={open} title={t('userInputTitle')} closeLabel={t('mobileInputCollapse')}
      onClose={() => setOpen(false)} footer={<div className="kun-mobile-input-footer">
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <button type="button" disabled={busy} onClick={() => { void submit(true) }}>{t('userInputCancel')}</button>
          {index > 0 ? <button type="button" disabled={busy} onClick={() => setIndex(index - 1)}>{t('userInputBack')}</button> : null}
          <button type="button" className="kun-mobile-input-primary" disabled={busy || !isQuestionAnswered(question, answer)}
            onClick={() => {
              if (complete) { void submit(); return }
              const next = input.questions.findIndex((q, i) => i > index && !isQuestionAnswered(q, answers[q.id]))
              setIndex(next >= 0 ? next : input.questions.findIndex((q) => !isQuestionAnswered(q, answers[q.id])))
            }}>{t(busy ? 'userInputSubmitting' : complete ? 'userInputSubmitAnswers' : 'userInputNext')}</button>
        </div>
      </div>}>
      <div ref={contentRef} className="kun-mobile-input" aria-busy={busy}>
        <div className="kun-mobile-input-status">
          <span>{t('userInputQuestionProgress', { current: index + 1, total: input.questions.length })}</span>
          <UserInputTimeoutCountdownChip block={input} t={t} />
        </div>
        {input.questions.length > 1 ? <nav className="kun-mobile-input-steps" aria-label={t('userInputTitle')}>
          {input.questions.map((q, i) => <button type="button" key={q.id} disabled={busy}
            aria-label={t('userInputQuestionProgress', {current:i + 1, total:input.questions.length})}
            aria-current={i === index ? 'step' : undefined} onClick={() => setIndex(i)}>
            {isQuestionAnswered(q, answers[q.id]) ? <Check size={16} aria-hidden /> : i + 1}
          </button>)}
        </nav> : null}
        <fieldset disabled={busy} className="kun-mobile-input-question" key={question.id}>
          <legend>{question.question}</legend>
          {multiple ? <p className="kun-mobile-input-hint">{t('mobileInputSelectionCount', {
            count: custom ? 0 : selected.length, min: questionMinSelections(question), max: maximum
          })}</p> : null}
          {question.options.map((option) => {
            const checked = !custom && selected.includes(option.label)
            return <label key={option.label} className="kun-mobile-input-option" data-selected={checked}>
              <input type={multiple ? 'checkbox' : 'radio'} name={`${name}-${question.id}`} checked={checked}
                disabled={multiple && !checked && !custom && selected.length >= maximum}
                onChange={() => updateAnswer(multiple
                  ? toggleOptionAnswer(question, custom ? undefined : answer, option)
                  : answerFromOption(question, option))} />
              <span><strong>{option.label}</strong>
                {option.recommended ? <em>{t('userInputRecommended')}</em> : null}
                {option.description ? <small>{option.description}</small> : null}</span>
            </label>
          })}
          <label className="kun-mobile-input-custom">
            <span>{t(question.options.length ? 'roomsOtherAnswer' : 'mobileInputAnswer')}</span>
            <textarea rows={3} value={custom ? answer?.value ?? '' : ''}
              placeholder={t('mobileInputAnswerPlaceholder')}
              onChange={(event) => updateAnswer(event.target.value ? {
                id: question.id, label: question.options.length ? 'Other' : 'Answer', value: event.target.value
              } : null)} />
          </label>
        </fieldset>
      </div>
    </MobileSheet>
  </>
}
