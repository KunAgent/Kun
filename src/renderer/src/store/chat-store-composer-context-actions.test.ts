import { describe, expect, it } from 'vitest'
import { createComposerContextActions } from './chat-store-composer-context-actions'
import type { ChatState } from './chat-store-types'

const attachment = {
  schemaVersion: 1 as const,
  id: 'video-selection',
  title: 'Interview selection',
  summary: 'Revision 4 with two selected clips',
  reference: { projectId: 'project-1', selectedItemIds: ['clip-1', 'clip-2'] },
  revision: 4,
  generation: 7,
  attachmentId: `extension-context:${'a'.repeat(64)}`,
  provenance: {
    extensionId: 'acme.video-editor',
    extensionVersion: '1.1.0',
    viewContributionId: 'extension:acme.video-editor/editor',
    workspaceId: 'b'.repeat(64)
  }
}

function harness() {
  let state = {
    route: 'chat',
    activeThreadId: 'thread-1',
    workspaceRoot: '/workspace/a',
    threads: [{ id: 'thread-1', workspace: '/workspace/a' }],
    extensionComposerContexts: []
  } as unknown as ChatState
  const actions = createComposerContextActions({
    get: () => state,
    set: (update) => {
      const patch = typeof update === 'function' ? update(state) : update
      state = { ...state, ...patch }
    }
  })
  return { actions, getState: () => state }
}

describe('extension composer context store fence', () => {
  it('accepts only the active chat workspace and ignores stale revisions', () => {
    const { actions, getState } = harness()
    actions.attachExtensionComposerContext({ workspaceRoot: '/workspace/b', attachment })
    expect(getState().extensionComposerContexts).toEqual([])

    actions.attachExtensionComposerContext({ workspaceRoot: '/workspace/A', attachment })
    expect(getState().extensionComposerContexts).toEqual([])

    actions.attachExtensionComposerContext({ workspaceRoot: '/workspace/a/', attachment })
    expect(getState().extensionComposerContexts).toHaveLength(1)

    actions.attachExtensionComposerContext({
      workspaceRoot: '/workspace/a',
      attachment: { ...attachment, revision: 3, generation: 6 }
    })
    expect(getState().extensionComposerContexts[0]?.attachment).toMatchObject({
      revision: 4,
      generation: 7
    })

    actions.attachExtensionComposerContext({
      workspaceRoot: '/workspace/a',
      attachment: { ...attachment, revision: 5, generation: 8, summary: 'New selection' }
    })
    expect(getState().extensionComposerContexts[0]?.attachment).toMatchObject({
      revision: 5,
      generation: 8,
      summary: 'New selection'
    })
  })

  it('removes a chip by Host attachment id', () => {
    const { actions, getState } = harness()
    actions.attachExtensionComposerContext({ workspaceRoot: '/workspace/a', attachment })
    actions.removeExtensionComposerContext(attachment.attachmentId)
    expect(getState().extensionComposerContexts).toEqual([])
  })
})
