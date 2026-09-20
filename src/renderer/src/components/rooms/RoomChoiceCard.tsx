import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { roomsRequest, type RoomUserInput } from './rooms-client'
import { useRoomMutation } from './useRoomResource'

export function roomInputAnswers(
  input: RoomUserInput,
  selected: Record<string, string[]>,
  freeform: Record<string, string>
) {
  return input.questions.map((question) => {
    const values = [
      ...(selected[question.id] ?? []),
      ...(freeform[question.id]?.trim() ? [freeform[question.id].trim()] : [])
    ]
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

export async function submitRoomUserInput(inputId: string, payload: { cancelled: true } | { answers: ReturnType<typeof roomInputAnswers> }) {
  return roomsRequest(`/v1/user-inputs/${encodeURIComponent(inputId)}`, 'POST', payload)
}

export function RoomChoiceCard({
  input, title, setupPending, onUpdated, onSkipSetup
}: {
  input?: RoomUserInput
  title?: string
  setupPending?: boolean
  onUpdated: () => Promise<void>
  onSkipSetup?: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [freeform, setFreeform] = useState<Record<string, string>>({})
  const mutation = useRoomMutation(onUpdated)
  const prompt = input?.prompt || title || ''
  if (!input) {
    return <section className="direct-choice-card is-answered" aria-label={prompt}>
      <p>{prompt}</p><Check size={16} aria-hidden="true" />
    </section>
  }
  const question = input.questions[0]
  const answers = roomInputAnswers(input, selected, freeform)
  const valid = input.questions.every((item, index) => Boolean(answers[index]?.value) &&
    ((selected[item.id]?.length ?? 0) + (freeform[item.id]?.trim() ? 1 : 0)) >= (item.minSelections ?? 1))
  const submit = (cancelled = false, extra?: { answers: ReturnType<typeof roomInputAnswers> }) => {
    const custom = (freeform[question?.id ?? input.id] ?? '').trim()
    const payload = extra?.answers ?? (custom ? otherUserInputAnswers(input, custom) : answers)
    return mutation.run(`${input.id}:${cancelled ? 'cancel' : JSON.stringify(payload)}`,
      () => submitRoomUserInput(input.id, cancelled ? { cancelled: true } : { answers: payload }))
  }
  const pick = (questionId: string, label: string) => {
    const next = { [questionId]: [label] }
    const rest = Object.fromEntries(input.questions.filter((item) => item.id !== questionId).map((item) => [item.id, selected[item.id] ?? []]))
    void submit(false, { answers: roomInputAnswers(input, { ...rest, ...next }, {}) })
  }
  return <section className="direct-choice-card">
    <header>
      <strong>{question?.question || prompt}</strong>
      <button type="button" className="direct-choice-close" aria-label={t('directChoiceClose')} disabled={mutation.busy}
        onClick={() => void submit(true)}><X size={16} /></button>
    </header>
    {question?.options.map((option, index) =>
      <button type="button" key={option.label} className="direct-choice-option" disabled={mutation.busy}
        onClick={() => pick(question.id, option.label)}>
        <span>{String.fromCharCode(65 + index)}</span>{option.label}
      </button>)}
    <form onSubmit={(event) => { event.preventDefault(); if (valid) void submit() }}>
      <input value={freeform[question?.id ?? input.id] ?? ''} placeholder={t('directChoiceOther')}
        aria-label={t('directChoiceOther')} disabled={mutation.busy}
        onChange={(event) => {
          const id = question?.id ?? input.id
          setFreeform({ [id]: event.target.value })
          setSelected({ [id]: [] })
        }} />
      {freeform[question?.id ?? input.id]?.trim() ? <button type="submit" disabled={mutation.busy || !valid}>{t('roomsSubmitAnswer')}</button> : null}
    </form>
    {setupPending && onSkipSetup ? <button type="button" className="direct-choice-skip" disabled={mutation.busy}
      onClick={() => void onSkipSetup()}>{t('directSkipSetup')}</button> : null}
    {mutation.error ? <p role="alert">{mutation.error}</p> : null}
  </section>
}
