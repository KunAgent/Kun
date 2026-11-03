import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatBlock,
  UserInputAnswer,
  UserInputOption,
  UserInputQuestion
} from '../../agent/types'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import {
  allAnswered,
  answerFromOption,
  combineAnswerDraft,
  draftSelectionCount,
  isMultipleChoiceQuestion,
  isQuestionAnswered,
  nextUnansweredIndex,
  orderedAnswers,
  questionMaxSelections,
  selectedOptionValues,
  splitAnswerDraft,
  toggleOptionAnswer
} from './user-input-panel-logic'

export type PendingUserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

export type ResolveUserInput = (
  blockId: string,
  action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
) => Promise<void>

/**
 * Drives the ask-user card that takes the composer's place. Owns the option
 * picks, the free-text drafts and the question index, so the card stays
 * presentational.
 *
 * Every question has an option pick and a free-text draft; the answer that is
 * submitted combines both (combineAnswerDraft). Picking an option with a click
 * or a digit advances to the next unanswered question but never submits; a
 * confirm gesture (Enter, the primary button) submits once every question is
 * answered.
 */
export type ComposerUserInputController = {
  /** True when there is a pending block with at least one question to answer. */
  active: boolean
  block: PendingUserInputBlock | null
  questions: UserInputQuestion[]
  /** Index of the question currently shown in the card. */
  index: number
  total: number
  currentQuestion: UserInputQuestion | null
  /** Effective answers (option pick combined with the typed draft). */
  answers: Record<string, UserInputAnswer>
  /** Whether the option is picked / checked (typed text does not count). */
  isSelected: (questionId: string, optionLabel: string) => boolean
  isOptionDisabled: (question: UserInputQuestion, option: UserInputOption) => boolean
  isAnswered: (questionId: string) => boolean
  /** Click / digit: single choice picks and advances; multiple choice toggles. */
  chooseOption: (question: UserInputQuestion, option: UserInputOption) => void
  /** Enter on an option: picks it, then submits when that completes every question. */
  confirmOption: (question: UserInputQuestion, option: UserInputOption) => void
  /** Draft of the question's free-text row ('' when empty). */
  typedText: (questionId: string) => string
  /** Free-text row edits. Non-empty text clears a single-choice pick. */
  setTypedText: (question: UserInputQuestion, text: string) => void
  /**
   * Enter in the free-text row. In single choice, non-empty text replaces an
   * option picked after it was typed (the text is what the row confirms);
   * then it advances, or submits when that completes every question.
   */
  confirmTypedText: (question: UserInputQuestion) => void
  /** Multiple choice at its limit with no typed text: the free-text row is closed. */
  isFreeTextDisabled: (question: UserInputQuestion) => boolean
  canConfirmCurrentQuestion: boolean
  /** Advances to the next unanswered question, or submits when all are answered. */
  confirmCurrentQuestion: () => void
  /** Every other question is answered, so answering this one completes the set. */
  completesOnAnswer: boolean
  canSubmit: boolean
  submitting: boolean
  /**
   * Summary of the last failed submit / skip, redacted and localized like
   * other runtime errors ('' when the error carried no text).
   */
  error: string | null
  submitAnswers: () => void
  goToIndex: (index: number) => void
  cancel: () => void
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  // Runtime errors arrive as JSON envelopes ({"code":…,"message":…}); show the
  // same redacted, friendly summary as the rest of the app.
  return raw.trim() ? formatRuntimeError(error) : ''
}

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map
  const rest = { ...map }
  delete rest[key]
  return rest
}

function combineAnswers(
  questions: UserInputQuestion[],
  selections: Record<string, UserInputAnswer>,
  typed: Record<string, string>
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const question of questions) {
    const answer = combineAnswerDraft(question, selections[question.id], typed[question.id] ?? '')
    if (answer) out[question.id] = answer
  }
  return out
}

