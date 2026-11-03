// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { ToolCancelButton } from './message-timeline-process-controls'

function block(canCancel?: boolean, state = 'running'): ToolBlock {
  return { kind: 'tool', id: 'tool-a', summary: 'read', status: 'running', meta: { callId: 'call-a',
    toolName: 'read', ...(canCancel === undefined ? {} : {
      toolPresentation: { version: 1, kind: 'read', state, canCancel, source: 'native' }
    }) } }
}

describe('tool cancellation capability', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  it('requires an explicit active per-tool capability, including for legacy and ACP calls', async () => {
    const cancel = vi.fn(async () => true)
    for (const tool of [block(), block(false), block(true, 'pending'), block(true, 'canceled'),
      { ...block(false), meta: { ...block(false).meta, toolName: 'acp:execute', acpKind: 'execute' } }]) {
      await act(async () => root.render(createElement(ToolCancelButton, { block: tool, processing: true, onCancelToolCall: cancel })))
      expect(container.querySelector('button')).toBeNull()
    }
    expect(cancel).not.toHaveBeenCalled()
  })

  it('submits one supported cancellation and makes a rejected request retryable', async () => {
    let finish!: (value: boolean) => void
    const cancel = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    await act(async () => root.render(createElement(ToolCancelButton, { block: block(true), processing: true, onCancelToolCall: cancel })))
    const button = container.querySelector('button')!
    await act(async () => { button.click(); button.click() })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    await act(async () => finish(false))
    expect(button.disabled).toBe(false)
  })
})
