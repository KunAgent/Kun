import { describe, expect, it } from 'vitest'
import type { ChatBlock, UserInputQuestion } from '../../agent/types'
import {
  USER_INPUT_FREEFORM_LABEL,
  USER_INPUT_OTHER_LABEL,
  allAnswered,
  answerDisplayValues,
  answerFromOption,
  answerFromOptions,
  answerFromTypedText,
  answersByQuestionId,
  combineAnswerDraft,
  draftSelectionCount,
  isMultipleChoiceQuestion,
  isLivePendingUserInput,
  isQuestionAnswered,
  multiSelectRule,
  nextUnansweredIndex,
  optionsNeedRows,
  orderedAnswers,
  questionMaxSelections,
  questionMinSelections,
  selectLivePendingUserInput,
  selectedOptionValues,
  shouldShowQuestionHeader,
  splitAnswerDraft,
  toggleOptionAnswer
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

const multiQuestion: UserInputQuestion = {
  id: 'requirements',
  header: 'Requirements',
  question: 'Pick requirements',
  selectionMode: 'multiple',
  minSelections: 2,
  maxSelections: 2,
  options: [
    { label: 'Keep ratio', description: '' },
    { label: 'App icon', description: '' },
    { label: 'Redesign outline', description: '' }
  ]
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

describe('multi-select answers', () => {
  it('builds a compatible joined answer with structured values', () => {
    expect(answerFromOptions(multiQuestion, multiQuestion.options.slice(0, 2))).toEqual({
      id: 'requirements',
      label: 'Keep ratio, App icon',
      value: 'Keep ratio, App icon',
      labels: ['Keep ratio', 'App icon'],
      values: ['Keep ratio', 'App icon']
    })
  })

  it('toggles selected options in question order', () => {
    const first = toggleOptionAnswer(multiQuestion, undefined, multiQuestion.options[1])
    const second = toggleOptionAnswer(multiQuestion, first ?? undefined, multiQuestion.options[0])
    expect(selectedOptionValues(second ?? undefined)).toEqual(['Keep ratio', 'App icon'])
    expect(toggleOptionAnswer(multiQuestion, second ?? undefined, multiQuestion.options[0])).toEqual({
      id: 'requirements',
      label: 'App icon',
      value: 'App icon',
      labels: ['App icon'],
      values: ['App icon']
    })
  })

  it('enforces min and max selections', () => {
    const one = answerFromOptions(multiQuestion, [multiQuestion.options[0]])
    const two = answerFromOptions(multiQuestion, multiQuestion.options.slice(0, 2))
    expect(isMultipleChoiceQuestion(multiQuestion)).toBe(true)
    expect(questionMinSelections(multiQuestion)).toBe(2)
    expect(questionMaxSelections(multiQuestion)).toBe(2)
    expect(isQuestionAnswered(multiQuestion, one)).toBe(false)
    expect(isQuestionAnswered(multiQuestion, two)).toBe(true)
  })

  it('uses display values for multi-select and legacy answers', () => {
    expect(answerDisplayValues(answerFromOptions(multiQuestion, multiQuestion.options.slice(0, 2)))).toEqual([
      'Keep ratio',
      'App icon'
    ])
    expect(answerDisplayValues({ id: 'db', label: 'PostgreSQL', value: 'PostgreSQL' })).toEqual(['PostgreSQL'])
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

describe('answer drafts (option pick + free-text row)', () => {
  const openMulti: UserInputQuestion = {
    ...multiQuestion,
    minSelections: 1,
    maxSelections: 3
  }

  it('lets a single-choice pick win and uses the text only without one', () => {
    const pick = answerFromOption(optionQuestion, optionQuestion.options[1])
    expect(combineAnswerDraft(optionQuestion, pick, 'Turso')).toBe(pick)
    expect(combineAnswerDraft(optionQuestion, undefined, ' Turso ')).toEqual({
      id: 'db', label: USER_INPUT_OTHER_LABEL, value: 'Turso'
    })
    expect(combineAnswerDraft(optionQuestion, undefined, '   ')).toBeUndefined()
    expect(combineAnswerDraft(freeformQuestion, undefined, 'svc')).toEqual({
      id: 'name', label: USER_INPUT_FREEFORM_LABEL, value: 'svc'
    })
  })

  it('adds typed text as one more multiple-choice item', () => {
    const checked = answerFromOptions(openMulti, openMulti.options.slice(0, 2))
    const combined = combineAnswerDraft(openMulti, checked, ' Dark mode ')
    expect(combined).toEqual({
      id: 'requirements',
      label: USER_INPUT_OTHER_LABEL,
      value: 'Keep ratio, App icon, Dark mode',
      labels: ['Keep ratio', 'App icon'],
      values: ['Keep ratio', 'App icon', 'Dark mode']
    })
    expect(isQuestionAnswered(openMulti, combined)).toBe(true)
    expect(answerDisplayValues(combined)).toEqual(['Keep ratio', 'App icon', 'Dark mode'])
    expect(combineAnswerDraft(openMulti, undefined, 'Dark mode')).toEqual({
      id: 'requirements', label: USER_INPUT_OTHER_LABEL, value: 'Dark mode'
    })
  })

  it('treats typed text naming an option as checking it', () => {
    const checked = answerFromOptions(openMulti, [openMulti.options[2]])
    expect(combineAnswerDraft(openMulti, checked, 'keep ratio')).toEqual(
      answerFromOptions(openMulti, [openMulti.options[0], openMulti.options[2]])
    )
  })

  it('splits stored answers back into the pick and the draft', () => {
    const checked = answerFromOptions(openMulti, openMulti.options.slice(0, 2))
    const combined = combineAnswerDraft(openMulti, checked, 'Dark mode')
    expect(splitAnswerDraft(combined)).toEqual({ selection: checked, text: 'Dark mode' })
    expect(splitAnswerDraft(checked)).toEqual({ selection: checked, text: '' })
    expect(splitAnswerDraft({ id: 'db', label: USER_INPUT_OTHER_LABEL, value: 'Turso' }))
      .toEqual({ selection: undefined, text: 'Turso' })
    expect(splitAnswerDraft({ id: 'name', label: USER_INPUT_FREEFORM_LABEL, value: 'svc' }))
      .toEqual({ selection: undefined, text: 'svc' })
    expect(splitAnswerDraft(undefined)).toEqual({ selection: undefined, text: '' })
  })

  it('counts typed text against the selection limit', () => {
    const checked = answerFromOptions(openMulti, openMulti.options.slice(0, 2))
    expect(draftSelectionCount(checked, '')).toBe(2)
    expect(draftSelectionCount(checked, 'Dark mode')).toBe(3)
    expect(draftSelectionCount(undefined, '  ')).toBe(0)
  })
})

describe('multiSelectRule', () => {
  const base: UserInputQuestion = {
    id: 'pipelines',
    header: 'Scope',
    question: 'Which pipelines?',
    selectionMode: 'multiple',
    options: ['Build', 'Test', 'Sign', 'Publish'].map((label) => ({ label, description: '' }))
  }

  it('describes the selection limits of a multiple-choice question', () => {
    expect(multiSelectRule(base)).toEqual({ kind: 'any' })
    expect(multiSelectRule({ ...base, maxSelections: 3 })).toEqual({ kind: 'max', count: 3 })
    expect(multiSelectRule({ ...base, maxSelections: 4 })).toEqual({ kind: 'any' })
    expect(multiSelectRule({ ...base, minSelections: 2 })).toEqual({ kind: 'min', count: 2 })
    expect(multiSelectRule({ ...base, minSelections: 2, maxSelections: 2 })).toEqual({ kind: 'exact', count: 2 })
    expect(multiSelectRule({ ...base, minSelections: 2, maxSelections: 3 })).toEqual({ kind: 'range', min: 2, max: 3 })
  })

  it('has no rule for single-choice or free-form questions', () => {
    expect(multiSelectRule(optionQuestion)).toBeNull()
    expect(multiSelectRule(freeformQuestion)).toBeNull()
  })
})
