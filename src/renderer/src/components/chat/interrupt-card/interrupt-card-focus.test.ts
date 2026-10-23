// @vitest-environment jsdom
import { Fragment, act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import {
  InterruptCard,
  InterruptFooter,
  InterruptFreeTextRow,
  InterruptOptionList,
  InterruptOptionRow,
  InterruptPrimaryButton
} from './interrupt-card-primitives'
import { INTERRUPT_ARM_DELAY_MS } from './interrupt-arming'
import { useInterruptOptionNavigation } from './use-interrupt-option-navigation'

type Question = { id: string; options: string[] }

const onDigit = vi.fn()
const onSelect = vi.fn()
const onPrimary = vi.fn()

function Card({ question }: { question: Question }): ReactElement {
  const nav = useInterruptOptionNavigation({
    optionCount: question.options.length,
    hasFreeText: true,
    resetKey: question.id,
    armDelayMs: 0,
    onDigit
  })
  const list = createElement(InterruptOptionList, {
    id: `list-${question.id}`,
    listboxRef: nav.listboxRef,
    activeIndex: nav.activeIndex,
    after: createElement(InterruptFreeTextRow, {
      index: question.options.length,
      value: '',
      onChange: vi.fn(),
      placeholder: 'Type',
      textareaRef: nav.freeTextRef,
      autoFocus: question.options.length === 0
    }),
    children: question.options.map((label, index) => createElement(InterruptOptionRow, {
      key: label, listId: `list-${question.id}`, index, label, selected: false, onSelect
    }))
  })
  const footer = createElement(InterruptFooter, null, createElement(InterruptPrimaryButton, { onClick: onPrimary }, 'Submit'))
  return createElement(InterruptCard, {
    ariaLabel: 'Ask', marker: 'user-input', focusKey: question.id, onKeyDown: nav.onKeyDown, children: createElement(Fragment, null, list, footer)
  })
}

/** Composer stand-in: the editor stays mounted (hidden + inert) under the card. */
function Composer({ question }: { question: Question | null }): ReactElement {
  return createElement('div', { 'data-floating-composer': true },
    question ? createElement(Card, { question }) : null,
    createElement('div', { hidden: question ? true : undefined, inert: question ? true : undefined },
      createElement('textarea', { 'data-editor': true, defaultValue: 'step ' })))
}

const twoOptions: Question = { id: 'q1', options: ['Zustand store', 'React context'] }
const freeForm: Question = { id: 'q2', options: [] }

describe('InterruptCard focus and arming', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    onDigit.mockReset(); onSelect.mockReset(); onPrimary.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(50_000)
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

  const render = async (question: Question | null): Promise<void> => {
    await act(async () => root.render(createElement(Composer, { question })))
  }
  const el = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const press = async (target: Element, init: KeyboardEventInit): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    await act(async () => { target.dispatchEvent(event) })
    return event
  }

  it('parks on the card when it replaces an editor the user is typing in', async () => {
    await render(null)
    el('[data-editor]').focus()
    await render(twoOptions)
    const card = el('[data-composer-stack-item="user-input"]')
    expect(document.activeElement).toBe(card)

    // The first decision key only wakes the card.
    const first = await press(card, { key: '1' })
    expect(first.defaultPrevented).toBe(true)
    expect(onDigit).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(el('[role="listbox"]'))

    await press(el('[role="listbox"]'), { key: '1' })
    expect(onDigit).toHaveBeenCalledWith(0, expect.anything())
  })

  it('lets navigation keys and pointer interaction unpark the card', async () => {
    await render(null)
    el('[data-editor]').focus()
    await render(twoOptions)
    const card = el('[data-composer-stack-item="user-input"]')
    await act(async () => { card.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    await press(card, { key: '2' })
    expect(onDigit).toHaveBeenCalledWith(1, expect.anything())

    onDigit.mockReset()
    await render(null)
    el('[data-editor]').focus()
    await render(twoOptions)
    await press(el('[data-composer-stack-item="user-input"]'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(el('[role="listbox"]'))
  })

  it('focuses the option list straight away when focus was free', async () => {
    await render(twoOptions)
    expect(document.activeElement).toBe(el('[role="listbox"]'))
    await press(el('[role="listbox"]'), { key: '2' })
    expect(onDigit).toHaveBeenCalledWith(1, expect.anything())
  })

  it('moves focus to the free-text row when the next question has no options', async () => {
    await render(twoOptions)
    expect(document.activeElement).toBe(el('[role="listbox"]'))
    await render(freeForm)
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(el('textarea[data-interrupt-autofocus]'))
  })

  it('ignores clicks on options and footer buttons until the card is armed', async () => {
    await render(twoOptions)
    await act(async () => el<HTMLButtonElement>('[data-interrupt-option="0"]').click())
    await act(async () => el<HTMLButtonElement>('[data-variant="primary"]').click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(onPrimary).not.toHaveBeenCalled()

    vi.setSystemTime(50_000 + INTERRUPT_ARM_DELAY_MS)
    await act(async () => el<HTMLButtonElement>('[data-interrupt-option="0"]').click())
    await act(async () => el<HTMLButtonElement>('[data-variant="primary"]').click())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }))
    expect(onPrimary).toHaveBeenCalledOnce()

    // A new request re-arms: the second half of a double click must not decide it.
    await render({ id: 'q3', options: ['Allow', 'Deny'] })
    await act(async () => el<HTMLButtonElement>('[data-interrupt-option="0"]').click())
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
