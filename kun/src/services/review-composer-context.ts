import type { ComposerContextAttachmentJson } from '../contracts/composer-context.js'
import { MAX_REVIEW_REQUEST_CHARS } from '../contracts/review.js'
import type { UserTurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { FileReviewStore } from '../ade/review-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'

export const MAX_TURN_REVIEW_CONTEXT_CHARS = MAX_REVIEW_REQUEST_CHARS * 2
export type ResolvedReviewRequests = NonNullable<UserTurnItem['reviewRequests']>
export type ReviewContextResolver = (
  thread: ThreadRecord, contexts: ComposerContextAttachmentJson[]
) => Promise<ResolvedReviewRequests>

/** Reject missing resolvers rather than silently delivering a clipped reference. */
export async function resolveTurnReviewRequests(
  thread: ThreadRecord,
  contexts: ComposerContextAttachmentJson[],
  resolve?: ReviewContextResolver
): Promise<ResolvedReviewRequests> {
  const reviews = contexts.filter((context) =>
    context.reference.kind === 'review-request' ||
    ('source' in context.provenance && context.provenance.source === 'review-request'))
  if (!reviews.length) return []
  if (!resolve) throw new Error('Review context lookup is unavailable; no turn was admitted')
  return resolve(thread, reviews)
}

/** Resolve immutable host records, never the client-supplied preview text. */
export function createReviewContextResolver(deps: {
  reviews: Pick<FileReviewStore, 'getSentRequest'>
  taskWorkspaces: Pick<TaskWorkspaceService, 'get'>
}): ReviewContextResolver {
  return async (thread, contexts) => {
    const output: ResolvedReviewRequests = []
    let size = 0
    const seen = new Set<string>()
    for (const context of contexts) {
      const { workspaceId, requestId } = context.reference
      if (context.reference.kind !== 'review-request' ||
          !('source' in context.provenance) || context.provenance.source !== 'review-request' ||
          typeof workspaceId !== 'string' || !/^tws_[a-z0-9]{8,32}$/.test(workspaceId) ||
          typeof requestId !== 'string' || !/^rvq_[a-z0-9]{8,32}$/.test(requestId)) {
        throw new Error('Review context is missing its durable workspace/request reference; attach it again')
      }
      const workspace = deps.taskWorkspaces.get(workspaceId)
      if (!workspace || workspace.ownerThreadId !== thread.id || thread.executionUnit?.kind === 'worker') {
        throw new Error('Review context belongs to another task; send it to the workspace owner')
      }
      const record = await deps.reviews.getSentRequest(workspaceId, requestId)
      if (!record || record.requestId !== requestId || record.workspaceId !== workspaceId || record.target.kind !== 'manager' ||
          !record.requestText || !record.title) {
        throw new Error('Complete manager review request is unavailable; no turn was admitted')
      }
      const key = `${workspaceId}:${requestId}`
      if (seen.has(key)) continue
      seen.add(key)
      size += record.requestText.length
      if (size > MAX_TURN_REVIEW_CONTEXT_CHARS) {
        throw new Error('Review attachments exceed the per-turn size limit; send fewer batches at once')
      }
      output.push({ workspaceId, requestId, title: record.title, body: record.requestText })
    }
    return output
  }
}
