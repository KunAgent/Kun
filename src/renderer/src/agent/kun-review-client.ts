import type {
  CreateReviewCommentInput,
  ReviewCommentFile,
  SendReviewInput,
  SendReviewResponse,
  UpdateReviewCommentInput
} from '@shared/review-comment'
import { kunReviewsPath } from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'

/**
 * /v1/reviews client surface (docs/ade/11 §4): per-workspace review
 * comments shared with every client, plus the batched send endpoint that
 * renders the deterministic revision request in kun.
 */
export function createKunReviewClient() {
  const call = async <T>(
    workspaceId: string,
    suffix: string,
    method: string,
    fallback: string,
    body?: unknown
  ): Promise<T> => {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunReviewsPath(workspaceId, suffix),
      method,
      body === undefined ? undefined : JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, fallback))
    }
    return readRuntimeJson<T>(response.body, 'runtime returned an invalid response')
  }

  return {
    /** Comments + sent requests for one task workspace. */
    listReviewComments(workspaceId: string): Promise<ReviewCommentFile> {
      return call(workspaceId, '/comments', 'GET', 'failed to load review comments')
    },

    createReviewComment(
      workspaceId: string,
      input: CreateReviewCommentInput
    ): Promise<{ comment: import('@shared/review-comment').ReviewComment }> {
      return call(workspaceId, '/comments', 'POST', 'failed to create review comment', input)
    },

    updateReviewComment(
      workspaceId: string,
      commentId: string,
      input: UpdateReviewCommentInput
    ): Promise<{ comment: import('@shared/review-comment').ReviewComment }> {
      return call(
        workspaceId,
        `/comments/${encodeURIComponent(commentId)}`,
        'PATCH',
        'failed to update review comment',
        input
      )
    },

    /**
     * Batch pending comments into one revision request. The `manager`
     * target returns a `composerContext` for the renderer to attach to the
     * manager thread's next message (11 §4.4).
     */
    async sendReview(
      workspaceId: string,
      input: SendReviewInput,
      language?: string
    ): Promise<SendReviewResponse> {
      const suffix = `/send${language ? `?language=${encodeURIComponent(language)}` : ''}`
      try {
        return await call(workspaceId, suffix, 'POST', 'failed to send review comments', input)
      } catch (cause) {
        const error = parseRuntimeErrorBody(cause instanceof Error ? cause.message : String(cause), '')
        const issues = error.details
        const oldSchema = error.code === 'validation_error' && Array.isArray(issues) && issues.length > 0 && issues.every((issue) =>
          issue?.code === 'unrecognized_keys' && Array.isArray(issue.path) && issue.path.length === 0 &&
          Array.isArray(issue.keys) && issue.keys.length > 0 && issue.keys.every((key: unknown) => key === 'clientRequestId' || key === 'expectedRevision'))
        if (!oldSchema) throw cause
        // A schema rejection is before effects; never fall back on timeout or an unknown outcome.
        const legacy: SendReviewInput = { commentIds: input.commentIds, target: input.target, ...(input.note ? { note: input.note } : {}) }
        return call(workspaceId, suffix, 'POST', 'failed to send review comments', legacy)
      }
    }
  }
}

export type KunReviewClient = ReturnType<typeof createKunReviewClient>
