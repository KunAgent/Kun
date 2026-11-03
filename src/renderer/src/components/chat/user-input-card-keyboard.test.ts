// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserInputQuestion } from '../../agent/types'
import i18n from '../../i18n'
import { FloatingComposerUserInputPanel } from './FloatingComposerUserInputPanel'
import {
  useComposerUserInput,
  type PendingUserInputBlock,
  type ResolveUserInput
} from './use-composer-user-input'

const t = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options)

const storage: UserInputQuestion = {
  id: 'storage',
  header: 'State',
  question: 'Where should login state live?',
  options: [
    { label: 'Zustand store', description: 'Matches chat-store', recommended: true },
    { label: 'React Context', description: 'Settings only' },
    { label: 'localStorage', description: 'Survives reloads' }
  ]
}

const naming: UserInputQuestion = {
  id: 'naming',
  header: 'Name',
  question: 'Which prefix?',
  options: [
    { label: 'auth', description: '' },
    { label: 'session', description: '' }
  ]
}

const pipelines: UserInputQuestion = {
  id: 'pipelines',
  header: 'Scope',
  question: 'Which pipelines move?',
  selectionMode: 'multiple',
  maxSelections: 2,
  options: [
    { label: 'Build', description: '' },
    { label: 'Unit tests', description: '' },
    { label: 'Signing', description: '' }
  ]
}

const freeform: UserInputQuestion = {
  id: 'service',
  header: '',
  question: 'Service name?',
  options: []
}

function block(questions: UserInputQuestion[]): PendingUserInputBlock {
  return { kind: 'user_input', id: 'ask-1', requestId: 'req-1', questions, status: 'pending', live: true }
}

function Harness({ value, resolve }: { value: PendingUserInputBlock; resolve: ResolveUserInput }): ReactElement {
  const controller = useComposerUserInput(value, resolve)
  return createElement('div', { 'data-floating-composer': true },
    controller.active ? createElement(FloatingComposerUserInputPanel, { controller, t }) : null)
}

