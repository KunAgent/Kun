// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { MobilePendingActions } from './MobilePendingActions'

let root: Root
let host: HTMLDivElement
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('mobile pending actions', () => {
  it('resolves the latest pending approval explicitly', () => {
    const resolveApproval = vi.fn(async () => undefined)
    const blocks = [{ kind: 'approval', id: 'block', approvalId: 'approval', summary: 'Run command', status: 'pending' }] as ChatBlock[]
    act(() => root.render(createElement(MobilePendingActions, { blocks, resolveApproval, resolveUserInput: vi.fn() })))
    const buttons = host.querySelectorAll('button')
    act(() => (buttons[1] as HTMLButtonElement).click())
    expect(resolveApproval).toHaveBeenCalledWith('block', 'allow')
    expect(resolveApproval).toHaveBeenCalledTimes(1)
  })

  it('renders live user input in preference to approvals', () => {
    const blocks = [
      { kind: 'approval', id: 'approval', approvalId: 'a', summary: 'Approve', status: 'pending' },
      { kind: 'user_input', id: 'input', requestId: 'i', status: 'pending', live: true,
        questions: [{ id: 'q', question: 'Choose', options: [{ label: 'One', description: 'First' }] }] }
    ] as ChatBlock[]
    act(() => root.render(createElement(MobilePendingActions, {
      blocks, resolveApproval: vi.fn(), resolveUserInput: vi.fn(async () => undefined)
    })))
    expect(host.textContent).toContain('Choose')
    expect(host.textContent).not.toContain('Approve')
  })
})
