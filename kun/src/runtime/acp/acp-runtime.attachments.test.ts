import { describe, expect, test } from 'vitest'
import type { AttachmentContent, AttachmentStore } from '../../attachments/attachment-store.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

const PASTED_TEXT = [
  'PASTE-FIRST-MARKER',
  ...Array.from({ length: 900 }, (_, index) => `粘贴正文第 ${index} 行`),
  'PASTE-LAST-MARKER'
].join('\n')

function attachment(overrides: Partial<AttachmentContent> & { id: string }): AttachmentContent {
  return {
    name: `${overrides.id}.txt`,
    kind: 'document',
    mimeType: 'text/plain',
    byteSize: 1024,
    hash: 'hash',
    threadIds: ['thread_1'],
    workspaces: ['/workspace'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: Buffer.from('body'),
    ...overrides
  }
}

function storeOf(entries: AttachmentContent[]): AttachmentStore {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return {
    resolveContent: async (id: string) => {
      const found = byId.get(id)
      if (!found) throw new Error(`missing attachment ${id}`)
      return found
    }
  } as unknown as AttachmentStore
}

function userItem(attachmentIds: string[]): TurnItem {
  return {
    id: 'item_turn_1_user',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'user',
    kind: 'user_message',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '这种第三方agent 无法接收kun复制的长文本',
    attachmentIds
  } as TurnItem
}

function promptBlocks(promptParams: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const prompt = promptParams?.prompt
  return Array.isArray(prompt) ? prompt as Array<Record<string, unknown>> : []
}

describe('ACP runtime attachment delivery', () => {
  test('a text-only agent receives the pasted text body, not just a file card', async () => {
    const h = await makeHarness('text-only-attachments.json', {
      turn: { prompt: '这种第三方agent 无法接收kun复制的长文本' },
      items: [userItem(['att_doc'])],
      deps: {
        attachmentStore: storeOf([
          attachment({
            id: 'att_doc',
            name: 'pasted-text-20260102-030405.txt',
            documentText: PASTED_TEXT
          })
        ])
      }
    })

    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    const blocks = promptBlocks(h.requests('session/prompt')[0]?.params)
    const text = blocks.filter((block) => block.type === 'text').map((block) => String(block.text ?? '')).join('\n')
    expect(text).toContain('PASTE-FIRST-MARKER')
    expect(text).toContain('PASTE-LAST-MARKER')
    expect(text).toContain(PASTED_TEXT)
    expect(blocks.some((block) => block.type === 'image')).toBe(false)
  })

  test('an image-capable agent still receives document text alongside images', async () => {
    const h = await makeHarness('basic-chat.json', {
      turn: { prompt: 'see attachments' },
      items: [userItem(['att_doc', 'att_img'])],
      deps: {
        attachmentStore: storeOf([
          attachment({ id: 'att_doc', name: 'notes.txt', documentText: 'DOCUMENT-BODY' }),
          attachment({ id: 'att_img', name: 'shot.png', kind: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3]) })
        ])
      }
    })

    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    const blocks = promptBlocks(h.requests('session/prompt')[0]?.params)
    expect(blocks.some((block) => block.type === 'image')).toBe(true)
    expect(blocks.filter((block) => block.type === 'text').map((block) => String(block.text ?? '')).join('\n'))
      .toContain('DOCUMENT-BODY')
  })

  test('an unreadable attachment is named in the prompt instead of silently dropped', async () => {
    const h = await makeHarness('text-only-attachments.json', {
      turn: { prompt: 'scan it' },
      items: [userItem(['att_missing'])],
      deps: { attachmentStore: storeOf([]) }
    })

    expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')

    const text = promptBlocks(h.requests('session/prompt')[0]?.params)
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('\n')
    expect(text).toContain('could not be read')
    expect(text).toContain('att_missing')
  })
})
