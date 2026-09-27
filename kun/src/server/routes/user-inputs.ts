import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { UserInputAnswer, UserInputQuestion } from '../../ports/user-input-gate.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { UserInputAnswerSchema } from '../../contracts/items.js'

const UserInputResolveRequest = z.object({
  answers: z.array(UserInputAnswerSchema).optional(),
  cancelled: z.boolean().optional()
})

const resolutionLocks = new Map<string, Promise<unknown>>()

export async function resolveUserInput(input: {
  inputId: string
  request: Request
  gate: UserInputGate
  events: RuntimeEventRecorder
}): Promise<JsonResponse | Response> {
  return serializeResolution(input.inputId, async () => resolveUserInputLocked(input))
}

async function resolveUserInputLocked(input: {
  inputId: string
  request: Request
  gate: UserInputGate
  events: RuntimeEventRecorder
}): Promise<JsonResponse | Response> {
  const body = await readJsonBody(input.request)
  if (!body.ok) return body.response
  const parsed = UserInputResolveRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid user input body', parsed.error.issues)
  }
  const pending = input.gate.get(input.inputId)
  if (!pending) {
    return ERRORS.notFound(`user input not found: ${input.inputId}`)
  }
  const resolution = parsed.data.cancelled
    ? { status: 'cancelled' as const }
    : { status: 'submitted' as const, answers: parsed.data.answers ?? [] }
  if (resolution.status === 'submitted') {
    const validation = validateAnswers(pending.questions, resolution.answers)
    if (validation) return ERRORS.validation(validation)
  }
  const claim = input.gate.claimResolution(input.inputId)
  if (!claim) {
    return ERRORS.conflict(`user input already resolved: ${input.inputId}`)
  }
  try {
    await input.events.record({
      kind: 'user_input_resolved',
      threadId: claim.request.threadId,
      turnId: claim.request.turnId,
      itemId: claim.request.itemId,
      inputId: claim.request.id,
      status: resolution.status,
      prompt: claim.request.prompt,
      questions: claim.request.questions,
      ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
    })
  } catch (error) {
    // The claim is released without settling, so a retry can still deliver
    // the answer; log to make the interrupted hand-off visible.
    console.warn(
      `[kun] user_input ${input.inputId}: failed to persist resolution event ` +
        `(thread=${claim.request.threadId} turn=${claim.request.turnId}): ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
    claim.release()
    throw error
  }
  if (!claim.resolve(resolution)) {
    // The durable event says resolved but the gate settled through another
    // path (timeout/abort/reset) — log the divergence instead of a bare 409.
    console.warn(
      `[kun] user_input ${input.inputId}: resolution event recorded but gate ` +
        `already settled (thread=${claim.request.threadId} turn=${claim.request.turnId} ` +
        `status=${resolution.status})`
    )
    return ERRORS.conflict(`user input already resolved: ${input.inputId}`)
  }
  return jsonResponse({
    inputId: input.inputId,
    status: resolution.status,
    ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
  })
}

async function serializeResolution<T>(inputId: string, operation: () => Promise<T>): Promise<T> {
  const previous = resolutionLocks.get(inputId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const guard = run.then(() => undefined, () => undefined)
  resolutionLocks.set(inputId, guard)
  try {
    return await run
  } finally {
    if (resolutionLocks.get(inputId) === guard) resolutionLocks.delete(inputId)
  }
}

function validateAnswers(questions: readonly UserInputQuestion[], answers: readonly UserInputAnswer[]): string | null {
  // Legacy/free-form request_user_input calls carry no structured questions.
  if (questions.length === 0) return null
  const byId = new Map(questions.map((question) => [question.id, question]))
  const seen = new Set<string>()
  for (const answer of answers) {
    const question = byId.get(answer.id)
    if (!question) return `answer references unknown question: ${answer.id}`
    if (seen.has(answer.id)) return `duplicate answer for question: ${answer.id}`
    seen.add(answer.id)
    if (question.options.length === 0) continue
    // Interactive clients expose a typed "Other" escape hatch alongside
    // suggested options. It is intentionally represented as a synthetic label
    // plus a non-empty free-form value, matching the GUI contract.
    if (answer.label === 'Other' && answer.value.trim()) continue
    const selected = answer.labels?.length ? answer.labels : [answer.label]
    if (selected.some((label) => !question.options.some((option) => option.label === label))) {
      return `answer contains an invalid option for question: ${answer.id}`
    }
    const min = question.minSelections ?? 1
    const max = question.maxSelections ?? (question.selectionMode === 'multiple' ? question.options.length : 1)
    if (selected.length < min || selected.length > max) {
      return `answer selection count is invalid for question: ${answer.id}`
    }
  }
  if (questions.some((question) => question.options.length > 0 && !seen.has(question.id))) {
    return 'missing answer for a pending question'
  }
  return null
}