describe('ask-user card keyboard and answers', () => {
  let host: HTMLDivElement
  let root: Root
  let resolve: ReturnType<typeof vi.fn<ResolveUserInput>>

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(100_000)
    resolve = vi.fn<ResolveUserInput>(async () => undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const el = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  // Every new question re-arms the card for 500 ms; tests act as a person would, later.
  const arm = (): void => { vi.setSystemTime(Date.now() + 1_000) }
  const mount = async (questions: UserInputQuestion[]): Promise<void> => {
    await act(async () => root.render(createElement(Harness, { value: block(questions), resolve })))
    arm()
  }
  const press = async (target: Element, init: KeyboardEventInit): Promise<void> => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    })
  }
  const type = async (textarea: HTMLTextAreaElement, value: string): Promise<void> => {
    await act(async () => {
      textarea.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const click = async (selector: string): Promise<void> => {
    await act(async () => el<HTMLButtonElement>(selector).click())
  }
  const hint = (): string | null => host.querySelector('.ds-interrupt-hint-text')?.textContent ?? null
  const questionNumber = (): string | null =>
    el('[data-composer-stack-item="user-input"]').getAttribute('data-user-input-question')

  it('picks with digits, advances, and submits with Enter on the last question', async () => {
    await mount([storage, naming])
    expect(document.activeElement).toBe(el('[role="listbox"]'))

    await press(el('[role="listbox"]'), { key: '2' })
    expect(questionNumber()).toBe('2')
    expect(resolve).not.toHaveBeenCalled()
    arm()

    await press(el('[role="listbox"]'), { key: 'ArrowDown' })
    await press(el('[role="listbox"]'), { key: 'Enter' })
    await press(el('[role="listbox"]'), { key: 'Enter' })
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [
        { id: 'storage', label: 'React Context', value: 'React Context' },
        { id: 'naming', label: 'session', value: 'session' }
      ]
    })
  })

  it('keeps a clicked pick for review until Submit', async () => {
    await mount([storage])
    await click('[data-interrupt-option="0"]')
    expect(resolve).not.toHaveBeenCalled()
    expect(el('[data-interrupt-option="0"]').getAttribute('aria-selected')).toBe('true')

    await click('[data-user-input-primary="submit"]')
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [{ id: 'storage', label: 'Zustand store', value: 'Zustand store' }]
    })
  })

  it('turns typed text into an Other answer and clears the single-choice pick', async () => {
    await mount([storage])
    await click('[data-interrupt-option="1"]')
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await type(textarea, 'Jotai atoms')
    expect(host.querySelector('[aria-selected="true"]')).toBeNull()
    expect(el('[data-interrupt-freetext]').getAttribute('data-selected')).toBe('true')

    await press(textarea, { key: 'Enter', shiftKey: true })
    expect(resolve).not.toHaveBeenCalled()
    await press(textarea, { key: 'Enter' })
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [{ id: 'storage', label: 'Other', value: 'Jotai atoms' }]
    })
  })

  it('toggles with Space and digits, respects the limit, and combines the Other text', async () => {
    await mount([pipelines, naming])
    const listbox = el('[role="listbox"]')
    await press(listbox, { key: ' ' })
    await press(listbox, { key: '2' })
    expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(2)
    expect(el('[data-interrupt-option="2"]').getAttribute('aria-disabled')).toBe('true')
    expect(el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea').disabled).toBe(true)
    await press(listbox, { key: '3' })
    expect(el('[data-interrupt-option="2"]').getAttribute('aria-selected')).toBe('false')

    // Enter moves on; Esc on the second question comes back with the picks intact.
    await press(listbox, { key: 'Enter' })
    expect(questionNumber()).toBe('2')
    arm()
    await press(el('[role="listbox"]'), { key: 'Escape' })
    expect(questionNumber()).toBe('1')
    arm()
    expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(2)

    await press(el('[role="listbox"]'), { key: '2' })
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await type(textarea, 'Release notes')
    expect(el('[data-interrupt-option="2"]').getAttribute('aria-disabled')).toBe('true')
    await press(textarea, { key: 'Enter' })
    expect(questionNumber()).toBe('2')
    arm()

    await press(el('[role="listbox"]'), { key: '1' })
    expect(resolve).not.toHaveBeenCalled()
    await click('[data-user-input-primary="submit"]')
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [
        {
          id: 'pipelines',
          label: 'Other',
          value: 'Build, Release notes',
          labels: ['Build'],
          values: ['Build', 'Release notes']
        },
        { id: 'naming', label: 'auth', value: 'auth' }
      ]
    })
  })

  it('confirms the visible text with Enter in the text row over an option clicked after typing', async () => {
    await mount([storage])
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await type(textarea, 'Jotai atoms')
    await click('[data-interrupt-option="1"]')
    expect(el('[data-interrupt-option="1"]').getAttribute('aria-selected')).toBe('true')

    await act(async () => textarea.focus())
    await press(textarea, { key: 'Enter' })
    expect(resolve).toHaveBeenCalledOnce()
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [{ id: 'storage', label: 'Other', value: 'Jotai atoms' }]
    })
  })

  it('reads Enter from the text field as the text even when the active row is stale', async () => {
    await mount([storage])
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await type(textarea, 'Jotai atoms')
    await click('[data-interrupt-option="1"]')
    // No focus event reached the row (e.g. the window was in the background).
    await press(textarea, { key: 'Enter' })
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [{ id: 'storage', label: 'Other', value: 'Jotai atoms' }]
    })
  })

  it('leaves the text field on Esc for an active option row and skips on the first question', async () => {
    await mount([storage])
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await type(textarea, 'draft')
    expect(hint()).toBe('Enter to submit, Shift+Enter for a new line')
    await press(textarea, { key: 'Escape' })
    expect(resolve).not.toHaveBeenCalled()
    const listbox = el('[role="listbox"]')
    expect(document.activeElement).toBe(listbox)
    expect(textarea.value).toBe('draft')
    // Nothing picked: the last option becomes the active row, and the hint
    // announces what the next Esc does.
    expect(listbox.getAttribute('aria-activedescendant')).toBe(el('[data-interrupt-option="2"]').id)
    expect(el('[data-interrupt-freetext]').hasAttribute('data-active')).toBe(false)
    expect(hint()).toContain('Esc to skip')

    await press(listbox, { key: 'Escape' })
    expect(resolve).toHaveBeenCalledWith('ask-1', { kind: 'cancel' })
  })

  it('returns from the text field to the picked option on Esc', async () => {
    await mount([storage])
    await click('[data-interrupt-option="1"]')
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    await act(async () => textarea.focus())
    await press(textarea, { key: 'Escape' })
    expect(el('[role="listbox"]').getAttribute('aria-activedescendant')).toBe(el('[data-interrupt-option="1"]').id)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('goes back, then skips, with Esc in the only row of a question without options', async () => {
    await mount([naming, freeform])
    await press(el('[role="listbox"]'), { key: '1' })
    expect(questionNumber()).toBe('2')
    arm()
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    expect(document.activeElement).toBe(textarea)
    await type(textarea, 'billing')
    expect(hint()).toBe('Enter to submit, Shift+Enter for a new line, Esc to go back')

    await press(textarea, { key: 'Escape' })
    expect(questionNumber()).toBe('1')
    arm()
    expect(document.activeElement).toBe(el('[role="listbox"]'))
    expect(resolve).not.toHaveBeenCalled()
  })

  it('skips with Esc in the text row of a lone question without options', async () => {
    await mount([freeform])
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    expect(hint()).toBe('Enter to submit, Shift+Enter for a new line, Esc to skip')
    await press(textarea, { key: 'Escape' })
    expect(resolve).toHaveBeenCalledWith('ask-1', { kind: 'cancel' })
  })

  it('answers a question without options from its focused text row', async () => {
    await mount([freeform])
    const textarea = el<HTMLTextAreaElement>('[data-interrupt-freetext] textarea')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(textarea)

    await type(textarea, 'billing-api')
    await press(textarea, { key: 'Enter' })
    expect(resolve).toHaveBeenCalledWith('ask-1', {
      kind: 'submit',
      answers: [{ id: 'service', label: 'Answer', value: 'billing-api' }]
    })
  })

  it('shows an inline alert when the answer was not delivered and allows a retry', async () => {
    resolve.mockRejectedValueOnce(new Error('runtime unavailable'))
    await mount([storage])
    await click('[data-interrupt-option="0"]')
    await click('[data-user-input-primary="submit"]')
    expect(el('[role="alert"]').textContent).toContain('Answer not delivered: runtime unavailable')

    await click('[data-user-input-primary="submit"]')
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows the redacted runtime summary instead of the error envelope', async () => {
    resolve.mockRejectedValueOnce(new Error(JSON.stringify({
      code: 'conflict',
      message: 'user input already resolved: input_42'
    })))
    await mount([storage])
    await click('[data-interrupt-option="0"]')
    await click('[data-user-input-primary="submit"]')
    const alert = el('[role="alert"]').textContent ?? ''
    expect(alert).toBe('Answer not delivered: user input already resolved: input_42')
    expect(alert).not.toContain('{')
  })

  it('brings the keyboard back to the card when a submit fails', async () => {
    let fail: (reason: unknown) => void = () => undefined
    resolve.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject }))
    await mount([storage])
    await click('[data-interrupt-option="0"]')
    // The browser drops focus from the primary button once it turns disabled
    // while sending (jsdom does not), so the click starts from the page.
    const primary = el<HTMLButtonElement>('[data-user-input-primary="submit"]')
    await act(async () => {
      primary.focus()
      primary.blur()
    })
    await click('[data-user-input-primary="submit"]')
    expect(primary.disabled).toBe(true)
    expect(document.activeElement).toBe(document.body)

    await act(async () => fail(new Error(JSON.stringify({ code: 'runtime_unhealthy', message: 'runtime unhealthy' }))))
    expect(el('[role="alert"]').textContent).toContain('The local runtime is currently unavailable')
    expect(document.activeElement).toBe(el('[role="listbox"]'))

    await press(el('[role="listbox"]'), { key: 'Enter' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })
})
