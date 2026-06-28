import { describe, expect, it } from 'vitest'
import type { ChatBlock, UserInputQuestion } from '../../agent/types'
import {
  USER_INPUT_FREEFORM_LABEL,
  USER_INPUT_OTHER_LABEL,
  allAnswered,
  answerFromOption,
  answerFromTypedText,
  answersByQuestionId,
  isLivePendingUserInput,
  isQuestionAnswered,
  nextUnansweredIndex,
  optionsNeedRows,
  orderedAnswers,
  selectLivePendingUserInput,
  shouldShowQuestionHeader
} from './user-input-panel-logic'

const optionQuestion: UserInputQuestion = {
  id: 'db',
  header: 'Scope',
  question: 'Which database?',
  options: [
    { label: 'PostgreSQL', description: '' },
    { label: 'SQLite', description: 'Embedded' }
  ]
}

const freeformQuestion: UserInputQuestion = {
  id: 'name',
  header: '',
  question: 'Service name?',
  options: []
}

function userInputBlock(overrides: Partial<Extract<ChatBlock, { kind: 'user_input' }>>): ChatBlock {
  return {
    kind: 'user_input',
    id: overrides.id ?? 'ui_1',
    requestId: overrides.requestId ?? 'in_1',
    questions: overrides.questions ?? [optionQuestion],
    status: overrides.status ?? 'pending',
    ...overrides
  }
}

describe('selectLivePendingUserInput', () => {
  it('surfaces a live pending request', () => {
    const block = userInputBlock({ status: 'pending', live: true })
    expect(isLivePendingUserInput(block as Extract<ChatBlock, { kind: 'user_input' }>)).toBe(true)
    expect(selectLivePendingUserInput([block])).toBe(block)
  })

  it('ignores a stale pending request rehydrated from history (issue #606)', () => {
    // No `live` flag — this is exactly the block a finished thread replays.
    const stale = userInputBlock({ status: 'pending' })
    expect(isLivePendingUserInput(stale as Extract<ChatBlock, { kind: 'user_input' }>)).toBe(false)
    expect(selectLivePendingUserInput([stale])).toBeNull()
  })

  it('ignores resolved requests even when marked live', () => {
    const submitted = userInputBlock({ status: 'submitted', live: true })
    expect(selectLivePendingUserInput([submitted])).toBeNull()
  })

  it('returns the latest live pending block when several exist', () => {
    const older = userInputBlock({ id: 'ui_old', requestId: 'in_old', status: 'pending', live: true })
    const newer = userInputBlock({ id: 'ui_new', requestId: 'in_new', status: 'pending', live: true })
    expect(selectLivePendingUserInput([older, newer])).toBe(newer)
  })
})

describe('answerFromOption', () => {
  it('uses the option label as both label and value', () => {
    expect(answerFromOption(optionQuestion, optionQuestion.options[0])).toEqual({
      id: 'db',
      label: 'PostgreSQL',
      value: 'PostgreSQL'
    })
  })
})

describe('answerFromTypedText', () => {
  it('collapses an exact (case/space-insensitive) match onto the option', () => {
    expect(answerFromTypedText(optionQuestion, '  postgresql ')).toEqual({
      id: 'db',
      label: 'PostgreSQL',
      value: 'PostgreSQL'
    })
  })

  it('maps unmatched text on an options question to Other', () => {
    expect(answerFromTypedText(optionQuestion, 'Turso')).toEqual({
      id: 'db',
      label: USER_INPUT_OTHER_LABEL,
      value: 'Turso'
    })
  })

  it('maps text on a free-form question to the freeform label', () => {
    expect(answerFromTypedText(freeformQuestion, '  billing-api ')).toEqual({
      id: 'name',
      label: USER_INPUT_FREEFORM_LABEL,
      value: 'billing-api'
    })
  })
})

describe('isQuestionAnswered', () => {
  it('treats a chosen option as answered', () => {
    expect(isQuestionAnswered(optionQuestion, answerFromOption(optionQuestion, optionQuestion.options[0]))).toBe(true)
  })

  it('requires non-empty value for Other / free-form', () => {
    expect(isQuestionAnswered(optionQuestion, { id: 'db', label: USER_INPUT_OTHER_LABEL, value: '   ' })).toBe(false)
    expect(isQuestionAnswered(optionQuestion, { id: 'db', label: USER_INPUT_OTHER_LABEL, value: 'Turso' })).toBe(true)
    expect(isQuestionAnswered(freeformQuestion, { id: 'name', label: USER_INPUT_FREEFORM_LABEL, value: '' })).toBe(false)
  })

  it('is false when there is no answer', () => {
    expect(isQuestionAnswered(optionQuestion, undefined)).toBe(false)
  })
})

describe('multi-question flow helpers', () => {
  const questions = [optionQuestion, freeformQuestion]

  it('reports all-answered only once every question resolves', () => {
    const partial = { db: answerFromOption(optionQuestion, optionQuestion.options[0]) }
    expect(allAnswered(questions, partial)).toBe(false)
    const full = { ...partial, name: answerFromTypedText(freeformQuestion, 'svc') }
    expect(allAnswered(questions, full)).toBe(true)
  })

  it('advances to the next unanswered question, wrapping', () => {
    const map = { db: answerFromOption(optionQuestion, optionQuestion.options[0]) }
    expect(nextUnansweredIndex(questions, map, 0)).toBe(1)
    const full = { ...map, name: answerFromTypedText(freeformQuestion, 'svc') }
    expect(nextUnansweredIndex(questions, full, 0)).toBe(0)
  })

  it('orders answers by question order, skipping gaps', () => {
    const map = { name: answerFromTypedText(freeformQuestion, 'svc') }
    expect(orderedAnswers(questions, map)).toEqual([{ id: 'name', label: 'Answer', value: 'svc' }])
  })
})

describe('answersByQuestionId', () => {
  it('keys answers and tolerates undefined', () => {
    expect(answersByQuestionId(undefined)).toEqual({})
    expect(answersByQuestionId([{ id: 'a', label: 'x', value: 'x' }])).toEqual({
      a: { id: 'a', label: 'x', value: 'x' }
    })
  })
})

describe('presentation helpers', () => {
  it('uses rows only when an option carries a description', () => {
    expect(optionsNeedRows(optionQuestion.options)).toBe(true)
    expect(optionsNeedRows([{ label: 'A', description: '' }])).toBe(false)
  })

  it('suppresses the placeholder "input" header for a lone question', () => {
    expect(shouldShowQuestionHeader({ ...freeformQuestion, header: 'input' }, 1)).toBe(false)
    expect(shouldShowQuestionHeader({ ...freeformQuestion, header: 'input' }, 2)).toBe(true)
    expect(shouldShowQuestionHeader(optionQuestion, 1)).toBe(true)
    expect(shouldShowQuestionHeader(freeformQuestion, 1)).toBe(false)
  })
})
