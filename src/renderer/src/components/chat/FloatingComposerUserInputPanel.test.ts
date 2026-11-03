import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { UserInputQuestion } from '../../agent/types'
import i18n from '../../i18n'
import type { ComposerUserInputController } from './use-composer-user-input'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'

const singleQuestion: UserInputQuestion = {
  header: 'Decision',
  id: 'choice',
  question: 'Choose an approach',
  options: [
    { label: 'Focused change', description: 'Smallest scope', recommended: true },
    { label: 'Broad redesign', description: 'Larger scope' }
  ],
  selectionMode: 'single'
}

const multiQuestion: UserInputQuestion = {
  header: 'Scope',
  id: 'pipelines',
  question: 'Which pipelines move?',
  selectionMode: 'multiple',
  maxSelections: 3,
  options: ['Build', 'Unit tests', 'Signing', 'Publish'].map((label) => ({ label, description: '' }))
}

const freeformQuestion: UserInputQuestion = {
  header: 'input',
  id: 'name',
  question: 'What should the service be called?\nKeep it short.',
  options: []
}

function controller(overrides: Partial<ComposerUserInputController> = {}): ComposerUserInputController {
  const questions = overrides.questions ?? [singleQuestion]
  const index = overrides.index ?? 0
  return {
    active: true,
    block: { id: 'input_1' } as ComposerUserInputController['block'],
    questions,
    index,
    total: questions.length,
    currentQuestion: questions[index] ?? null,
    answers: {},
    isSelected: () => false,
    isOptionDisabled: () => false,
    isAnswered: () => false,
    chooseOption: () => undefined,
    confirmOption: () => undefined,
    typedText: () => '',
    setTypedText: () => undefined,
    confirmTypedText: () => undefined,
    isFreeTextDisabled: () => false,
    canConfirmCurrentQuestion: false,
    confirmCurrentQuestion: () => undefined,
    completesOnAnswer: questions.length === 1,
    canSubmit: false,
    submitting: false,
    error: null,
    submitAnswers: () => undefined,
    goToIndex: () => undefined,
    cancel: () => undefined,
    ...overrides
  }
}

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options)

function render(
  value: ComposerUserInputController,
  variant: 'main' | 'compact' = 'main'
): string {
  return renderToStaticMarkup(createElement(FloatingComposerUserInputPanel, { controller: value, t, variant }))
}

describe('FloatingComposerUserInputPanel', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  for (const variant of ['main', 'compact'] as const) {
    it(`renders the interrupt card with one recommendation tag in ${variant} mode`, () => {
      const html = render(controller(), variant)

      expect(html).toContain('data-composer-stack-item="user-input"')
      expect(html).toContain(`data-user-input-variant="${variant}"`)
      expect(html).toContain('aria-label="Kun&#x27;s question"')
      expect(html.match(/class="ds-interrupt-recommended"/g)).toHaveLength(1)
      expect(html).toContain('Focused change')
      expect(html).toContain('Smallest scope')
      // The focused listbox is named by the question, not a generic "Options".
      expect(html).toMatch(/role="listbox"[^>]*aria-label="Choose an approach"/)
      expect(html.match(/role="option"/g)).toHaveLength(2)
      expect(html).not.toContain('aria-selected="true"')
      // Final free-text row: numbered after the options.
      expect(html).toContain('placeholder="Type your own answer…"')
      expect(html).toMatch(/data-interrupt-freetext[^>]*><span class="ds-interrupt-option-number" aria-hidden="true">3\.<\/span>/)
      if (variant === 'compact') expect(html).toContain('data-compact="true"')
    })
  }

  it('shows the topic badge, Skip and a disabled Submit for a lone single-choice question', () => {
    const html = render(controller())

    expect(html).toContain('class="ds-interrupt-badge"')
    expect(html).toContain('Decision')
    expect(html).toContain('↑↓ or number keys to choose, Enter to submit, Esc to skip')
    expect(html).toContain('>Skip</button>')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-variant="primary"[^>]*>Submit<\/button>/)
    expect(html).toContain('data-user-input-primary="submit"')
    // No pager for a single question.
    expect(html).not.toContain('ds-interrupt-pager')
  })

  it('marks the picked option as selected', () => {
    const html = render(controller({
      isSelected: (_, label) => label === 'Broad redesign',
      canConfirmCurrentQuestion: true,
      canSubmit: true
    }))

    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-interrupt-option="1"[^>]*data-selected="true"/)
  })

  it('renders checkboxes, the rule line and the Other row for multiple choice', () => {
    const html = render(controller({
      questions: [singleQuestion, multiQuestion, freeformQuestion],
      index: 1,
      completesOnAnswer: false,
      isSelected: (_, label) => label === 'Build' || label === 'Unit tests',
      canConfirmCurrentQuestion: true
    }))

    expect(html).toContain('aria-multiselectable="true"')
    expect(html.match(/class="ds-interrupt-check" data-checked="true"/g)).toHaveLength(2)
    expect(html).toContain('Choose up to 3')
    expect(html).toContain('placeholder="Other — type your own answer…"')
    expect(html).toContain('data-dashed="true"')
    expect(html).toContain('↑↓ to move, Space to toggle, Enter for next')
    // Pager "2 / 3" and a Next primary with an arrow.
    expect(html).toContain('2 / 3')
    expect(html).toContain('aria-label="Previous question"')
    expect(html).toContain('data-user-input-primary="next"')
    expect(html).toMatch(/>Next<svg/)
  })

  it('shows only the focused free-text row for a question without options', () => {
    const html = render(controller({
      questions: [singleQuestion, freeformQuestion],
      index: 1,
      completesOnAnswer: true,
      typedText: () => 'billing-api'
    }))

    expect(html).not.toContain('role="listbox"')
    expect(html).toMatch(/<textarea[^>]*data-interrupt-autofocus="true"/)
    expect(html).toContain('billing-api</textarea>')
    expect(html).toContain('<span class="whitespace-pre-wrap">What should the service be called?\nKeep it short.</span>')
    // The "input" header is kept when there are several questions.
    expect(html).toContain('class="ds-interrupt-badge"')
    // Esc in its only row goes back (here) or skips, and the hint says so.
    expect(html).toContain('Enter to submit, Shift+Enter for a new line, Esc to go back')
  })

  it('says Esc goes back on a later single-choice question', () => {
    const html = render(controller({
      questions: [freeformQuestion, singleQuestion],
      index: 1,
      completesOnAnswer: false
    }))

    expect(html).toContain('↑↓ or number keys to choose, Enter for next, Esc to go back')
    expect(html).toContain('data-user-input-primary="next"')
  })

  it('suppresses the placeholder header of a lone question and the hint in compact mode', () => {
    const html = render(controller({ questions: [freeformQuestion] }), 'compact')

    expect(html).not.toContain('ds-interrupt-badge')
    expect(html).not.toContain('ds-interrupt-card-header')
    expect(html).not.toContain('ds-interrupt-hint-text')
  })

  it('shows a spinner while submitting and an inline alert when sending failed', () => {
    const submitting = render(controller({ submitting: true, canConfirmCurrentQuestion: true, canSubmit: true }))
    expect(submitting).toContain('aria-busy="true"')
    expect(submitting).toContain('Submitting…')

    const failed = render(controller({ error: 'runtime unavailable' }))
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Answer not delivered: runtime unavailable')
    expect(render(controller({ error: '' }))).toContain('Answer not delivered. Try again.')
  })

  it('renders nothing without an active request', () => {
    expect(render(controller({ active: false }))).toBe('')
  })
})
