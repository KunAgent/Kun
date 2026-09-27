import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment
} from '@kun/extension-api'
import type { SendReviewResponse } from '@shared/review-comment'

/**
 * Manager-target review sends (docs/ade/11 §4.4): kun renders the batch and
 * returns a `composerContext`; the renderer pins it on the owner thread's
 * composer so it rides the user's next message as a "审查意见 ×N" card.
 */

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildReviewRequestAttachment(input: {
  workspaceRoot: string
  response: SendReviewResponse
  commentCount: number
}): Promise<ComposerContextAttachment | null> {
  const composer = input.response.composerContext
  if (!composer) return null
  const { request } = input.response
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(
    JSON.stringify({ workspace: request.target, requestId: request.requestId })
  )
  const clip = (value: string, max = 1_900) => Array.from(value).slice(0, max).join('')
  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `review-request-${identity.slice(0, 24)}`,
    title: clip(composer.title, 128),
    summary: `${input.commentCount} review comment${input.commentCount === 1 ? '' : 's'}`,
    reference: {
      kind: 'review-request',
      text: clip(composer.body),
      requestId: request.requestId,
      round: request.round,
      commentIds: request.commentIds
    },
    revision: Math.max(0, Math.floor(Date.now())),
    generation: 0,
    attachmentId: `review-request-context:${identity}`,
    provenance: { source: 'review-request', workspaceId }
  })
}
