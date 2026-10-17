/**
 * Live context occupancy of a Cursor SDK turn, read from the conversation
 * checkpoints the SDK writes into Kun's isolated store.
 *
 * Cursor never streams context usage, and its turn-end usage sums every model
 * call of the run. After each step it does persist a new root checkpoint, an
 * `agent.v1.ConversationStateStructure` whose `token_details` (field 5) is
 * Cursor's own count: used and max tokens plus a per-category breakdown
 * (system prompt, tools, rules, MCP, conversation, ...). The store moves the
 * root with `runs.update` / `agents.update`; this wrapper then reads that one
 * blob back, decodes only `token_details`, and reports it. Every store call
 * still goes to the real store unchanged.
 */
import type { LocalAgentStore } from '@cursor/sdk'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

export type CursorContextCategory = 'tools' | 'system' | 'skills' | 'messages' | 'other'

export type CursorTokenDetails = {
  usedTokens: number
  maxTokens: number
  /** Cursor's categories folded into Kun's; sums to `usedTokens`. */
  breakdown: Record<CursorContextCategory, number>
}

/** Cursor category ids (`PromptTokenBreakdownCategory.id`) → Kun's gauge categories. */
const CATEGORY: Readonly<Record<string, CursorContextCategory>> = {
  system_prompt: 'system',
  rules: 'system',
  tools: 'tools',
  mcp: 'tools',
  subagents: 'tools',
  skills: 'skills',
  conversation: 'messages',
  summarized_conversation: 'messages'
}

type Field = { no: number; wire: number; value: number | Uint8Array }

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0
  let scale = 1
  for (let position = start; position < bytes.length && position < start + 10; position += 1) {
    const byte = bytes[position]!
    value += (byte & 0x7f) * scale
    if (!(byte & 0x80)) return [value, position + 1]
    scale *= 128
  }
  throw new Error('truncated varint')
}

/** Top-level fields of one protobuf message; groups (wire 3/4) are not used by these messages. */
function fields(bytes: Uint8Array): Field[] {
  const out: Field[] = []
  let position = 0
  while (position < bytes.length) {
    const [key, afterKey] = readVarint(bytes, position)
    const no = Math.floor(key / 8)
    const wire = key % 8
    position = afterKey
    if (wire === 0) {
      const [value, next] = readVarint(bytes, position)
      out.push({ no, wire, value })
      position = next
    } else if (wire === 2) {
      const [length, next] = readVarint(bytes, position)
      if (next + length > bytes.length) throw new Error('truncated field')
      out.push({ no, wire, value: bytes.subarray(next, next + length) })
      position = next + length
    } else if (wire === 1 || wire === 5) {
      position += wire === 1 ? 8 : 4
    } else {
      throw new Error(`unsupported wire type ${wire}`)
    }
  }
  return out
}

const numberField = (list: Field[], no: number): number => {
  const field = list.find((entry) => entry.no === no && entry.wire === 0)
  return typeof field?.value === 'number' ? field.value : 0
}
const messageFields = (list: Field[], no: number): Uint8Array[] =>
  list.filter((entry) => entry.no === no && entry.wire === 2).map((entry) => entry.value as Uint8Array)

/** `token_details` of a root checkpoint, or undefined when the blob carries none. */
export function cursorTokenDetails(root: Uint8Array): CursorTokenDetails | undefined {
  try {
    const details = messageFields(fields(root), 5)[0]
    if (!details) return undefined
    const tokenFields = fields(details)
    const usedTokens = numberField(tokenFields, 1)
    const maxTokens = numberField(tokenFields, 2)
    if (usedTokens <= 0 || maxTokens <= 0) return undefined
    const breakdown: Record<CursorContextCategory, number> = { tools: 0, system: 0, skills: 0, messages: 0, other: 0 }
    const snapshot = messageFields(tokenFields, 3)[0]
    for (const category of snapshot ? messageFields(fields(snapshot), 3) : []) {
      const categoryFields = fields(category)
      const id = messageFields(categoryFields, 1)[0]
      const key = CATEGORY[id ? new TextDecoder().decode(id) : ''] ?? 'other'
      breakdown[key] += numberField(categoryFields, 3)
    }
    const counted = Object.values(breakdown).reduce((sum, tokens) => sum + tokens, 0)
    // The gauge sums the categories, so they must add up to Cursor's total.
    if (counted === 0 || counted > usedTokens) {
      return { usedTokens, maxTokens, breakdown: { tools: 0, system: 0, skills: 0, messages: usedTokens, other: 0 } }
    }
    breakdown.other += usedTokens - counted
    return { usedTokens, maxTokens, breakdown }
  } catch {
    return undefined
  }
}

