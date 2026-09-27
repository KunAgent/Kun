import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import {
  DispatchVerdictRequestSchema,
  QuestionAnswerRequestSchema,
  RaceDecideRequestSchema,
  RaceDiscardRequestSchema,
  WorkerDispatchRequestSchema,
  WorkerNoticeHoldRequestSchema
} from '../../contracts/ade.js'
import type { FileWorkerNoticeStore } from '../../ade/worker-notice-store.js'
import type { WorkerNoticeCoordinator } from '../../ade/worker-notice-coordinator.js'
import type { ManagerRuntime } from '../../ade/manager-runtime.js'
import { renderWorkerUpdates } from '../../ade/notice-render.js'
import {
  decideRace,
  discardRaceOthers,
  reconcileRaces,
  type RaceServiceDeps
} from '../../ade/race.js'
import { buildRaceComparison } from '../../ade/race-compare.js'
import { readJsonBody } from '../read-json-body.js'

/**
 * ADE team routes (09 §6.2): composer hold + pending-notice readback for
 * manager threads. `teamId` is the manager thread id.
 */

/** POST /v1/teams/:managerThreadId/notice-hold — `{ holdMs ≤ 60000 }`. */
export async function noticeHoldResponse(
  coordinator: WorkerNoticeCoordinator,
  managerThreadId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = WorkerNoticeHoldRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid notice-hold request', parsed.error.issues)
  }
  const result = coordinator.holdNotices(managerThreadId, parsed.data.holdMs)
  return jsonResponse({ ...result, holdMs: parsed.data.holdMs }, 200)
}

/**
 * GET /v1/teams/:managerThreadId/pending-notices — notices + the exact
 * `<kun_worker_updates>` text so the renderer can attach them verbatim to
 * the next user message instead of duplicating the render rules.
 */
export async function pendingNoticesResponse(
  notices: FileWorkerNoticeStore,
  managerThreadId: string,
  language?: string
): Promise<JsonResponse> {
  const pending = await notices.pending(managerThreadId)
  const rendered = renderWorkerUpdates(pending, language)
  return jsonResponse(
    pending.length
      ? { notices: pending, text: rendered.prompt, displayText: rendered.displayText }
      : { notices: [] }
  )
}

/** Map a control-plane refusal vocabulary onto an HTTP status. */
function refusalResponse(refusal: string | undefined): JsonResponse {
  if (
    refusal === 'worker_not_found' ||
    refusal === 'question_not_found' ||
    refusal === 'dispatch_not_found' ||
    refusal === 'approval_not_found' ||
    refusal === 'race_not_found'
  ) {
    return ERRORS.notFound(`refused: ${refusal}`)
  }
  return ERRORS.conflict(`refused: ${refusal ?? 'unknown'}`)
}

function controlResultResponse(result: {
  ok: boolean
  refusal?: string
} & Record<string, unknown>): JsonResponse {
  if (!result.ok) return refusalResponse(result.refusal)
  return jsonResponse(result)
}

/** GET /v1/teams/by-manager/:threadId — roster + recent dispatches/questions. */
export async function teamOverviewResponse(
  manager: ManagerRuntime,
  managerThreadId: string
): Promise<JsonResponse> {
  const overview = await manager.teamControls.teamOverview(managerThreadId)
  if (!overview) return ERRORS.notFound(`no ade team for ${managerThreadId}`)
  return jsonResponse(overview)
}

/** GET /v1/teams/workers/:workerId — worker + team for the control banner. */
export async function workerByIdResponse(
  manager: ManagerRuntime,
  workerId: string
): Promise<JsonResponse> {
  const found = await manager.teamControls.workerById(workerId)
  if (!found) return ERRORS.notFound(`no ade worker ${workerId}`)
  return jsonResponse(found)
}

/** POST /v1/teams/workers/:workerId/stop — user stops the active turn (09 §9). */
export async function workerStopResponse(
  manager: ManagerRuntime,
  workerId: string
): Promise<JsonResponse> {
  return controlResultResponse(await manager.teamControls.stopWorker(workerId))
}

