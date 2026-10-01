import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../agent/types'
import { ChangeInspector } from './ChangeInspector'
const shared = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('../store/chat-store', () => ({ useChatStore: (selector: (state: unknown) => unknown) => selector({
  inspectorSelectedId: 'code-task-change', selectInspectorItem: shared.select, workspaceRoot: '/code-task'
}) }))

describe('isolated room change inspector', () => {
  let renderer: ReactTestRenderer
  afterEach(() => { if (renderer) act(() => renderer.unmount()); shared.select.mockClear() })
  it('keeps the Code task change selection while inspecting room changes', async () => {
    const blocks: ChatBlock[] = [{ kind: 'tool', id: 'room-change', summary: 'Update report', status: 'success',
      toolKind: 'file_change', filePath: '/room/report.md',
      detail: '--- a/report.md\n+++ b/report.md\n@@ -1 +1 @@\n-before\n+after' }]
    await act(async () => { renderer = create(createElement(ChangeInspector, {
      blocks, isolated: true, workspaceRoot: '/room', onCollapse: vi.fn()
    })) })
    const row = renderer.root.findAllByType('button').find((button) => button.props.className?.includes('items-start'))!
    act(() => row.props.onClick())
    act(() => renderer.update(createElement(ChangeInspector, {
      blocks: [], isolated: true, workspaceRoot: '/room', onCollapse: vi.fn()
    })))
    expect(shared.select).not.toHaveBeenCalled()
  })
})
