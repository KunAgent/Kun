import type { ChatBlock } from '../../agent/types'
import { isPptDirectionBundle } from '../../design/canvas/ppt-direction-board'
import { isPptReviewBundle } from '../../design/canvas/ppt-review-board'
import type { CodeCanvasOpenRequestDetail, WorkCanvasOpenRequestDetail } from '../../lib/code-canvas-panel-event'

type PptBundleIdentity = {
  childId: string
  workflowId: string
  phase: 'directions' | 'review' | 'complete'
  revision: number
  outputPath?: string
}

export type PptCanvasOpenRouteInput = {
  route: 'chat' | 'write'
  workspaceRoot: string
  threadId: string | null
  sourcePath?: string | null
}

export type PptCanvasOpenRouter = {
  openCode: (detail: CodeCanvasOpenRequestDetail) => void
  openWork: (detail: WorkCanvasOpenRequestDetail) => Promise<boolean>
}

export type PptCanvasOpenRequestDetail =
  | (CodeCanvasOpenRequestDetail & {
      reason: 'ppt-direction' | 'ppt-review'
      blockId: string
      threadId: string
      workflowId: string
      childId: string
    })
  | WorkCanvasOpenRequestDetail

export function pptCanvasOpenRequestForBlock(
  block: ChatBlock,
  input: PptCanvasOpenRouteInput
): PptCanvasOpenRequestDetail | null {
  if (
    block.kind !== 'tool' ||
    block.status !== 'success' ||
    block.meta?.toolName !== 'ppt_agent' ||
    !block.detail ||
    !input.threadId?.trim()
  ) return null

  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(block.detail) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    payload = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const review = isPptReviewBundle(payload.reviewBundle) ? payload.reviewBundle : null
  const direction = isPptDirectionBundle(payload.directionBundle) ? payload.directionBundle : null
  const deckArtifact = record(payload.deckArtifact)
  const outputPath = nonEmptyString(deckArtifact?.output) ? deckArtifact.output.trim() : undefined
  const completed = payload.phase === 'completed' &&
    nonEmptyString(payload.workflowId) && nonEmptyString(payload.childId) && outputPath
      ? {
          workflowId: payload.workflowId,
          childId: payload.childId,
          phase: 'complete' as const,
          revision: 0,
          outputPath
        }
      : null
  const bundle: PptBundleIdentity | null = review
    ? {
        workflowId: review.workflowId,
        childId: review.childId,
        phase: review.phase === 'completed' && outputPath ? 'complete' : 'review',
        revision: Math.max(0, ...review.slides.map((slide) => slide.revision)),
        ...(outputPath ? { outputPath } : {})
      }
    : direction
      ? {
          workflowId: direction.workflowId,
          childId: direction.childId,
          phase: 'directions',
          revision: Math.max(0, ...direction.directions.map((candidate) => candidate.revision))
        }
      : completed
  if (!bundle) return null
  const reason = direction && !review && !completed ? 'ppt-direction' as const : 'ppt-review' as const
  const common = {
    reason,
    blockId: block.id,
    threadId: input.threadId.trim(),
    workflowId: bundle.workflowId,
    childId: bundle.childId
  }
  if (input.route === 'write') {
    const workspaceRoot = input.workspaceRoot.trim()
    if (!workspaceRoot) return null
    // Title priority: the main agent's UI title, then the structured deck
    // title, then the legacy source-based fallback so historical tool results
    // stay replayable.
    const title = normalizePptBoardTitle(
      nonEmptyString(payload.title) ? payload.title : undefined,
      direction?.deckTitle ?? review?.deckTitle,
      input.sourcePath
    )
    return {
      target: 'write',
      ...common,
      workspaceRoot,
      title,
      ...(input.sourcePath?.trim() ? { sourcePath: input.sourcePath.trim() } : {}),
      pptProjectionRequired: Boolean(review || direction),
      pptState: {
        phase: bundle.phase,
        revision: bundle.revision,
        ...(bundle.outputPath ? { outputPath: bundle.outputPath } : {})
      }
    }
  }
  return { target: 'code', ...common }
}

function normalizePptBoardTitle(
  payloadTitle: string | undefined,
  deckTitle: string | undefined,
  sourcePath: string | null | undefined
): string {
  const fromPayload = payloadTitle?.trim().slice(0, 160)
  if (fromPayload) return fromPayload
  const fromDeck = deckTitle?.trim().slice(0, 160)
  if (fromDeck) return fromDeck
  const sourceStem = sourcePath?.trim()
    ? sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '')
    : ''
  return sourceStem ? `${sourceStem} · Presentation review` : 'Presentation review'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export async function routePptCanvasOpenRequest(
  request: PptCanvasOpenRequestDetail,
  router: PptCanvasOpenRouter
): Promise<boolean> {
  if (request.target === 'code') {
    router.openCode(request)
    return true
  }
  return router.openWork(request)
}
