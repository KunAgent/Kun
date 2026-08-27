import type { TurnItem } from '../contracts/items.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import { ContextEstimator } from '../loop/context-estimator.js'
import type { ChildResultRef, ChildRunRecord } from './delegation-runtime-contracts.js'
import type { ChildRunFailure } from '../contracts/subagent-retry.js'
import { PptReviewBundleV1 } from '../ppt/ppt-review-manifest.js'
import { PptDirectionBundleV1 } from '../ppt/ppt-direction-workflow.js'
import {
  FastContextEvidencePackSchema,
  type FastContextEvidencePack
} from './fast-context-evidence.js'

export const CHILD_RESULT_MAX_BYTES = 50 * 1_024
export const CHILD_RESULT_MAX_LINES = 2_000
export const CHILD_RESULT_MAX_TOKENS = 8_000
export const CHILD_RESULT_PREVIEW_CHARS = 4_000
const CHILD_RESULT_ARTIFACT_PREVIEW_CHARS = CHILD_RESULT_PREVIEW_CHARS - 64

const estimator = new ContextEstimator()

export type MaterializedChildResult = {
  summary: string
  summaryTruncated?: boolean
  resultRef?: ChildResultRef
  resultUnavailableReason?: string
  directionBundle?: unknown
  reviewBundle?: unknown
  deckArtifact?: unknown
  evidencePack?: FastContextEvidencePack
}

export class ChildResultExecutionError extends Error {
  readonly result: MaterializedChildResult
  /** Cumulative child-thread usage at failure time; settlement input, not a display field. */
  readonly usage?: ChildRunRecord['usage']
  readonly toolInvocations?: number
  readonly failure?: ChildRunFailure

  constructor(
    message: string,
    result: MaterializedChildResult,
    settlement?: {
      usage?: ChildRunRecord['usage']
      toolInvocations?: number
      failure?: ChildRunFailure
    }
  ) {
    super(message)
    this.name = 'ChildResultExecutionError'
    this.result = validatedFailureResult(result)
    // Kept as error-owned fields (not inside `result`) so validatedFailureResult
    // never strips the usage settlement the runtime must still account for.
    this.usage = settlement?.usage
    this.toolInvocations = settlement?.toolInvocations
    this.failure = settlement?.failure
  }
}

function validatedFailureResult(result: MaterializedChildResult): MaterializedChildResult {
  const direction = PptDirectionBundleV1.safeParse(result.directionBundle)
  const review = PptReviewBundleV1.safeParse(result.reviewBundle)
  const evidencePack = FastContextEvidencePackSchema.safeParse(result.evidencePack)
  return {
    summary: result.summary,
    ...(result.summaryTruncated !== undefined ? { summaryTruncated: result.summaryTruncated } : {}),
    ...(result.resultRef ? { resultRef: result.resultRef } : {}),
    ...(result.resultUnavailableReason ? { resultUnavailableReason: result.resultUnavailableReason } : {}),
    ...(direction.success ? { directionBundle: direction.data } : {}),
    ...(review.success ? { reviewBundle: review.data } : {}),
    ...(isValidatedDeckArtifact(result.deckArtifact) ? { deckArtifact: result.deckArtifact } : {}),
    ...(evidencePack.success ? { evidencePack: evidencePack.data } : {})
  }
}

function isValidatedDeckArtifact(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const artifact = value as Record<string, unknown>
  return artifact.validated === true &&
    typeof artifact.output === 'string' &&
    artifact.output.toLowerCase().endsWith('.pptx') &&
    Number.isInteger(artifact.slides) &&
    Number(artifact.slides) > 0 &&
    artifact.editableSlides === artifact.slides
}

export function childResultOwnerIds(parentThreadId: string, childId: string): string[] {
  return [`thread:${parentThreadId}`, `child:${childId}`]
}

