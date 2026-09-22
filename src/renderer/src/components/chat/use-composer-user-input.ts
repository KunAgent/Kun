import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatBlock,
  UserInputAnswer,
  UserInputOption,
  UserInputQuestion
} from '../../agent/types'
import {
  allAnswered,
  answerFromOption,
  answerFromTypedText,
  answersByQuestionId,
  isMultipleChoiceQuestion,
  isQuestionAnswered,
  nextUnansweredIndex,
  orderedAnswers,
  questionMaxSelections,
  selectedOptionValues,
  toggleOptionAnswer
} from './user-input-panel-logic'

export type PendingUserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

export type ResolveUserInput = (
  blockId: string,
  action: { kind: 'submit'; answers: UserInputAnswer[] } | { kind: 'cancel' }
) => Promise<void>

/**
 * Drives the composer-docked ask-user panel. Owns the in-progress answer map
 * and the stepper index so both the panel (presentational) and the composer's
 * send/keyboard handlers (type-to-answer) operate on one source of truth.
 *
 * Selecting an option advances to the next unanswered question but keeps the
 * final review/submit action explicit. A typed answer submitted through the
 * composer still resolves the last question immediately because Enter is
 * already an explicit submit gesture.
 */
export type ComposerUserInputController = {
  /** True when there is a pending block with at least one question to answer. */
  active: boolean
  block: PendingUserInputBlock | null
  questions: UserInputQuestion[]
  /** Index of the question currently shown in the panel. */
  index: number
  total: number
  currentQuestion: UserInputQuestion | null
  answers: Record<string, UserInputAnswer>
  isSelected: (questionId: string, optionLabel: string) => boolean
  isOptionDisabled: (question: UserInputQuestion, option: UserInputOption) => boolean
  isAnswered: (questionId: string) => boolean
  chooseOption: (question: UserInputQuestion, option: UserInputOption) => void
  canConfirmCurrentQuestion: boolean
  confirmCurrentQuestion: () => void
  canSubmit: boolean
  submitting: boolean
  submitAnswers: () => void
  /** Returns true when the text was consumed as the current question's answer. */
  submitTypedText: (text: string) => boolean
  goToIndex: (index: number) => void
  cancel: () => void
}

export function useComposerUserInput(
  block: PendingUserInputBlock | null,
  resolveUserInput: ResolveUserInput
): ComposerUserInputController {
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>({})
  const [index, setIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous one-shot guard: the store only flips block.status away from
  // 'pending' after the submit RPC resolves, so without this a rapid second
  // selection (double-click) would dispatch a second submit for the same ask
  // during the in-flight window. Re-armed when a fresh block arrives.
  const resolvedRef = useRef(false)

  const blockId = block?.id ?? null
  const blockAnswers = block?.answers
  useEffect(() => {
    setAnswers(answersByQuestionId(blockAnswers))
    setIndex(0)
    setSubmitting(false)
    resolvedRef.current = false
  }, [blockId, blockAnswers])

  const questions = useMemo(() => block?.questions ?? [], [block])
  const total = questions.length
  const safeIndex = total > 0 ? Math.min(index, total - 1) : 0
  const currentQuestion = total > 0 ? questions[safeIndex] : null
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined
  const canConfirmCurrentQuestion = currentQuestion
    ? isQuestionAnswered(currentQuestion, currentAnswer)
    : false
  const canSubmit = allAnswered(questions, answers)

  const submitAnswerMap = useCallback(
    (nextMap: Record<string, UserInputAnswer>) => {
      if (!block || resolvedRef.current || !allAnswered(questions, nextMap)) return
      resolvedRef.current = true
      setSubmitting(true)
      void resolveUserInput(block.id, {
        kind: 'submit',
        answers: orderedAnswers(questions, nextMap)
      }).catch(() => {
        resolvedRef.current = false
        setSubmitting(false)
      })
    },
    [block, questions, resolveUserInput]
  )

  const applyAnswerAndAdvance = useCallback(
    (answer: UserInputAnswer, submitWhenComplete: boolean) => {
      if (!block || resolvedRef.current) return
      const nextMap = { ...answers, [answer.id]: answer }
      setAnswers(nextMap)
      if (allAnswered(questions, nextMap)) {
        if (submitWhenComplete) submitAnswerMap(nextMap)
        return
      }
      setIndex((current) => nextUnansweredIndex(questions, nextMap, current))
    },
    [answers, block, questions, submitAnswerMap]
  )

  const chooseOption = useCallback(
    (question: UserInputQuestion, option: UserInputOption) => {
      if (isMultipleChoiceQuestion(question)) {
        if (!block || resolvedRef.current) return
        setAnswers((current) => {
          const next = toggleOptionAnswer(question, current[question.id], option)
          if (!next) {
            const rest = { ...current }
            delete rest[question.id]
            return rest
          }
          return { ...current, [question.id]: next }
        })
        return
      }
      applyAnswerAndAdvance(answerFromOption(question, option), false)
    },
    [applyAnswerAndAdvance, block]
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

  const submitTypedText = useCallback(
    (text: string): boolean => {
      if (!currentQuestion || text.trim().length === 0) return false
      applyAnswerAndAdvance(answerFromTypedText(currentQuestion, text), true)
      return true
    },
    [applyAnswerAndAdvance, currentQuestion]
  )

  const cancel = useCallback(() => {
    if (!block || resolvedRef.current) return
    resolvedRef.current = true
    setSubmitting(true)
    void resolveUserInput(block.id, { kind: 'cancel' }).catch(() => {
      resolvedRef.current = false
      setSubmitting(false)
    })
  }, [block, resolveUserInput])

  const isSelected = useCallback(
    (questionId: string, optionLabel: string): boolean => {
      const answer = answers[questionId]
      if (!answer) return false
      return selectedOptionValues(answer).includes(optionLabel)
    },
    [answers]
  )

  const isOptionDisabled = useCallback(
    (question: UserInputQuestion, option: UserInputOption): boolean => {
      if (!isMultipleChoiceQuestion(question)) return false
      if (isSelected(question.id, option.label)) return false
      const max = questionMaxSelections(question)
      return max !== undefined && selectedOptionValues(answers[question.id]).length >= max
    },
    [answers, isSelected]
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
      canConfirmCurrentQuestion,
      confirmCurrentQuestion,
      canSubmit,
      submitting,
      submitAnswers,
      submitTypedText,
      goToIndex: setIndex,
      cancel
    }),
    [
      answers,
      block,
      cancel,
      canSubmit,
      canConfirmCurrentQuestion,
      chooseOption,
      confirmCurrentQuestion,
      currentQuestion,
      isAnswered,
      isOptionDisabled,
      isSelected,
      questions,
      safeIndex,
      submitAnswers,
      submitTypedText,
      submitting,
      total
    ]
  )
}
