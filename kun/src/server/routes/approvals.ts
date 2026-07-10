import {
  ApprovalDecisionRequest,
  ApprovalDecisionResponse
} from '../../contracts/approvals.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'

const approvalDecisionFlights = new WeakMap<ApprovalGate, Map<string, Promise<boolean>>>()

function resolvedDecision(status: string): 'allow' | 'deny' | null {
  return status === 'allowed' ? 'allow' : status === 'denied' ? 'deny' : null
}

function decisionFlightsFor(gate: ApprovalGate): Map<string, Promise<boolean>> {
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
  gate: ApprovalGate
  events: RuntimeEventRecorder
}): Promise<{ joined: boolean }> {
  const flights = decisionFlightsFor(input.gate)
  const active = flights.get(input.approvalId)
  if (active) {
    await active
    return { joined: true }
  }

  const approval = input.gate.get(input.approvalId)
  if (!approval || approval.status !== 'pending') return { joined: true }
  const status = input.decision === 'allow' ? 'allowed' : 'denied'
  const flight = (async (): Promise<boolean> => {
    if (!input.gate.reserveDecision(input.approvalId, input.decision, input.reason)) {
      return false
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
        summary: approval.summary,
        ...(input.reason ? { reason: input.reason } : {})
      })
    } catch (error) {
      input.gate.rollbackDecision(input.approvalId)
      throw error
    }
    if (!input.gate.commitDecision(input.approvalId)) {
      throw new Error(`approval reservation lost before commit: ${input.approvalId}`)
    }
    return true
  })()
  flights.set(input.approvalId, flight)
  try {
    await flight
    return { joined: false }
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
}): Promise<JsonResponse | Response> {
  const body = await readJsonBody(input.request)
  if (!body.ok) return body.response
  const parsed = ApprovalDecisionRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid approval body', parsed.error.issues)
  }
  const approval = input.gate.get(input.approvalId)
  if (!approval) {
    return ERRORS.notFound(`approval not found: ${input.approvalId}`)
  }
  if (approval.status !== 'pending') {
    const existingDecision = resolvedDecision(approval.status)
    if (existingDecision && existingDecision === parsed.data.decision) {
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
    gate: input.gate,
    events: input.events
  })
  const resolved = input.gate.get(input.approvalId)
  const finalDecision = resolved ? resolvedDecision(resolved.status) : null
  if (finalDecision !== parsed.data.decision) {
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
