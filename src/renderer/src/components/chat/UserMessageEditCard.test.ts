// @vitest-environment jsdom

import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { UserMessageEditCard } from './UserMessageEditCard'

describe('UserMessageEditCard', () => {
  it('shows key hints, wires cancel and resend, and gates resend on submitDisabled', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const render = (submitDisabled: boolean): void => {
      root.render(createElement(UserMessageEditCard, {
        value: 'hello',
        onChange: () => {},
        references: [],
        onReferencesChange: () => {},
        textareaRef: createRef<HTMLTextAreaElement>(),
        onSubmit,
        onCancel,
        submitDisabled
      }))
    }

    await act(async () => render(false))
    expect(container.querySelector('[data-user-message-edit]')).not.toBeNull()
    expect(container.querySelectorAll('[data-rewind-hint] kbd').length).toBe(3)
    const resend = container.querySelector<HTMLButtonElement>('[data-rewind-resend]')!
    const cancel = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Cancel')!
    await act(async () => {
      resend.click()
      cancel.click()
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)

    await act(async () => render(true))
    expect(container.querySelector<HTMLButtonElement>('[data-rewind-resend]')!.disabled).toBe(true)

    act(() => root.unmount())
    container.remove()
  })
})
