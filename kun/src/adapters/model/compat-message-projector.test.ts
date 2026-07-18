import { describe, expect, it } from 'vitest'
import { makeUserItem } from '../../domain/item.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { projectCompatMessages } from './compat-message-projector.js'

const composerContextFixture = {
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

describe('compat composer context projection', () => {
  it('appends extension context once to USER content and never changes system content', () => {
    const user = makeUserItem({
      id: 'item-user',
      turnId: 'turn-1',
      threadId: 'thread-1',
      text: 'Use the selected clips',
      composerContexts: [composerContextFixture]
    })
    const request: ModelRequest = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      model: 'test-model',
      systemPrompt: 'stable-system-prefix',
      prefix: [],
      history: [user],
      tools: [],
      abortSignal: new AbortController().signal
    }

    const messages = projectCompatMessages(request, {
      thinkingMode: false,
      supportsImages: false
    })
    expect(messages[0]).toEqual({ role: 'system', content: 'stable-system-prefix' })
    const userContent = String(messages.find((message) => message.role === 'user')?.content ?? '')
    expect(userContent).toContain('Use the selected clips')
    expect(userContent).toContain('untrusted reference data')
    expect(userContent).toContain(composerContextFixture.attachmentId)
    expect(userContent.match(new RegExp(composerContextFixture.attachmentId, 'g'))).toHaveLength(1)
    expect(messages.filter((message) => message.role === 'system').map((message) => message.content))
      .toEqual(['stable-system-prefix'])
  })
})
