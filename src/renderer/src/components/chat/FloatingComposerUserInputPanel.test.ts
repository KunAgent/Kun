import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ComposerUserInputController } from './use-composer-user-input'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'

function controller(): ComposerUserInputController {
  const question = {
    header: 'Decision',
    id: 'choice',
    question: 'Choose an approach',
    options: [
      { label: 'Focused change', description: 'Smallest scope', recommended: true },
      { label: 'Broad redesign', description: 'Larger scope' }
    ],
    selectionMode: 'single' as const
  }
  return {
    active: true,
    block: { id: 'input_1' } as ComposerUserInputController['block'],
    questions: [question],
    index: 0,
    total: 1,
    currentQuestion: question,
    answers: {},
    isSelected: () => false,
    isOptionDisabled: () => false,
    isAnswered: () => false,
    chooseOption: () => undefined,
    canConfirmCurrentQuestion: false,
    confirmCurrentQuestion: () => undefined,
    canSubmit: false,
    submitting: false,
    submitAnswers: () => undefined,
    submitTypedText: () => false,
    goToIndex: () => undefined,
    cancel: () => undefined
  }
}

const t = (key: string): string => key === 'userInputRecommended' ? 'Recommended' : key

describe('FloatingComposerUserInputPanel recommendations', () => {
  for (const variant of ['main', 'compact'] as const) {
    it(`renders one recommendation badge without selecting it in ${variant} mode`, () => {
      const html = renderToStaticMarkup(createElement(FloatingComposerUserInputPanel, {
        controller: controller(),
        t,
        variant
      }))

      expect(html.match(/data-user-input-recommended/g)).toHaveLength(1)
      expect(html).toContain('Recommended')
      expect(html).toContain('Focused change')
      expect(html).toContain('Broad redesign')
      expect(html).toContain('aria-pressed="false"')
      expect(html).not.toContain('aria-pressed="true"')
      expect(html).toContain(`data-user-input-variant="${variant}"`)
    })
  }
})