/** POST /v1/teams/workers/:workerId/take-over — user takes control (09 §9). */
export async function workerTakeOverResponse(
  manager: ManagerRuntime,
  workerId: string
): Promise<JsonResponse> {
  return controlResultResponse(await manager.teamControls.takeOverWorker(workerId))
}

/** POST /v1/teams/workers/:workerId/hand-back — manager regains control. */
export async function workerHandBackResponse(
  manager: ManagerRuntime,
  workerId: string
): Promise<JsonResponse> {
  return controlResultResponse(await manager.teamControls.handBackWorker(workerId))
}

/** POST /v1/teams/workers/:workerId/detach — worker leaves the team (09 §9). */
export async function workerDetachResponse(
  manager: ManagerRuntime,
  workerId: string
): Promise<JsonResponse> {
  return controlResultResponse(await manager.teamControls.detachWorker(workerId))
}

/** POST /v1/teams/questions/:questionId/answer — user answers (09 §6.4). */
export async function questionAnswerResponse(
  manager: ManagerRuntime,
  questionId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = QuestionAnswerRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid question answer', parsed.error.issues)
  }
  return controlResultResponse(
    await manager.teamControls.answerQuestionAsUser(questionId, parsed.data.answer)
  )
}

/**
 * POST /v1/teams/workers/:workerId/dispatch — GUI-originated dispatch
 * (09 §9, review comments in P1-18) with the same durable delivery path as
 * worker_send.
 */
export async function workerDispatchResponse(
  manager: ManagerRuntime,
  workerId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = WorkerDispatchRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid worker dispatch', parsed.error.issues)
  }
  return controlResultResponse(await manager.teamControls.guiDispatch(workerId, parsed.data))
}

/**
 * POST /v1/teams/dispatches/:dispatchId/verdict — user records a quality
 * verdict from the review panel (10 §4.3); `decidedBy: 'user'` overrides a
 * manager verdict while both stay on record.
 */
export async function dispatchVerdictResponse(
  manager: ManagerRuntime,
  dispatchId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = DispatchVerdictRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid dispatch verdict', parsed.error.issues)
  }
  return controlResultResponse(
    await manager.verdicts.setVerdict({ dispatchId, ...parsed.data, decidedBy: 'user' })
  )
}

/**
 * GET /v1/teams/races/:raceId (10 §6.3, 11 §5): lazily reconcile the owning
 * team's races (covers restarts that dropped deadline timers), then return
 * the record with per-contender compare data.
 */
export async function raceResponse(
  deps: RaceServiceDeps,
  raceId: string
): Promise<JsonResponse> {
  const race = await deps.races.findRace(raceId)
  if (!race) return ERRORS.notFound('race not found')
  await reconcileRaces(deps, race.teamId).catch((error) => {
    console.warn(`[kun] ade race reconcile failed for ${race.teamId}:`, error)
  })
  const fresh = await deps.races.get(race.teamId, raceId)
  if (!fresh) return ERRORS.notFound('race not found')
  return jsonResponse(await buildRaceComparison(deps, fresh))
}

/**
 * POST /v1/teams/races/:raceId/decide — `{ winnerDispatchId }` (10 §6.4).
 * GUI-only path; managers reach race records through race_recommend only.
 */
export async function raceDecideResponse(
  deps: RaceServiceDeps,
  raceId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = RaceDecideRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid race decision', parsed.error.issues)
  }
  return controlResultResponse(
    await decideRace(deps, raceId, parsed.data.winnerDispatchId)
  )
}

/**
 * POST /v1/teams/races/:raceId/discard-others — `{ confirm: true }` (10 §6.5,
 * 07 §8.3): force-discard each non-winner task workspace.
 */
export async function raceDiscardOthersResponse(
  deps: RaceServiceDeps,
  raceId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = RaceDiscardRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid discard-others request', parsed.error.issues)
  }
  return controlResultResponse(
    await discardRaceOthers(deps, raceId, parsed.data.confirm === true)
  )
}
