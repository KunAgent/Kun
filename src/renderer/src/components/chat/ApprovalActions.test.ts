import { act, createElement } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalActions, approvalActionList } from './ApprovalActions'

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

describe('numbered approval rows', () => {
  it('orders a plain request allow-first as rows and deny-first as buttons', () => {
    expect(approvalActionList(undefined, t, 'Send', 'rows').map((action) => [action.label, action.decision]))
      .toEqual([['Send', 'allow'], ['approvalDeny', 'deny']])
    expect(approvalActionList(undefined, t, undefined, 'buttons').map((action) => action.decision))
      .toEqual(['deny', 'allow'])
    // Runtime-offered scopes keep their own order in both layouts.
    expect(approvalActionList(options, t, undefined, 'rows').map((action) => action.choice))
      .toEqual([{ optionId: 'opaque-once' }, { optionId: 'opaque-always' }, { optionId: 'opaque-never' }, { cancelled: true }])
  })

  it('numbers every row and decides only after a trusted click', async () => {
    const onDecide = vi.fn()
    await act(async () => { renderer = create(createElement(ApprovalActions, { options, submitting: false, t, onDecide, layout: 'rows' })) })
    const rows = renderer.root.findAllByType('button')
    expect(rows.map((row) => row.props['data-approval-action-row'])).toEqual([1, 2, 3, 4])
    expect(rows[0].findAllByType('span')[0].children).toEqual(['1', '.'])
    // The scope reads as the row description when it differs from the label.
    expect(rows[1].findAllByType('span').map((span) => span.children.join(''))).toContain('approvalOption_allow_always')
    act(() => rows[0].props.onClick({ isTrusted: false }))
    expect(onDecide).not.toHaveBeenCalled()
    act(() => rows[0].props.onClick({ isTrusted: true }))
    expect(onDecide).toHaveBeenCalledWith('allow', { optionId: 'opaque-once' })
    act(() => rows[3].props.onClick({ isTrusted: true }))
    expect(onDecide).toHaveBeenLastCalledWith('deny', { cancelled: true })
  })

  it('disables the rows and reports progress while submitting', async () => {
    await act(async () => { renderer = create(createElement(ApprovalActions, { submitting: true, t, onDecide: vi.fn(), layout: 'rows' })) })
    const rows = renderer.root.findAllByType('button')
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.props.disabled)).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['approvalSubmitting'])
  })
})
