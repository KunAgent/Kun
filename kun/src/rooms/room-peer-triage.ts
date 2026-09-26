import { z } from 'zod'
import type { ModelClient } from '../ports/model-client.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { RolesConfig } from '../config/kun-config.js'
import { resolveRoleModel } from '../loop/title-generator.js'
import { boundedRoomText } from './room-context.js'
import { roomPeerTriageInstructions } from './room-ax-surfaces.js'

const Verdict = z.object({ action: z.enum(['respond', 'skip']), reason: z.string().max(500) }).strict()
export type RoomPeerTriageResult = z.infer<typeof Verdict> & {
  usage?: UsageSnapshot
  model: string
  elapsedMs: number
}

/** The small model owns the verdict; extraction tolerates fences, chatter and
 *  truncated output. A thinking model may legitimately spend its budget on
 *  reasoning before answering, so nothing here caps its output length — the
 *  streamed text cap in roomPeerTriage only stops runaway generations. */
function parseParticipationVerdict(raw: string): z.infer<typeof Verdict> {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Room participation check returned no verdict')
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  const candidate = start >= 0 && end > start ? body.slice(start, end + 1) : body
  try {
    const parsed = Verdict.safeParse(JSON.parse(candidate))
    if (parsed.success) return parsed.data
  } catch { /* fall through to salvage */ }
  const action = candidate.match(/"action"\s*:\s*"(respond|skip)"/)
  if (action) {
    const reason = candidate.match(/"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    return { action: action[1] as 'respond' | 'skip',
      reason: (reason?.[1] ?? 'recovered from a truncated participation verdict').slice(0, 500) }
  }
  throw new Error('Room participation verdict was not valid JSON')
}

/** Parsing or cancellation can fail after the provider has already reported billable usage. */
export class RoomPeerTriageError extends Error {
  constructor(error: unknown, readonly model: string, readonly elapsedMs: number, readonly usage?: UsageSnapshot) {
    super(error instanceof Error ? error.message : String(error), { cause: error })
    this.name = 'RoomPeerTriageError'
  }
}

/** A failed classifier never acknowledges an inbox item or escalates to the main turn. */
export async function roomPeerTriage(input: {
  client: ModelClient
  roles?: RolesConfig
  mainModel: string
  mainProviderId?: string
  mainAccountId?: string
  identity: string
  member: { id: string; displayName: string; role: string; roleNotes: string; agentInstructions?: string }
  updates: unknown
  signal: AbortSignal
  timeoutMs?: number
}): Promise<RoomPeerTriageResult> {
  if (input.signal.aborted) throw input.signal.reason ?? new Error('Participation check cancelled')
  const binding = resolveRoleModel(input)
  if (!binding) throw new Error('No model is configured for room participation')
  const started = Date.now()
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal.reason)
  input.signal.addEventListener('abort', abort, { once: true })
  if (input.signal.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Room participation check timed out')), input.timeoutMs ?? 120_000)
  const prompt = JSON.stringify({ member: {
    id: input.member.id, displayName: input.member.displayName, role: input.member.role,
    roleNotes: boundedRoomText(input.member.roleNotes, 1000),
    responsibilities: boundedRoomText(input.member.agentInstructions ?? '', 1000)
  }, updates: input.updates })
  if (Buffer.byteLength(prompt) > 12_000) {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', abort)
    throw new Error('Room participation input exceeds its budget')
  }
  let output = '', usage: UsageSnapshot | undefined
  try {
    for await (const chunk of input.client.stream({
      ...binding, threadId: input.identity, turnId: input.identity,
      contextInstructions: roomPeerTriageInstructions(),
      prefix: [], history: [{ id: input.identity, threadId: input.identity, turnId: input.identity,
        kind: 'user_message', role: 'user', status: 'completed', createdAt: new Date().toISOString(), text: prompt }],
      tools: [], responseFormat: 'json_object', temperature: 0,
      stream: true, abortSignal: controller.signal
    })) {
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Participation check cancelled')
      if (chunk.kind === 'error') throw new Error(chunk.message)
      if (chunk.kind === 'assistant_text_delta') {
        output += chunk.text
        if (output.length > 4000) throw new Error('Participation result exceeds its output budget')
      }
      if (chunk.kind === 'usage') usage = chunk.usage
    }
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Participation check cancelled')
    const parsed = parseParticipationVerdict(output)
    return { ...parsed, usage, model: binding.model, elapsedMs: Date.now() - started }
  } catch (error) {
    throw new RoomPeerTriageError(error, binding.model, Date.now() - started, usage)
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', abort)
  }
}
