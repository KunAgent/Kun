import { describe, expect, it, vi } from 'vitest'
import type { AttachmentContent, AttachmentStore } from '../attachments/attachment-store.js'
import { MAX_TURN_ATTACHMENT_BYTES, MAX_TURN_ATTACHMENT_IDS } from '../contracts/attachments.js'
import type { Turn } from '../contracts/turns.js'
import { validateAndBindImageSteeringAttachments } from './turn-steering-attachments.js'

function turn(attachmentIds: string[] = []): Turn {
  return {
    id: 'turn_1',
    threadId: 'thread_1',
    orchestration: 'direct',
    status: 'running',
    prompt: 'inspect',
    createdAt: '2026-08-12T00:00:00.000Z',
    attachmentIds,
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: [],
    items: [],
    steering: []
  }
}

function image(id: string, byteSize = 1): AttachmentContent {
  return {
    id,
    name: `${id}.png`,
    kind: 'image',
    mimeType: 'image/png',
    byteSize,
    hash: id,
    threadIds: [],
    workspaces: [],
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    data: Buffer.alloc(byteSize)
  }
}

describe('image steering attachment validation', () => {
  it('rejects cumulative count and byte limits before binding', async () => {
    const bindScopes = vi.fn(async () => [])
    const resolveContent = vi.fn(async (id: string) => image(
      id,
      Math.floor(MAX_TURN_ATTACHMENT_BYTES / 2) + 1
    ))
    const attachmentStore = { bindScopes, resolveContent } as unknown as AttachmentStore
    const existingIds = Array.from(
      { length: MAX_TURN_ATTACHMENT_IDS },
      (_, index) => `att_existing_${index}`
    )

    await expect(validateAndBindImageSteeringAttachments({
      attachmentIds: ['att_new'],
      turn: turn(existingIds),
      steeringEntries: [{ attachmentIds: ['att_new'] }],
      attachmentStore,
      threadId: 'thread_1'
    })).rejects.toThrow(`turn exceeds ${MAX_TURN_ATTACHMENT_IDS} attachment limit`)
    expect(resolveContent).not.toHaveBeenCalled()

    await expect(validateAndBindImageSteeringAttachments({
      attachmentIds: ['att_second'],
      turn: turn(['att_first']),
      steeringEntries: [{ attachmentIds: ['att_second'] }],
      attachmentStore,
      threadId: 'thread_1'
    })).rejects.toThrow(`turn attachments exceed ${MAX_TURN_ATTACHMENT_BYTES} byte limit`)
    expect(bindScopes).not.toHaveBeenCalled()
  })
})