export function childResultSource(
  items: readonly TurnItem[],
  turnId: string,
  status: 'completed' | 'failed' | 'aborted'
): string {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const assistantText = [...turnItems]
    .reverse()
    .find((item): item is Extract<TurnItem, { kind: 'assistant_text' }> =>
      item.kind === 'assistant_text' && Boolean(item.text.trim()))
    ?.text.trim()
  if (assistantText) return assistantText
  const errors = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'error' }> => item.kind === 'error')
    .map((item) => item.message.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (errors) return errors
  const toolResult = [...turnItems]
    .reverse()
    .find((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
  // Never inline a raw tool_result as the child summary: a single 512KB search
  // payload would flood record.error/summary when the child produced no text
  // (issue: Fast Context cards rendered as failed with a self-contradictory
  // `status: completed` JSON blob). A bounded preview keeps the last signal
  // without breaking the parent-context budget.
  if (toolResult) {
    const preview = stringifyResult(toolResult.output)
    // Truncating mid-string would produce invalid JSON; mark the omission so
    // downstream JSON.parse never sees a seemingly complete payload.
    if (preview.length > CHILD_RESULT_PREVIEW_CHARS) {
      return `${preview.slice(0, CHILD_RESULT_PREVIEW_CHARS - 1)}…`
    }
    if (preview) return preview
  }
  return status === 'completed'
    ? 'Child agent completed without a text response.'
    : `Child agent ${status}.`
}

export async function materializeChildResult(input: {
  content: string
  childId: string
  parentThreadId: string
  artifactStore?: ArtifactStore
}): Promise<MaterializedChildResult> {
  const content = input.content.trim()
  const byteSize = Buffer.byteLength(content, 'utf8')
  const lineCount = countLines(content)
  const tokens = estimator.estimateText(content)
  const oversized =
    byteSize > CHILD_RESULT_MAX_BYTES ||
    lineCount > CHILD_RESULT_MAX_LINES ||
    tokens > CHILD_RESULT_MAX_TOKENS
  if (!oversized) return { summary: content }

  const fallbackPreview = boundedUnavailablePreview(content)
  if (!input.artifactStore) {
    return {
      summary: fallbackPreview,
      summaryTruncated: true,
      resultUnavailableReason: 'Artifact storage is unavailable; open the child session for the full result.'
    }
  }
  try {
    const stored = await input.artifactStore.put({
      content,
      mimeType: 'text/markdown',
      source: 'tool',
      origin: 'subagent-result',
      // Leave space for variable-width omitted byte/line counts in the
      // artifact marker so the head/tail preview remains intact under 4k.
      maxInlineChars: CHILD_RESULT_ARTIFACT_PREVIEW_CHARS,
      linkedOwners: childResultOwnerIds(input.parentThreadId, input.childId)
    })
    return {
      // ArtifactSummary's marker contains variable-width counts; clamp again
      // at the delegation boundary so its hard parent-context contract wins.
      summary: stored.summary.inline.slice(0, CHILD_RESULT_PREVIEW_CHARS),
      summaryTruncated: true,
      resultRef: {
        artifactId: stored.meta.id,
        byteSize: stored.meta.byteSize,
        lineCount: stored.meta.lineCount,
        mimeType: 'text/markdown'
      }
    }
  } catch (error) {
    console.warn(
      `[kun] oversized child result artifact write failed child=${input.childId}: ${safeError(error)}`
    )
    return {
      summary: fallbackPreview,
      summaryTruncated: true,
      resultUnavailableReason: 'The full child result could not be stored; open the child session for details.'
    }
  }
}

function boundedUnavailablePreview(content: string): string {
  const marker = '\n[full child result omitted; open the child session for details]\n'
  const budget = Math.max(0, CHILD_RESULT_PREVIEW_CHARS - marker.length)
  const headLength = Math.floor(budget * 0.7)
  const tailLength = Math.max(0, budget - headLength)
  return `${content.slice(0, headLength)}${marker}${content.slice(-tailLength)}`
    .slice(0, CHILD_RESULT_PREVIEW_CHARS)
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500)
}
