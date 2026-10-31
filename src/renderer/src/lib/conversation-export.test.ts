import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  buildConversationExportDocument,
  type ConversationExportLabels
} from './conversation-export'

const labels: ConversationExportLabels = {
  exportedAt: 'Exported',
  user: 'You',
  assistant: 'Kun',
  attachments: 'Attachments',
  referencedFiles: 'Referenced files',
  generatedFiles: 'Generated files',
  sources: 'Sources',
  attachment: 'Attachment'
}

describe('buildConversationExportDocument', () => {
  it('builds a clean localized transcript with safe references', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user-1',
        turnId: 'turn-1',
        createdAt: '2026-07-19T01:00:00.000Z',
        text: 'runtime-only prompt',
        meta: {
          displayText: 'Explain **this** code.',
          attachmentIds: ['opaque-secret-id', 'opaque-secret-id-2'],
          attachments: [{ id: 'opaque-secret-id', name: 'diagram.png' }],
          fileReferences: [{
            path: '/private/workspace/docs/spec.md',
            relativePath: 'docs/spec.md',
            name: 'spec.md',
            kind: 'file'
          }]
        }
      },
      { kind: 'reasoning', id: 'reasoning-1', text: 'private chain of thought' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'web search',
        status: 'success',
        detail: '/private/workspace/tool-output',
        meta: {
          turnId: 'turn-1',
          sources: [
            { title: 'Primary source', url: 'https://example.com/source' },
            { title: 'Duplicate', url: 'https://example.com/source' },
            { title: 'Local secret', url: 'file:///private/workspace/secret' }
          ],
          generatedFiles: [
            { name: 'report.pdf', relativePath: 'exports/report.pdf', absolutePath: '/private/report.pdf' },
            { absolutePath: '/private/unnamed.bin' }
          ]
        }
      },
      {
        kind: 'system',
        id: 'system-1',
        text: 'internal system event',
        detail: '/private/system-detail'
      },
      {
        kind: 'assistant',
        id: 'assistant-1',
        turnId: 'turn-1',
        createdAt: '2026-07-19T01:01:00.000Z',
        text: 'Here is the answer.\n\n```ts\nconst value = 1\n```'
      }
    ]

    const result = buildConversationExportDocument({
      title: 'Code review',
      blocks,
      locale: 'en',
      // Export filenames use the user's local calendar date.
      exportedAt: new Date(2026, 6, 19, 2),
      labels,
      busy: false
    })

    expect(result.messageCount).toBe(2)
    expect(result.defaultFileName).toBe('Code review-2026-07-19')
    expect(result.markdown).toContain('# Code review')
    expect(result.markdown).toContain('> Exported:')
    expect(result.markdown).toContain('## You')
    expect(result.markdown).toContain('Explain **this** code.')
    expect(result.markdown).toContain('diagram.png')
    expect(result.markdown).toContain('Attachment 2')
    expect(result.markdown).toContain('spec.md — `docs/spec.md`')
    expect(result.markdown).toContain('report.pdf — `exports/report.pdf`')
    expect(result.markdown).toContain('Primary source — <https://example.com/source>')
    expect(result.markdown.match(/https:\/\/example\.com\/source/g)).toHaveLength(1)
    expect(result.markdown).toContain('```ts\nconst value = 1\n```')
    expect(result.markdown).not.toContain('runtime-only prompt')
    expect(result.markdown).not.toContain('private chain of thought')
    expect(result.markdown).not.toContain('internal system event')
    expect(result.markdown).not.toContain('/private')
    expect(result.markdown).not.toContain('opaque-secret-id')
    expect(result.markdown).not.toContain('file:///')
  })

  it('excludes the entire active turn while keeping earlier completed turns', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'Completed question' },
      { kind: 'assistant', id: 'assistant-1', turnId: 'turn-1', text: 'Completed answer' },
      { kind: 'user', id: 'user-2', turnId: 'turn-2', text: 'Current question' },
      { kind: 'assistant', id: 'assistant-2', turnId: 'turn-2', text: 'Persisted partial answer' }
    ]

    const result = buildConversationExportDocument({
      title: 'Busy thread',
      blocks,
      locale: 'en',
      // Export filenames use the user's local calendar date.
      exportedAt: new Date(2026, 6, 19, 2),
      labels,
      busy: true,
      currentTurnId: 'turn-2',
      currentTurnUserId: 'user-2'
    })

    expect(result.messageCount).toBe(2)
    expect(result.markdown).toContain('Completed question')
    expect(result.markdown).toContain('Completed answer')
    expect(result.markdown).not.toContain('Current question')
    expect(result.markdown).not.toContain('Persisted partial answer')
  })

  it('falls back to the latest user block when busy ids are not available', () => {
    const result = buildConversationExportDocument({
      title: 'Fallback',
      blocks: [
        { kind: 'user', id: 'user-1', text: 'Done' },
        { kind: 'assistant', id: 'assistant-1', text: 'Finished' },
        { kind: 'user', id: 'user-2', text: 'Still running' }
      ],
      locale: 'en',
      // Export filenames use the user's local calendar date.
      exportedAt: new Date(2026, 6, 19, 2),
      labels,
      busy: true
    })

    expect(result.markdown).toContain('Done')
    expect(result.markdown).toContain('Finished')
    expect(result.markdown).not.toContain('Still running')
  })
})
