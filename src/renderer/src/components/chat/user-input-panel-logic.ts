import type { ChatBlock, UserInputAnswer, UserInputOption, UserInputQuestion } from '../../agent/types'

type UserInputBlock = Extract<ChatBlock, { kind: 'user_input' }>

/**
 * A `user_input` request is actionable only while the live runtime is awaiting
 * it (`block.live`). A block rehydrated from a finished thread keeps its stored
 * `pending` status but is NOT live, so reopening that history must not re-prompt
 * the user (issue #606) — answering it would hit a dead gate ("user input not
 * found").
 */
export function isLivePendingUserInput(block: UserInputBlock): boolean {
  return block.status === 'pending' && block.live === true
}

/** The live, awaited `user_input` block in a thread, if any (latest wins). */
export function selectLivePendingUserInput(blocks: ChatBlock[]): UserInputBlock | null {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (block.kind === 'user_input' && isLivePendingUserInput(block)) return block
  }
  return null
}

/**
 * Shared, framework-free helpers for the user_input / ask-user interaction.
 *
 * The runtime models each question as having exactly one answer
 * (`UserInputAnswer` = `{ id, label, value }`), so selection is single-choice
 * per question. Free-form questions (no options) and the "type your own"
 * escape hatch both resolve to a synthetic label below.
 *
 * Both the composer-docked panel and the (read-only) timeline bubble import
 * these so the answer shape never drifts between the two surfaces.
 */
export const USER_INPUT_OTHER_LABEL = 'Other'
export const USER_INPUT_FREEFORM_LABEL = 'Answer'

export function answersByQuestionId(
  answers: UserInputAnswer[] | undefined
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const answer of answers ?? []) {
    out[answer.id] = answer
  }
  return out
}

export function answerFromOption(
  question: UserInputQuestion,
  option: UserInputOption
): UserInputAnswer {
  return { id: question.id, label: option.label, value: option.label }
}

/**
 * Map free-typed composer text onto the current question. An exact (case- and
 * whitespace-insensitive) match against an option collapses to that option;
 * otherwise it becomes a custom "Other" answer (options present) or a plain
 * free-form "Answer" (no options).
 */
export function answerFromTypedText(
  question: UserInputQuestion,
  text: string
): UserInputAnswer {
  const trimmed = text.trim()
  const matched = question.options.find(
    (option) => option.label.trim().toLowerCase() === trimmed.toLowerCase()
  )
  if (matched) {
    return { id: question.id, label: matched.label, value: matched.label }
  }
  const label = question.options.length > 0 ? USER_INPUT_OTHER_LABEL : USER_INPUT_FREEFORM_LABEL
  return { id: question.id, label, value: trimmed }
}

export function isQuestionAnswered(
  question: UserInputQuestion,
  answer: UserInputAnswer | undefined
): boolean {
  if (!answer) return false
  if (question.options.length === 0 || answer.label === USER_INPUT_OTHER_LABEL) {
    return answer.value.trim().length > 0
  }
  return true
}

export function allAnswered(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>
): boolean {
  return questions.every((question) => isQuestionAnswered(question, map[question.id]))
}

export function orderedAnswers(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>
): UserInputAnswer[] {
  const out: UserInputAnswer[] = []
  for (const question of questions) {
    const answer = map[question.id]
    if (answer) out.push(answer)
  }
  return out
}

/**
 * The next question that still needs an answer, scanning forward (wrapping)
 * from `from`. Returns `from` when everything is answered, so callers should
 * check {@link allAnswered} first to decide submit-vs-advance.
 */
export function nextUnansweredIndex(
  questions: UserInputQuestion[],
  map: Record<string, UserInputAnswer>,
  from: number
): number {
  const total = questions.length
  for (let offset = 1; offset <= total; offset += 1) {
    const idx = (from + offset) % total
    if (!isQuestionAnswered(questions[idx], map[questions[idx].id])) {
      return idx
    }
  }
  return from
}

/** Options carrying descriptions render as full-width rows; bare ones as chips. */
export function optionsNeedRows(options: UserInputOption[]): boolean {
  return options.some((option) => option.description?.trim().length > 0)
}

/**
 * The runtime sometimes sends a placeholder header of "input" for a lone
 * question; that adds no information, so it is suppressed.
 */
export function shouldShowQuestionHeader(
  question: UserInputQuestion,
  totalQuestions: number
): boolean {
  const header = question.header?.trim()
  if (!header) return false
  if (totalQuestions === 1 && header.toLowerCase() === 'input') return false
  return true
}
