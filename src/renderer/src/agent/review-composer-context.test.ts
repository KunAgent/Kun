import { describe, expect, it } from 'vitest'
import { buildReviewRequestAttachment } from './review-composer-context'
import type { SendReviewResponse } from '@shared/review-comment'

const response: SendReviewResponse = {
  request: {
    workspaceId: 'tws_full00001', requestId: 'rvq_full00001', round: 1,
    target: { kind: 'manager' }, commentIds: ['rvc_full00001'], sentAt: '2026-09-30T00:00:00.000Z'
  },
  composerContext: { kind: 'review_request', title: 'Review round 1', body: 'Preview only' }
}

describe('review attachment reference', () => {
  it('carries opaque workspace/request identity without a clipped authoritative body', async () => {
    const attachment = await buildReviewRequestAttachment({ workspaceRoot: '/project', response, commentCount: 1 })
    expect(attachment?.reference).toMatchObject({
      kind: 'review-request', workspaceId: 'tws_full00001', requestId: 'rvq_full00001'
    })
    expect(attachment?.reference).not.toHaveProperty('text')
    expect(JSON.stringify(attachment)).not.toContain('Preview only')
  })

  it('rejects old responses without a durable workspace reference rather than silently clipping', async () => {
    await expect(buildReviewRequestAttachment({
      workspaceRoot: '/project', response: { ...response, request: { ...response.request, workspaceId: undefined } },
      commentCount: 1
    })).rejects.toThrow(/workspace reference/)
  })
})
