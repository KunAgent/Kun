import {
  ApprovalDecisionRequest,
  ApprovalDecisionResponse
} from '../../contracts/approvals.js'
import { approvalChoiceIsValid, approvalChoiceKey, type ApprovalChoice } from '../../contracts/approval-choice.js'
import { manualApprovalResolution, type ApprovalResolution } from '../../domain/approval.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import {
  KUN_APPROVAL_CONSENT_HEADER,
  type ApprovalConsentVerifier
} from '../approval-consent.js'

type DecisionFlight = Promise<ApprovalResolution | undefined>
const approvalDecisionFlights = new WeakMap<ApprovalGate, Map<string, DecisionFlight>>()

/**
 * GET /v1/approvals?threadId=<id> — pending approval requests, optionally
 * scoped to one thread (P3-19). Read-only projection; the decision route
 * stays `POST /v1/approvals/:id`.
 */
export function listPendingApprovals(
  gate: Pick<ApprovalGate, 'pending'>,
  threadId?: string
): JsonResponse {
  const approvals = gate.pending(threadId).map((approval) => ({
    approvalId: approval.id,
    threadId: approval.threadId,
    turnId: approval.turnId,
    toolName: approval.toolName,
    summary: approval.summary,
    createdAt: approval.createdAt,
    ...(approval.action ? { action: approval.action } : {})
  }))
  return jsonResponse({ approvals })
}

function resolvedDecision(status: string): 'allow' | 'deny' | null {
  return status === 'allowed' ? 'allow' : status === 'denied' ? 'deny' : null
}

function decisionFlightsFor(gate: ApprovalGate): Map<string, DecisionFlight> {
  let flights = approvalDecisionFlights.get(gate)
  if (!flights) {
    flights = new Map()
    approvalDecisionFlights.set(gate, flights)
  }
  return flights
}

async function recordApprovalResolution(input: {
  approvalId: string
  decision: 'allow' | 'deny'
  reason?: string
  choice?: ApprovalChoice
  gate: ApprovalGate
  events: RuntimeEventRecorder
}): Promise<{ joined: boolean; resolution?: ApprovalResolution }> {
  const flights = decisionFlightsFor(input.gate)
  const active = flights.get(input.approvalId)
  if (active) {
    return { joined: true, resolution: await active }
  }

  const approval = input.gate.get(input.approvalId)
  if (!approval || approval.status !== 'pending') {
    const decision = approval ? resolvedDecision(approval.status) : null
    return { joined: true, ...(approval && decision ? { resolution: manualApprovalResolution(decision, approval.reason, approval.choice) } : {}) }
  }
  const status = input.decision === 'allow' ? 'allowed' : 'denied'
  const resolution = manualApprovalResolution(input.decision, input.reason, input.choice)
  const flight = (async (): DecisionFlight => {
    if (!input.gate.reserveDecision(input.approvalId, input.decision, input.reason, input.choice)) {
      return undefined
    }
    try {
      // Persist the audit event before releasing the loop to execute an allowed tool.
      await input.events.record({
        kind: 'approval_resolved',
        threadId: approval.threadId,
        turnId: approval.turnId,
        itemId: undefined,
        approvalId: input.approvalId,
        toolName: approval.toolName,
        status,
        approvalReviewer: 'user',
        summary: approval.summary,
        ...(input.choice ? { choice: input.choice } : {}),
        ...(approval.action ? { action: approval.action } : {}),
        ...(input.reason ? { reason: input.reason } : {})
      })
    } catch (error) {
      input.gate.rollbackDecision(input.approvalId)
      throw error
    }
    if (!input.gate.commitDecision(input.approvalId)) {
      throw new Error(`approval reservation lost before commit: ${input.approvalId}`)
    }
    return resolution
  })()
  flights.set(input.approvalId, flight)
  try {
    return { joined: false, resolution: await flight }
  } finally {
    if (flights.get(input.approvalId) === flight) flights.delete(input.approvalId)
  }
}

/**
 * POST /v1/approvals/{approvalId}. Resolves a pending approval
 * request and emits a runtime event for the renderer to consume.
 */
export async function decideApproval(input: {
  approvalId: string
  request: Request
  gate: ApprovalGate
  events: RuntimeEventRecorder
  consent?: ApprovalConsentVerifier
}): Promise<JsonResponse | Response> {
  const body = await readJsonBody(input.request)
  if (!body.ok) return body.response
  const parsed = ApprovalDecisionRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid approval body', parsed.error.issues)
  }
  if (input.consent && !input.consent.verifyAndConsume({
    token: input.request.headers.get(KUN_APPROVAL_CONSENT_HEADER),
    approvalId: input.approvalId,
    decision: parsed.data.decision,
    choice: parsed.data.choice
  })) {
    return ERRORS.forbidden('protected approval consent required')
  }
  const approval = input.gate.get(input.approvalId)
  if (!approval) {
    return ERRORS.notFound(`approval not found: ${input.approvalId}`)
  }
  if (!approvalChoiceIsValid(approval.action?.permissionOptions, parsed.data.decision, parsed.data.choice)) {
    return ERRORS.validation('approval option does not match this request or decision')
  }
  if (approval.status !== 'pending') {
    const existingDecision = resolvedDecision(approval.status)
    if (existingDecision && existingDecision === parsed.data.decision && approvalChoiceKey(approval.choice) === approvalChoiceKey(parsed.data.choice)) {
      const response: ApprovalDecisionResponse = {
        approvalId: input.approvalId,
        decision: parsed.data.decision,
        status: approval.status,
        alreadyResolved: true
      }
      return jsonResponse(response)
    }
    return ERRORS.conflict(`approval already decided: ${input.approvalId}`)
  }
  const result = await recordApprovalResolution({
    approvalId: input.approvalId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
    choice: parsed.data.choice,
    gate: input.gate,
    events: input.events
  })
  if (result.resolution?.decision !== parsed.data.decision || approvalChoiceKey(result.resolution?.choice) !== approvalChoiceKey(parsed.data.choice)) {
    return ERRORS.conflict(`approval already decided: ${input.approvalId}`)
  }
  const response: ApprovalDecisionResponse = {
    approvalId: input.approvalId,
    decision: parsed.data.decision,
    status: parsed.data.decision === 'allow' ? 'allowed' : 'denied',
    ...(result.joined ? { alreadyResolved: true } : {})
  }
  return jsonResponse(response)
}
