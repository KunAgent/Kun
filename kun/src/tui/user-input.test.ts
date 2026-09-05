import { describe, expect, it } from 'vitest'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  createUserInputSession,
  isUserInputSessionComplete,
  orderedUserInputAnswers,
  toggleCurrentUserInputOption
} from './user-input.js'

describe('structured terminal user input', () => {
  it('collects single, multiple, and free-form answers in question order', () => {
    let session = createUserInputSession({
      inputId: 'input_1',
      prompt: 'Questions',
      questions: [
        { header: 'Mode', id: 'mode', question: 'Choose mode', options: [{ label: 'Fast', description: '', recommended: true }] },
        {
          header: 'Targets',
          id: 'targets',
          question: 'Choose targets',
          options: [{ label: 'Web', description: '' }, { label: 'CLI', description: '' }],
          selectionMode: 'multiple',
          minSelections: 1,
          maxSelections: 2
        },
        { header: 'Note', id: 'note', question: 'Add a note', options: [] }
      ]
    })
    session = confirmCurrentUserInput(session)
    session = toggleCurrentUserInputOption(session)
    session = confirmCurrentUserInput(session)
    session = answerCurrentUserInputWithText(session, 'ship it')

    expect(isUserInputSessionComplete(session)).toBe(true)
    expect(orderedUserInputAnswers(session)).toEqual([
      { id: 'mode', label: 'Fast', value: 'Fast' },
      { id: 'targets', label: 'Web', value: 'Web', labels: ['Web'], values: ['Web'] },
      { id: 'note', label: 'Answer', value: 'ship it' }
    ])
  })

  it('supports a typed custom answer for an option question', () => {
    let session = createUserInputSession({
      inputId: 'input_2',
      prompt: 'Choose',
      questions: [{ header: 'Choice', id: 'choice', question: 'Choose', options: [{ label: 'A', description: '' }] }]
    })
    session = answerCurrentUserInputWithText(session, 'custom')
    expect(orderedUserInputAnswers(session)).toEqual([
      { id: 'choice', label: 'Other', value: 'custom' }
    ])
  })
})
