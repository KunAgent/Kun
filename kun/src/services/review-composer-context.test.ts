import { describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { makeUserItem } from '../domain/item.js'
import { UserTurnItem } from '../contracts/items.js'
import type { ReviewSendRecord } from '../contracts/review.js'
import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'
import {
  createReviewContextResolver, MAX_TURN_REVIEW_CONTEXT_CHARS, resolveTurnReviewRequests
} from './review-composer-context.js'

const WS = 'tws_reviewfull01'
const REQUEST = 'rvq_reviewfull01'
const context: ComposerContextAttachmentJson = {
  schemaVersion: 1, id: 'review-request', title: 'Review', summary: '200 comments',
  reference: { kind: 'review-request', workspaceId: WS, requestId: REQUEST, text: 'forged preview' },
  revision: 1, generation: 0, attachmentId: `review-request-context:${'a'.repeat(64)}`,
  provenance: { source: 'review-request', workspaceId: 'b'.repeat(64) }
}
const thread = createThreadRecord({
  id: 'owner', title: 'Owner', workspace: '/project', model: 'test', mode: 'agent'
})
const record = (body: string): ReviewSendRecord => ({
  workspaceId: WS, requestId: REQUEST, round: 1, commentIds: [],
  target: { kind: 'manager' }, sentAt: '2026-09-30T00:00:00.000Z', title: 'Review', requestText: body
})
function harness(receipt: ReviewSendRecord | null = record('FULL BODY')) {
  const getSentRequest = vi.fn(async (_workspaceId: string, requestId: string) =>
    receipt ? { ...receipt, requestId } : null)
  const get = vi.fn(() => ({ ownerThreadId: 'owner', workspaceId: WS }) as TaskWorkspaceRecord)
  const resolve = createReviewContextResolver({ reviews: { getSentRequest }, taskWorkspaces: { get } })
  return { resolve, getSentRequest, get }
}

describe('complete review composer context', () => {
  it('persists and projects the complete immutable batch including content beyond 1 MiB', async () => {
    const body = 'review body\n'.repeat(110_000) + 'LAST COMMENT MUST ARRIVE'
    const { resolve } = harness(record(body))
    const reviews = await resolveTurnReviewRequests(thread, [context], resolve)
    const item = UserTurnItem.parse(makeUserItem({
      id: 'item', threadId: thread.id, turnId: 'turn', text: 'Apply the review',
      composerContexts: [context], reviewRequests: reviews
    }))
    const restored = UserTurnItem.parse(JSON.parse(JSON.stringify(item)))
    const projected = userMessageTextWithComposerContexts(restored)
    expect(projected).toContain('LAST COMMENT MUST ARRIVE')
    expect(restored.reviewRequests?.[0].body).toBe(body)
    expect(projected).toContain('untrusted reference data')
    expect(restored.text).toBe('Apply the review')
  })

  it('rejects foreign owners and workers even when their reference text looks valid', async () => {
    const { resolve, getSentRequest } = harness()
    await expect(resolve({ ...thread, id: 'foreign' }, [context])).rejects.toThrow(/another task/)
    await expect(resolve({ ...thread, executionUnit: { kind: 'worker', teamId: 'team', managerThreadId: 'manager', label: 'Worker', lifecycle: 'persistent', control: 'manager' } }, [context]))
      .rejects.toThrow(/another task/)
    expect(getSentRequest).not.toHaveBeenCalled()
  })

  it('rejects non-manager receipts, workspace mismatches, missing records, and legacy clipped-only references', async () => {
    for (const receipt of [
      null, { ...record('text'), target: { kind: 'worker' as const, workerId: 'worker' } },
      { ...record('text'), workspaceId: 'tws_other0001' },
      { ...record('text'), requestText: undefined }
    ]) {
      await expect(harness(receipt).resolve(thread, [context])).rejects.toThrow(/unavailable/)
    }
    await expect(harness().resolve(thread, [{ ...context, reference: { kind: 'review-request', text: 'clip' } }]))
      .rejects.toThrow(/durable workspace/)
    await expect(resolveTurnReviewRequests(thread, [context])).rejects.toThrow(/lookup is unavailable/)
  })

  it('deduplicates repeated references and rejects oversized combined attachments without truncation', async () => {
    const body = 'x'.repeat(MAX_TURN_REVIEW_CONTEXT_CHARS / 2)
    const { resolve } = harness(record(body))
    expect(await resolve(thread, [context, context])).toHaveLength(1)
    const extra = (suffix: string) => ({ ...context, reference: { ...context.reference, requestId: `rvq_${suffix}` } })
    await expect(resolve(thread, [context, extra('another001'), extra('another002')]))
      .rejects.toThrow(/per-turn size limit/)
  })
})