export function useComposerUserInput(
  block: PendingUserInputBlock | null,
  resolveUserInput: ResolveUserInput
): ComposerUserInputController {
  const [selections, setSelections] = useState<Record<string, UserInputAnswer>>({})
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous one-shot guard: the store only flips block.status away from
  // 'pending' after the submit RPC resolves, so without this a rapid second
  // selection (double-click) would dispatch a second submit for the same ask
  // during the in-flight window. Re-armed when a fresh block arrives.
  const resolvedRef = useRef(false)

  const blockId = block?.id ?? null
  const blockAnswers = block?.answers
  useEffect(() => {
    setIndex(0)
    setError(null)
  }, [blockId])
  useEffect(() => {
    // Stored answers (a failed submit keeps them on the block) seed the picks
    // and the free-text drafts, so a retry starts from what was sent.
    const nextSelections: Record<string, UserInputAnswer> = {}
    const nextTyped: Record<string, string> = {}
    for (const answer of blockAnswers ?? []) {
      const draft = splitAnswerDraft(answer)
      if (draft.selection) nextSelections[answer.id] = draft.selection
      if (draft.text) nextTyped[answer.id] = draft.text
    }
    setSelections(nextSelections)
    setTyped(nextTyped)
    setSubmitting(false)
    resolvedRef.current = false
  }, [blockId, blockAnswers])

  const questions = useMemo(() => block?.questions ?? [], [block])
  const total = questions.length
  const safeIndex = total > 0 ? Math.min(index, total - 1) : 0
  const currentQuestion = total > 0 ? questions[safeIndex] : null
  const answers = useMemo(
    () => combineAnswers(questions, selections, typed),
    [questions, selections, typed]
  )
  const canConfirmCurrentQuestion = currentQuestion
    ? isQuestionAnswered(currentQuestion, answers[currentQuestion.id])
    : false
  const canSubmit = allAnswered(questions, answers)
  const completesOnAnswer = questions.every((question, questionIndex) =>
    questionIndex === safeIndex || isQuestionAnswered(question, answers[question.id])
  )

  const submitAnswerMap = useCallback(
    (nextMap: Record<string, UserInputAnswer>) => {
      if (!block || resolvedRef.current || !allAnswered(questions, nextMap)) return
      resolvedRef.current = true
      setSubmitting(true)
      setError(null)
      void resolveUserInput(block.id, {
        kind: 'submit',
        answers: orderedAnswers(questions, nextMap)
      }).catch((reason: unknown) => {
        resolvedRef.current = false
        setSubmitting(false)
        setError(errorText(reason))
      })
    },
    [block, questions, resolveUserInput]
  )

  // After `question` got its answer in `nextMap`: submit when every question
  // is answered (and submitting is wanted), otherwise show the next open one.
  const advanceFrom = useCallback(
    (question: UserInputQuestion, nextMap: Record<string, UserInputAnswer>, submitWhenComplete: boolean) => {
      if (allAnswered(questions, nextMap)) {
        if (submitWhenComplete) submitAnswerMap(nextMap)
        return
      }
      const from = questions.findIndex((candidate) => candidate.id === question.id)
      setIndex(nextUnansweredIndex(questions, nextMap, from >= 0 ? from : safeIndex))
    },
    [questions, safeIndex, submitAnswerMap]
  )

  const pickSingleOption = useCallback(
    (question: UserInputQuestion, option: UserInputOption, submitWhenComplete: boolean) => {
      if (!block || resolvedRef.current) return
      setError(null)
      const nextSelections = { ...selections, [question.id]: answerFromOption(question, option) }
      setSelections(nextSelections)
      advanceFrom(question, combineAnswers(questions, nextSelections, typed), submitWhenComplete)
    },
    [advanceFrom, block, questions, selections, typed]
  )

  const chooseOption = useCallback(
    (question: UserInputQuestion, option: UserInputOption) => {
      if (isMultipleChoiceQuestion(question)) {
        if (!block || resolvedRef.current) return
        setError(null)
        setSelections((current) => {
          const next = toggleOptionAnswer(question, current[question.id], option)
          return next ? { ...current, [question.id]: next } : withoutKey(current, question.id)
        })
        return
      }
      pickSingleOption(question, option, false)
    },
    [block, pickSingleOption]
  )

  const confirmOption = useCallback(
    (question: UserInputQuestion, option: UserInputOption) => {
      if (isMultipleChoiceQuestion(question)) return
      pickSingleOption(question, option, true)
    },
    [pickSingleOption]
  )

  const setTypedText = useCallback(
    (question: UserInputQuestion, text: string) => {
      if (!block || resolvedRef.current) return
      setError(null)
      setTyped((current) => ({ ...current, [question.id]: text }))
      if (!isMultipleChoiceQuestion(question) && text.trim()) {
        setSelections((current) => withoutKey(current, question.id))
      }
    },
    [block]
  )

  const confirmTypedText = useCallback(
    (question: UserInputQuestion) => {
      if (!block || resolvedRef.current) return
      // Text typed first and an option clicked afterwards both live in the
      // draft; Enter in the text row means the text, so it drops the pick.
      const dropsPick = !isMultipleChoiceQuestion(question) && Boolean((typed[question.id] ?? '').trim())
      const nextSelections = dropsPick ? withoutKey(selections, question.id) : selections
      const nextMap = combineAnswers(questions, nextSelections, typed)
      if (!isQuestionAnswered(question, nextMap[question.id])) return
      setError(null)
      if (nextSelections !== selections) setSelections(nextSelections)
      advanceFrom(question, nextMap, true)
    },
    [advanceFrom, block, questions, selections, typed]
  )

  const confirmCurrentQuestion = useCallback(() => {
    if (!currentQuestion || !canConfirmCurrentQuestion) return
    if (allAnswered(questions, answers)) {
      submitAnswerMap(answers)
      return
    }
    setIndex((current) => nextUnansweredIndex(questions, answers, current))
  }, [
    answers,
    canConfirmCurrentQuestion,
    currentQuestion,
    questions,
    submitAnswerMap
  ])

  const submitAnswers = useCallback(() => {
    submitAnswerMap(answers)
  }, [answers, submitAnswerMap])

  const cancel = useCallback(() => {
    if (!block || resolvedRef.current) return
    resolvedRef.current = true
    setSubmitting(true)
    setError(null)
    void resolveUserInput(block.id, { kind: 'cancel' }).catch((reason: unknown) => {
      resolvedRef.current = false
      setSubmitting(false)
      setError(errorText(reason))
    })
  }, [block, resolveUserInput])

  const goToIndex = useCallback((next: number) => {
    setIndex(Math.max(0, next))
  }, [])

  const isSelected = useCallback(
    (questionId: string, optionLabel: string): boolean =>
      selectedOptionValues(selections[questionId]).includes(optionLabel),
    [selections]
  )

  const typedText = useCallback(
    (questionId: string): string => typed[questionId] ?? '',
    [typed]
  )

  const isOptionDisabled = useCallback(
    (question: UserInputQuestion, option: UserInputOption): boolean => {
      if (!isMultipleChoiceQuestion(question)) return false
      if (isSelected(question.id, option.label)) return false
      const max = questionMaxSelections(question)
      return max !== undefined &&
        draftSelectionCount(selections[question.id], typed[question.id] ?? '') >= max
    },
    [isSelected, selections, typed]
  )

  const isFreeTextDisabled = useCallback(
    (question: UserInputQuestion): boolean => {
      if (!isMultipleChoiceQuestion(question)) return false
      if ((typed[question.id] ?? '').trim()) return false
      const max = questionMaxSelections(question)
      return max !== undefined && selectedOptionValues(selections[question.id]).length >= max
    },
    [selections, typed]
  )

  const isAnswered = useCallback(
    (questionId: string): boolean => {
      const question = questions.find((candidate) => candidate.id === questionId)
      if (!question) return Boolean(answers[questionId])
      return isQuestionAnswered(question, answers[questionId])
    },
    [answers, questions]
  )

  return useMemo(
    () => ({
      active: Boolean(block) && total > 0,
      block,
      questions,
      index: safeIndex,
      total,
      currentQuestion,
      answers,
      isSelected,
      isOptionDisabled,
      isAnswered,
      chooseOption,
      confirmOption,
      typedText,
      setTypedText,
      confirmTypedText,
      isFreeTextDisabled,
      canConfirmCurrentQuestion,
      confirmCurrentQuestion,
      completesOnAnswer,
      canSubmit,
      submitting,
      error,
      submitAnswers,
      goToIndex,
      cancel
    }),
    [
      answers,
      block,
      cancel,
      canSubmit,
      canConfirmCurrentQuestion,
      chooseOption,
      completesOnAnswer,
      confirmCurrentQuestion,
      confirmOption,
      confirmTypedText,
      currentQuestion,
      error,
      goToIndex,
      isAnswered,
      isFreeTextDisabled,
      isOptionDisabled,
      isSelected,
      questions,
      safeIndex,
      setTypedText,
      submitAnswers,
      submitting,
      total,
      typedText
    ]
  )
}
