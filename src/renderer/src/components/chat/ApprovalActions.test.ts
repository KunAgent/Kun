import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalActions } from './ApprovalActions'

const options = [
  { optionId: 'opaque-once', kind: 'allow_once' as const, name: 'Yes, this request' },
  { optionId: 'opaque-always', kind: 'allow_always' as const, name: 'Remember my decision' },
  { optionId: 'opaque-never', kind: 'reject_always' as const, name: 'Never run this' }
]
const t = (key: string) => key
let renderer: ReactTestRenderer
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()) })

describe('approval option controls', () => {
  it('preserves the source labels and sends the chosen opaque option ID only after a trusted click', async () => {
    const onDecide = vi.fn()
    await act(async () => { renderer = create(createElement(ApprovalActions, { options, submitting: false, t, onDecide })) })
    const buttons = renderer.root.findAllByType('button')
    expect(buttons[1].findAllByType('span')[0].children).toEqual(['Remember my decision'])
    act(() => buttons[1].props.onClick({ isTrusted: false }))
    expect(onDecide).not.toHaveBeenCalled()
    act(() => buttons[1].props.onClick({ isTrusted: true }))
    expect(onDecide).toHaveBeenCalledWith('allow', { optionId: 'opaque-always' })
    act(() => buttons[2].props.onClick({ isTrusted: true }))
    expect(onDecide).toHaveBeenLastCalledWith('deny', { optionId: 'opaque-never' })
    act(() => buttons[3].props.onClick({ isTrusted: true }))
    expect(onDecide).toHaveBeenLastCalledWith('deny', { cancelled: true })
  })

  it('disables every provider option and cancellation while submitting', async () => {
    await act(async () => { renderer = create(createElement(ApprovalActions, { options, submitting: true, t, onDecide: vi.fn() })) })
    expect(renderer.root.findAllByType('button').every((button) => button.props.disabled)).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['approvalSubmitting'])
  })
})
