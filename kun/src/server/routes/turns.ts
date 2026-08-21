import {
  CompactRequest,
  CancelToolCallResponse,
  InterruptTurnRequest,
  InterruptTurnResponse,
  RewindThreadRequest,
  RewindThreadResponse,
  ReplaceSteeringRequest,
  StartTurnRequest,
  StartTurnResponse,
  SteeringQueueResponse,
  SteerTurnRequest,
  TurnSchema
} from '../../contracts/turns.js'
import { ThreadBusyDetailsSchema } from '../../contracts/errors.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import {
  DesignProfileLockedError,
  TaskSurfaceLockedError,
  TurnCapacityError,
  TurnConflictError,
  type TurnService
} from '../../services/turn-service.js'
import { ThreadExecutionBusyError } from '../../ports/thread-execution-lease.js'
import { isPublicTurnItem } from '../../contracts/items.js'
import type { ToolCancellationService } from '../../services/tool-cancellation-service.js'

export async function startTurn(
  turns: TurnService,
  threadId: string,
  request: Request,
  onStarted?: (response: StartTurnResponse) => void,
  graphModeEnabled?: () => boolean
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = StartTurnRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid start turn body', parsed.error.issues)
  }
  if (parsed.data.orchestration === 'graph' && graphModeEnabled && !graphModeEnabled()) {
    return ERRORS.unavailable('Graph Mode is disabled; submit this turn with direct orchestration')
  }
  try {
    const response: StartTurnResponse = await turns.startTurn({
      threadId,
      request: parsed.data
    }, { onAdmitted: onStarted })
    return jsonResponse(response, 202)
  } catch (error) {
    if (error instanceof ThreadExecutionBusyError) {
      return jsonResponse({
        code: 'thread_busy',
        message: 'thread already has an active turn',
        details: ThreadBusyDetailsSchema.parse({
          threadId: error.owner.threadId,
          activeTurnId: error.owner.turnId,
          ownerFlavor: error.owner.ownerFlavor,
          acquiredAt: error.owner.acquiredAt,
          expiresAt: error.owner.expiresAt
        })
      }, 409)
    }
    if (error instanceof TurnCapacityError) {
      return ERRORS.rateLimited(error.message, { maxConcurrentTurns: error.maxConcurrentTurns })
    }
    if (error instanceof TaskSurfaceLockedError) {
      return ERRORS.taskSurfaceLocked(error.message, {
        lockedSurface: error.lockedSurface,
        requestedSurface: error.requestedSurface
      })
    }
    if (error instanceof DesignProfileLockedError) {
      return ERRORS.designProfileLocked(error.message, {
        lockedAtTurnId: error.lockedAtTurnId,
        ...(error.details.lockedDocumentId
          ? { lockedDocumentId: error.details.lockedDocumentId }
          : {}),
        ...(error.details.lockedBoardArtifactId
          ? { lockedBoardArtifactId: error.details.lockedBoardArtifactId }
          : {}),
        ...(error.details.mismatch ? { mismatch: error.details.mismatch } : {})
      })
    }
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}

export async function steerTurn(
  turns: TurnService,
  threadId: string,
  turnId: string,
  request: Request,
  onSteered?: (response: { threadId: string; turnId: string }) => void
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SteerTurnRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid steer turn body', parsed.error.issues)
  }
  try {
    await turns.steerTurn({
      threadId,
      turnId,
      text: parsed.data.text,
      ...(parsed.data.displayText ? { displayText: parsed.data.displayText } : {}),
      ...(parsed.data.messageSource ? { messageSource: parsed.data.messageSource } : {}),
      ...(parsed.data.attachmentIds?.length
        ? { attachmentIds: parsed.data.attachmentIds }
        : {})
    })
    onSteered?.({ threadId, turnId })
  } catch (error) {
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) return ERRORS.notFound(error.message)
    throw error
  }
  return jsonResponse({ ok: true })
}

export async function getSteeringQueue(
  turns: TurnService,
  threadId: string,
  turnId: string
): Promise<JsonResponse> {
  try {
    return jsonResponse(SteeringQueueResponse.parse({
      threadId,
      turnId,
      entries: await turns.steeringQueue({ threadId, turnId })
    }))
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return ERRORS.notFound(error.message)
    throw error
  }
}

export async function replaceSteeringQueue(
  turns: TurnService,
  threadId: string,
  turnId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = ReplaceSteeringRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid steering queue body', parsed.error.issues)
  try {
    const entries = await turns.replaceSteering({ threadId, turnId, entries: parsed.data.entries })
    return jsonResponse(SteeringQueueResponse.parse({ threadId, turnId, entries }))
  } catch (error) {
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) return ERRORS.notFound(error.message)
    throw error
  }
}

export async function interruptTurn(
  turns: TurnService,
  threadId: string,
  turnId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = InterruptTurnRequest.safeParse(body.value ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid interrupt turn body', parsed.error.issues)
  }
  let result: { status: InterruptTurnResponse['status'] }
  try {
    result = await turns.interruptTurn({ threadId, turnId, discard: parsed.data.discard })
  } catch (error) {
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) return ERRORS.notFound(error.message)
    throw error
  }
  const payload: InterruptTurnResponse = {
    threadId,
    turnId,
    status: result.status
  }
  return jsonResponse(payload)
}

export async function cancelToolCall(
  cancellation: ToolCancellationService | undefined,
  threadId: string,
  turnId: string,
  callId: string
): Promise<JsonResponse | Response> {
  if (!cancellation) return ERRORS.unavailable('tool cancellation is unavailable')
  try {
    const result = await cancellation.cancel({ threadId, turnId, callId })
    const payload: CancelToolCallResponse = CancelToolCallResponse.parse(result)
    return jsonResponse(payload)
  } catch (error) {
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) return ERRORS.notFound(error.message)
    if (error instanceof Error && /no longer active|not currently executing|already being interrupted/i.test(error.message)) {
      return ERRORS.conflict(error.message)
    }
    throw error
  }
}

export async function compactTurn(
  turns: TurnService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CompactRequest.safeParse(body.value ?? {})
  if (!parsed.success) {
    return ERRORS.validation('invalid compact body', parsed.error.issues)
  }
  try {
    const response = await turns.compact({
      threadId,
      request: parsed.data,
      signal: request.signal
    })
    return jsonResponse(response)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}

export async function rewindThread(
  turns: TurnService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = RewindThreadRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid rewind body', parsed.error.issues)
  }
  try {
    const response: RewindThreadResponse = await turns.rewindThread({
      threadId,
      turnId: parsed.data.turnId
    })
    return jsonResponse(response)
  } catch (error) {
    if (error instanceof TurnConflictError) return ERRORS.conflict(error.message)
    if (error instanceof Error && /not found/i.test(error.message)) {
      return ERRORS.notFound(error.message)
    }
    throw error
  }
}

export async function getTurn(
  turns: TurnService,
  threadId: string,
  turnId: string
): Promise<JsonResponse> {
  const turn = await turns.getTurn(threadId, turnId)
  if (!turn) {
    return jsonResponse(
      { code: 'not_found', message: `turn not found: ${turnId}` },
      404
    )
  }
  return jsonResponse(TurnSchema.parse({
    ...turn,
    items: turn.items.filter(isPublicTurnItem)
  }))
}
