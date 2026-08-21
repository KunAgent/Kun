import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS, errorResponse } from './runtime-error.js'
import {
  generateSessionSummary,
  type SessionSummaryOutcome
} from '../../loop/session-summary.js'
import { resolveRoleModel } from '../../loop/title-generator.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * On-demand summaries are user-initiated and run over the whole transcript, so
 * they get a far larger budget than the background 20s default. Keep this below
 * the desktop POST budget for `/summarize` so the runtime is the side that
 * times out and can answer with a structured reason (#1200).
 */
export const ON_DEMAND_SESSION_SUMMARY_TIMEOUT_MS = 90_000

const SummarizeThreadRequest = z
  .object({
    /** Optional per-request model override (falls back to summary role precedence). */
    model: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    accountId: z.string().min(1).optional()
  })
  .optional()

export const SummarizeThreadResponse = z.object({
  id: z.string(),
  summary: z.string()
})
export type SummarizeThreadResponse = z.infer<typeof SummarizeThreadResponse>

/**
 * On-demand whole-session summary. Reads the full transcript, runs the Summary
 * internal-LLM role (precedence: summaryModel -> smallModel -> main model),
 * persists the result onto the thread (`summary` field) and returns it. NOT
 * triggered automatically — the renderer calls this from a "summarize" action.
 *
 * Route: POST /v1/threads/:id/summarize
 */
export async function summarizeThread(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  // An empty object body is valid (no overrides); coerce {} -> undefined.
  const rawBody = body.value && typeof body.value === 'object' && Object.keys(body.value).length === 0
    ? undefined
    : body.value
  const parsed = SummarizeThreadRequest.safeParse(rawBody)
  if (!parsed.success) return ERRORS.validation('invalid summarize body', parsed.error.issues)

  if (!runtime.modelClient) return ERRORS.unavailable('model client is unavailable')

  const thread = await runtime.threadService.get(threadId)
  if (!thread) return ERRORS.notFound(`thread not found: ${threadId}`)

  const items = await runtime.sessionStore.loadItems(threadId)
  if (!items.some((item) => item.kind === 'user_message' || item.kind === 'assistant_text')) {
    return ERRORS.validation('thread has no conversation to summarize')
  }

  const resolved = resolveRoleModel({
    roleModel: parsed.data?.model ?? runtime.roles?.summaryModel,
    roleProviderId: parsed.data?.providerId ?? runtime.roles?.summaryProviderId,
    roleAccountId: parsed.data?.accountId ?? runtime.roles?.summaryAccountId,
    roles: runtime.roles,
    mainModel: thread.model || runtime.defaultModel,
    mainProviderId: thread.providerId,
    mainAccountId: thread.accountId
  })
  if (!resolved) return ERRORS.unavailable('no model is configured for session summary')

  const abortController = new AbortController()
  const onAbort = (): void => abortController.abort()
  request.signal?.addEventListener('abort', onAbort)

  let outcome: SessionSummaryOutcome
  try {
    outcome = await generateSessionSummary({
      threadId,
      modelClient: runtime.modelClient,
      model: resolved.model,
      ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
      ...(resolved.accountId ? { accountId: resolved.accountId } : {}),
      ...(runtime.immutablePrefix?.systemPrompt ? { systemPrompt: runtime.immutablePrefix.systemPrompt } : {}),
      items,
      ...(runtime.roles?.summaryReasoningEffort
        ? { reasoningEffort: runtime.roles.summaryReasoningEffort }
        : {}),
      timeoutMs: ON_DEMAND_SESSION_SUMMARY_TIMEOUT_MS,
      abortSignal: abortController.signal
    })
  } finally {
    request.signal?.removeEventListener('abort', onAbort)
  }
  if (!outcome.ok) return summaryFailureResponse(outcome, resolved.model)

  const summary = outcome.summary
  const updated = await runtime.threadService.update(threadId, { summary })
  return jsonResponse(SummarizeThreadResponse.parse({ id: updated.id, summary: updated.summary ?? summary }))
}

/**
 * Every branch keeps the model id in the message: a summary failure is almost
 * always a route/credential problem on the resolved summary model, and the
 * desktop only shows this string.
 */
function summaryFailureResponse(
  outcome: Extract<SessionSummaryOutcome, { ok: false }>,
  model: string
): JsonResponse {
  const details = { reason: outcome.reason, model }
  switch (outcome.reason) {
    case 'timeout':
      return errorResponse({
        code: 'capability_unavailable',
        message: `session summary timed out after ${Math.round(
          (outcome.timeoutMs ?? ON_DEMAND_SESSION_SUMMARY_TIMEOUT_MS) / 1_000
        )}s using model ${model}`,
        details
      }, 503)
    case 'aborted':
      return errorResponse({ code: 'aborted', message: 'session summary was cancelled', details }, 499)
    case 'model_error':
      return errorResponse({
        code: 'provider_unavailable',
        message: `session summary failed on model ${model}: ${outcome.message ?? 'the provider returned an error'}`,
        details: outcome.code ? { ...details, providerCode: outcome.code } : details
      }, 502)
    case 'empty_transcript':
      return errorResponse({
        code: 'validation_error',
        message: 'thread has no readable transcript to summarize',
        details
      }, 400)
    default:
      return errorResponse({
        code: 'capability_unavailable',
        message: `model ${model} returned an empty session summary`,
        details
      }, 503)
  }
}
