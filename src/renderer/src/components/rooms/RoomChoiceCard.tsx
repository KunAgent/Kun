import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { roomsRequest, type RoomUserInput } from './rooms-client'
import './rooms-choice.css'

type Answers = ReturnType<typeof roomInputAnswers>

export function roomInputAnswers(
  input: RoomUserInput,
  selected: Record<string, string[]>,
  freeform: Record<string, string>
) {
  return input.questions.map((question) => {
    const typed = freeform[question.id]?.trim()
    if (typed) return { id: question.id, label: 'Other', value: typed }
    const values = selected[question.id] ?? []
    return {
      id: question.id,
      label: values.join(', '),
      value: values.join('\n'),
      ...(question.selectionMode === 'multiple' ? { labels: values, values } : {})
    }
  })
}

export function otherUserInputAnswers(input: RoomUserInput, text: string) {
  const value = text.trim()
  if (!input.questions.length) return [{ id: input.id, label: 'Other', value }]
  return input.questions.map((question) => ({ id: question.id, label: 'Other', value }))
}

export async function submitRoomUserInput(inputId: string, payload: { cancelled: true } | { answers: Answers }) {
  return roomsRequest(`/v1/user-inputs/${encodeURIComponent(inputId)}`, 'POST', payload)
}

export function RoomChoiceCard({
  input, title, setupPending, onUpdated, onSkipSetup, resolvedAnswer
}: {
  input?: RoomUserInput
  title?: string
  setupPending?: boolean
  onUpdated: () => Promise<void>
  onSkipSetup?: () => Promise<void>
  resolvedAnswer?: string
}) {
  const { t } = useTranslation('common')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [freeform, setFreeform] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ cancelled: boolean; summary: string } | null>(null)
  const displayResult = result ?? (resolvedAnswer ? { cancelled: false, summary: resolvedAnswer } : null)
  const locked = useRef(false)
  const prompt = input?.prompt || input?.questions[0]?.question || title || ''
  const questions = input?.questions ?? []
  const valid = questions.every((question) => {
    if (freeform[question.id]?.trim()) return true
    const count = selected[question.id]?.length ?? 0
    return count >= (question.minSelections ?? 1) && count <= (question.maxSelections ??
      (question.selectionMode === 'multiple' ? question.options.length : 1))
  })

  const submit = async (answers?: Answers, cancelled = false) => {
    if (!input || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const submittedAnswers = cancelled ? undefined : answers ??
        (questions.length ? roomInputAnswers(input, selected, freeform) : otherUserInputAnswers(input, freeform[input.id] ?? ''))
      const payload = cancelled ? { cancelled: true as const } : { answers: submittedAnswers! }
      await submitRoomUserInput(input.id, payload)
      const summary = submittedAnswers?.map((answer) => answer.value).filter(Boolean).join(' · ') ?? ''
      setResult({ cancelled, summary })
      // The answer is already recorded. A refresh error must never invite a second submission.
      void onUpdated().catch(() => undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  const choose = (question: RoomUserInput['questions'][number], label: string) => {
    const current = selected[question.id] ?? []
    const next = question.selectionMode === 'multiple'
      ? current.includes(label) ? current.filter((value) => value !== label) : [...current, label]
      : [label]
    setSelected((previous) => ({ ...previous, [question.id]: next }))
    setFreeform((previous) => ({ ...previous, [question.id]: '' }))
    if (questions.length === 1 && question.selectionMode !== 'multiple') {
      void submit(roomInputAnswers(input!, { [question.id]: next }, {}))
    }
  }

  if (!input || displayResult) return <section className="direct-choice-card is-answered" aria-label={prompt}>
    <div><p>{prompt}</p><small>{displayResult?.cancelled ? t('directChoiceCancelled') : displayResult?.summary ||
      (displayResult ? t('directChoiceResolved') : t('directChoiceClosed'))}</small></div>
    {displayResult?.cancelled ? <X size={16} aria-hidden="true" /> : displayResult ? <Check size={16} aria-hidden="true" /> : null}
  </section>

  return <section className="direct-choice-card" aria-label={prompt}>
    <header>
      <strong>{prompt}</strong>
      <button type="button" className="direct-choice-close" aria-label={t('directChoiceClose')} disabled={busy}
        onClick={() => void submit(undefined, true)}><X size={16} /></button>
    </header>
    {questions.map((question) => <div className="direct-choice-question" key={question.id}>
      {question.question && question.question !== prompt ? <strong>{question.question}</strong> : null}
      {question.options.map((option) => {
        const active = (selected[question.id] ?? []).includes(option.label)
        const full = question.selectionMode === 'multiple' && !active &&
          (selected[question.id]?.length ?? 0) >= (question.maxSelections ?? question.options.length)
        return <button type="button" key={option.label} className="direct-choice-option" aria-pressed={active}
          disabled={busy || full} onClick={() => choose(question, option.label)}>
          <span className="direct-choice-indicator" aria-hidden="true">{active ? <Check size={13} /> : null}</span>
          <span><b>{option.label}</b>{option.description ? <small>{option.description}</small> : null}</span>
        </button>
      })}
      <input value={freeform[question.id] ?? ''} placeholder={t('directChoiceOther')}
        aria-label={question.question ? `${question.question}: ${t('directChoiceOther')}` : t('directChoiceOther')}
        disabled={busy} onChange={(event) => {
          setFreeform((previous) => ({ ...previous, [question.id]: event.target.value }))
          setSelected((previous) => ({ ...previous, [question.id]: [] }))
        }} />
    </div>)}
    {!questions.length ? <input value={freeform[input.id] ?? ''} placeholder={t('directChoiceOther')}
      aria-label={t('directChoiceOther')} disabled={busy}
      onChange={(event) => setFreeform({ [input.id]: event.target.value })} /> : null}
    {(questions.length !== 1 || questions[0].selectionMode === 'multiple' || Boolean(freeform[questions[0].id]?.trim())) ?
      <button type="button" className="direct-choice-submit" disabled={busy || (questions.length ? !valid : !freeform[input.id]?.trim())}
        onClick={() => void submit()}>{t('roomsSubmitAnswer')}</button> : null}
    {setupPending && onSkipSetup ? <button type="button" className="direct-choice-skip" disabled={busy}
      onClick={() => void onSkipSetup()}>{t('directSkipSetup')}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>
}
