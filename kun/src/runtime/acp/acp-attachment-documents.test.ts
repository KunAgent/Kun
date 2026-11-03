import { describe, expect, it } from 'vitest'
import type { AttachmentContent, AttachmentStore } from '../../attachments/attachment-store.js'
import { ACP_INLINE_DOCUMENT_MAX_CHARS, resolveAcpDocuments } from './acp-attachment-documents.js'

function content(overrides: Partial<AttachmentContent> & { id: string }): AttachmentContent {
  return {
    name: `${overrides.id}.txt`,
    kind: 'document',
    mimeType: 'text/plain',
    byteSize: 10,
    hash: 'hash',
    threadIds: ['thread-1'],
    workspaces: ['/repo'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    data: Buffer.from('body'),
    ...overrides
  }
}

function store(
  resolve: (id: string) => Promise<AttachmentContent>
): AttachmentStore {
  return { resolveContent: resolve } as unknown as AttachmentStore
}

describe('resolveAcpDocuments', () => {
  it('returns the stored text of a pasted-text attachment', async () => {
    const result = await resolveAcpDocuments(
      store(async () => content({ id: 'att_1', name: 'pasted-text-20260102-030405.txt', documentText: 'BEGIN\nEND' })),
      'thread-1',
      '/repo',
      ['att_1']
    )

    expect(result.unreadable).toEqual([])
    expect(result.documents).toEqual([{ name: 'pasted-text-20260102-030405.txt', text: 'BEGIN\nEND' }])
  })

  it('ignores image attachments, which travel as image payloads', async () => {
    const result = await resolveAcpDocuments(
      store(async () => content({ id: 'att_img', kind: 'image', mimeType: 'image/png' })),
      'thread-1',
      '/repo',
      ['att_img']
    )

    expect(result.documents).toEqual([])
    expect(result.unreadable).toEqual([])
  })

  it('reports missing and unreadable attachments instead of dropping them', async () => {
    const missing = new Error('attachment scope mismatch')
    const result = await resolveAcpDocuments(
      store(async (id) => {
        if (id === 'att_missing') throw missing
        return content({ id, name: 'scan.pdf', documentText: '   ' })
      }),
      'thread-1',
      '/repo',
      ['att_missing', 'att_empty']
    )

    expect(result.documents).toEqual([])
    expect(result.unreadable).toEqual(['att_missing', 'scan.pdf'])
  })

  it('stops at the shared inline budget and marks the truncated document', async () => {
    const body = 'x'.repeat(ACP_INLINE_DOCUMENT_MAX_CHARS + 25)
    const result = await resolveAcpDocuments(
      store(async () => content({ id: 'att_big', name: 'big.txt', documentText: body })),
      'thread-1',
      '/repo',
      ['att_big']
    )

    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]?.text).toHaveLength(ACP_INLINE_DOCUMENT_MAX_CHARS)
    expect(result.documents[0]?.truncated).toBe(true)
  })

  it('preserves an existing truncated flag from the store', async () => {
    const result = await resolveAcpDocuments(
      store(async () => content({ id: 'att_2', documentText: 'partial', truncated: true })),
      'thread-1',
      '/repo',
      ['att_2']
    )

    expect(result.documents[0]?.truncated).toBe(true)
  })

  it('returns nothing when the store is unavailable', async () => {
    await expect(resolveAcpDocuments(undefined, 'thread-1', '/repo', ['att_1']))
      .resolves.toEqual({ documents: [], unreadable: [] })
  })
})