function rootOf(document: unknown, key: 'latestCheckpoint' | 'latestCheckpointRef'): { agentId?: string; rootBlobId?: string } {
  if (!document || typeof document !== 'object') return {}
  const record = document as Record<string, unknown>
  const ref = record[key] as { rootBlobId?: unknown } | null | undefined
  return {
    ...(typeof record.agentId === 'string' ? { agentId: record.agentId } : {}),
    ...(typeof ref?.rootBlobId === 'string' ? { rootBlobId: ref.rootBlobId } : {})
  }
}

/**
 * The same store, reporting Cursor's token details each time a step moves
 * the root checkpoint. Reads are chained so reports keep the step order.
 */
export function observeCursorCheckpointContext(
  store: LocalAgentStore,
  onDetails: (details: CursorTokenDetails) => void
): LocalAgentStore {
  let lastRoot: string | undefined
  let chain: Promise<void> = Promise.resolve()
  const inspect = ({ agentId, rootBlobId }: { agentId?: string; rootBlobId?: string }): void => {
    if (!agentId || !rootBlobId || rootBlobId === lastRoot) return
    lastRoot = rootBlobId
    chain = chain
      .then(() => store.checkpoints.get({ agentId, blobId: rootBlobId }))
      .then((bytes) => {
        const details = bytes ? cursorTokenDetails(bytes) : undefined
        if (details) onDetails(details)
      })
      .catch(() => undefined)
  }
  const watch = <T extends object>(substore: T, onUpdate: (input: unknown) => void): T =>
    new Proxy(substore, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown
        if (typeof value !== 'function') return value
        if (property !== 'update') return value.bind(target)
        return async (input: unknown) => {
          const result = await (value as (input: unknown) => Promise<unknown>).call(target, input)
          onUpdate(input)
          return result
        }
      }
    })
  const agents = store.agents && watch(store.agents, (input) =>
    inspect(rootOf((input as { agent?: unknown } | undefined)?.agent, 'latestCheckpoint')))
  const runs = store.runs && watch(store.runs, (input) =>
    inspect(rootOf((input as { run?: unknown } | undefined)?.run, 'latestCheckpointRef')))
  return new Proxy(store, {
    get(target, property) {
      if (property === 'agents') return agents
      if (property === 'runs') return runs
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/** Cursor's own occupancy as an Agent-reported snapshot of this turn. */
export function cursorContextSnapshot(
  input: { threadId: string; turnId: string; model: string; providerId: string; toolCount: number; activeSkillIds: string[] },
  details: CursorTokenDetails
): RuntimeEventDraft {
  return {
    kind: 'context_snapshot',
    threadId: input.threadId,
    turnId: input.turnId,
    model: input.model,
    providerId: input.providerId,
    stepIndex: 0,
    contextWindowTokens: details.maxTokens,
    contextWindowKnown: true,
    // Cursor summarizes at its own point, which it does not report.
    softThresholdTokens: details.maxTokens,
    hardThresholdTokens: details.maxTokens,
    estimatedInputTokens: details.usedTokens,
    breakdown: details.breakdown,
    toolCount: input.toolCount,
    activeSkillIds: input.activeSkillIds,
    contextManagement: 'sdk-managed',
    nativeHistory: 'known',
    occupancySource: 'agent'
  }
}
