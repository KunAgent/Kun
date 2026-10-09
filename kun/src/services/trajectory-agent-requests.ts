import type { TurnItem } from '../contracts/items.js'
import {
  TRAJECTORY_SCHEMA_VERSION,
  type TrajectoryRequestRecord,
  type TrajectoryStatus
} from '../contracts/trajectory.js'
import type { Turn } from '../contracts/turns.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { addUsage } from '../domain/usage.js'
import { providerModule } from '../harness/providers/registry.js'
import type { SessionUsageRecord } from '../ports/session-store.js'

/**
 * Third-party Agents run their own model loop, so Kun's request recorder never
 * sees their calls. Their trajectory is rebuilt from what they stream back:
 * one model call is a run of assistant output plus the tool calls it issued,
 * and the next call starts once those tools have returned. The usage the
 * Agent reported is attached per call when it reports per call, and as a
 * marked total on the call it followed when it reports once per turn.
 */

export type AgentTrajectoryTurn = Pick<
  Turn,
  'id' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt' | 'model' | 'providerId' | 'harnessId'
>

export type AgentRequestProjection = {
  requests: TrajectoryRequestRecord[]
  /** Owning model call of each assistant/tool item in a rebuilt turn. */
  owners: Map<string, TrajectoryRequestRecord>
  turnIds: Set<string>
}

type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>
type ToolResultItem = Extract<TurnItem, { kind: 'tool_result' }>
type OutputItem = Extract<TurnItem, { kind: 'assistant_text' | 'assistant_reasoning' }>

type Step = {
  output: OutputItem[]
  calls: ToolCallItem[]
  usage?: UsageSnapshot
  report?: SessionUsageRecord
}

/** Kun's own side calls (titles, public gateway) are not the Agent's. */
const FOREIGN_USAGE_SOURCES = new Set(['utility', 'public-gateway'])

export function isAgentTurn(turn: Pick<Turn, 'harnessId'>): boolean {
  return Boolean(turn.harnessId) && turn.harnessId !== 'kun'
}

export function projectAgentRequests(input: {
  threadId: string
  turns: readonly AgentTrajectoryTurn[]
  items: readonly TurnItem[]
  usage: readonly SessionUsageRecord[]
  /** Turns whose requests Kun recorded itself; never rebuilt. */
  tracedTurnIds: ReadonlySet<string>
}): AgentRequestProjection {
  const projection: AgentRequestProjection = { requests: [], owners: new Map(), turnIds: new Set() }
  const itemsByTurn = groupBy(input.items, (item) => item.turnId)
  const usageByTurn = groupBy(
    input.usage.filter((record) => record.turnId && !FOREIGN_USAGE_SOURCES.has(record.source ?? '')),
    (record) => record.turnId!
  )
  for (const turn of input.turns) {
    if (!isAgentTurn(turn) || input.tracedTurnIds.has(turn.id)) continue
    const items = itemsByTurn.get(turn.id) ?? []
    const reports = [...(usageByTurn.get(turn.id) ?? [])]
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
    const results = new Map(items
      .filter((item): item is ToolResultItem => item.kind === 'tool_result')
      .map((item) => [item.callId, item]))
    const steps = splitSteps(items, results)
    if (!steps.length && !reports.length) continue
    if (!steps.length) steps.push({ output: [], calls: [] })
    projection.turnIds.add(turn.id)
    const starts = stepStarts(turn, steps, results)
    attachUsage(steps, starts, reports)
    const attribution = usageAttribution(steps, turn.status === 'running' || turn.status === 'queued')
    steps.forEach((step, index) => {
      const request = projectStep({
        threadId: input.threadId,
        turn,
        step,
        index,
        startedAt: starts[index]!,
        nextStartedAt: starts[index + 1],
        last: index === steps.length - 1,
        ...attribution[index]
      })
      projection.requests.push(request)
      for (const item of [...step.output, ...step.calls]) projection.owners.set(item.id, request)
    })
  }
  return projection
}

function splitSteps(items: readonly TurnItem[], results: ReadonlyMap<string, ToolResultItem>): Step[] {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.createdAt.localeCompare(right.item.createdAt) || left.index - right.index)
    .map(({ item }) => item)
  const steps: Step[] = []
  let current: Step | undefined
  for (const item of ordered) {
    if (item.kind === 'assistant_text' || item.kind === 'assistant_reasoning') {
      if (!item.text.trim()) continue
      // Output after tool calls means the model was called again with results.
      if (!current || current.calls.length) steps.push(current = { output: [], calls: [] })
      current.output.push(item)
    } else if (item.kind === 'tool_call') {
      // A call issued after a sibling's result came back belongs to the next model call.
      if (!current || current.calls.some((call) => finishedBy(results.get(call.callId), item.createdAt))) {
        steps.push(current = { output: [], calls: [] })
      }
      current.calls.push(item)
    }
  }
  return steps
}

function stepStarts(
  turn: AgentTrajectoryTurn,
  steps: readonly Step[],
  results: ReadonlyMap<string, ToolResultItem>
): string[] {
  const starts: string[] = []
  steps.forEach((step, index) => {
    const first = firstItemAt(step)
    const previous = steps[index - 1]
    const candidate = previous
      ? latest(previous.calls.map((call) => resultAt(results.get(call.callId)))
        .filter((value): value is string => Boolean(value) && (!first || value! <= first)))
        ?? stepEnd(previous)
      : turn.startedAt ?? turn.createdAt
    starts.push(earliest([candidate, first]) ?? turn.createdAt)
  })
  return starts
}

function attachUsage(steps: Step[], starts: readonly string[], reports: readonly SessionUsageRecord[]): void {
  reports.forEach((report, position) => {
    // Per-call reporters line up one to one even when every report lands at
    // turn end; otherwise a report belongs to the call it followed.
    const index = reports.length === steps.length ? position : lastStartedBy(starts, report.completedAt)
    const step = steps[index]!
    step.usage = step.usage ? foldUsage(step.usage, report.usage) : report.usage
    step.report ??= report
  })
}

function lastStartedBy(starts: readonly string[], at: string): number {
  for (let index = starts.length - 1; index > 0; index -= 1) {
    if (starts[index]! <= at) return index
  }
  return 0
}

function usageAttribution(steps: readonly Step[], running: boolean): Array<{
  usageAttribution?: TrajectoryRequestRecord['usageAttribution']
  usageSteps?: number
}> {
  const out: Array<{ usageAttribution?: TrajectoryRequestRecord['usageAttribution']; usageSteps?: number }> =
    steps.map(() => ({}))
  let pending = 0
  steps.forEach((step, index) => {
    pending += 1
    if (!step.usage) return
    out[index] = pending > 1
      ? { usageAttribution: 'aggregate', usageSteps: pending }
      : { usageAttribution: 'call', usageSteps: 1 }
    for (let covered = index - pending + 1; covered < index; covered += 1) {
      out[covered] = { usageAttribution: 'included' }
    }
    pending = 0
  })
  // A running turn may still report usage for its latest calls.
  if (!running) {
    for (let index = steps.length - pending; index < steps.length; index += 1) {
      out[index] = { usageAttribution: 'unreported' }
    }
  }
  return out
}

function projectStep(input: {
  threadId: string
  turn: AgentTrajectoryTurn
  step: Step
  index: number
  startedAt: string
  nextStartedAt: string | undefined
  last: boolean
  usageAttribution?: TrajectoryRequestRecord['usageAttribution']
  usageSteps?: number
}): TrajectoryRequestRecord {
  const { turn, step, index, startedAt } = input
  const requestId = `agent:${turn.id}:${index}`
  const harnessId = step.report?.harnessId ?? turn.harnessId ?? 'agent'
  const model = step.report?.model ?? turn.model ?? ''
  const status = stepStatus(turn, step, input.last)
  const end = status === 'running'
    ? undefined
    : latest([
      stepEnd(step) ?? (input.last ? turn.finishedAt : input.nextStartedAt) ??
        latest([...step.output, ...step.calls].map((item) => item.createdAt)) ?? step.report?.completedAt,
      startedAt
    ])
  const firstTokenAt = step.output[0]?.createdAt
  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    id: `request:${requestId}`,
    kind: 'llm_request',
    threadId: input.threadId,
    turnId: turn.id,
    roundId: requestId,
    requestId,
    step: index,
    attempt: 1,
    attemptReason: 'initial',
    purpose: 'assistant',
    provider: step.report?.providerId ?? turn.providerId ?? harnessId,
    model,
    endpointFormat: 'agent',
    status,
    startedAt,
    ...(firstTokenAt && firstTokenAt >= startedAt ? { firstTokenAt } : {}),
    ...(end ? { completedAt: end, durationMs: elapsed(startedAt, end) } : {}),
    ...(step.usage ? { usage: step.usage } : {}),
    optionsAvailable: false,
    preview: [model, harnessId].filter(Boolean).join(' · '),
    detailState: 'not_captured',
    origin: 'agent',
    harnessId,
    harnessLabel: harnessLabel(harnessId),
    ...(input.usageAttribution ? { usageAttribution: input.usageAttribution } : {}),
    ...(input.usageSteps ? { usageSteps: input.usageSteps } : {})
  }
}

function harnessLabel(harnessId: string): string {
  try {
    return providerModule(harnessId)?.definition.displayName || harnessId
  } catch {
    return harnessId
  }
}

function stepStatus(turn: AgentTrajectoryTurn, step: Step, last: boolean): TrajectoryStatus {
  if (step.output.some((item) => item.status === 'failed')) return 'failed'
  if (step.output.some((item) => item.status === 'aborted')) return 'cancelled'
  if (!last) return 'completed'
  if (turn.status === 'running' || turn.status === 'queued') {
    return !step.calls.length || step.output.some((item) => item.status === 'running') ? 'running' : 'completed'
  }
  if (turn.status === 'failed') return 'failed'
  if (turn.status === 'aborted') return 'cancelled'
  return 'completed'
}

/** The model call ends with its last output, or when it issued its tool calls. */
function stepEnd(step: Step): string | undefined {
  return latest([
    ...step.output.map((item) => item.finishedAt ?? (step.calls.length ? item.createdAt : undefined)),
    ...step.calls.map((call) => call.createdAt)
  ])
}

function firstItemAt(step: Step): string | undefined {
  return earliest([...step.output, ...step.calls].map((item) => item.createdAt))
}

function finishedBy(result: ToolResultItem | undefined, at: string): boolean {
  const done = resultAt(result)
  return Boolean(done && done <= at)
}

function resultAt(result: ToolResultItem | undefined): string | undefined {
  return result ? result.finishedAt ?? result.createdAt : undefined
}

/** Fold a second report into one call; request timing stays the first report's. */
function foldUsage(into: UsageSnapshot, next: UsageSnapshot): UsageSnapshot {
  const { cacheableTokenHitRate, totalInputTokenHitRate, ...sum } = addUsage(into, next)
  return {
    ...sum,
    // Agents may count cache reads outside prompt tokens; a derived rate above 1 is noise.
    ...(cacheableTokenHitRate !== undefined && (cacheableTokenHitRate ?? 0) <= 1 ? { cacheableTokenHitRate } : {}),
    ...(totalInputTokenHitRate !== undefined && (totalInputTokenHitRate ?? 0) <= 1 ? { totalInputTokenHitRate } : {}),
    ...(into.requestTtftMs !== undefined ? { requestTtftMs: into.requestTtftMs } : {}),
    ...(into.requestGenerationMs !== undefined ? { requestGenerationMs: into.requestGenerationMs } : {}),
    ...(into.requestGenerationTokens !== undefined ? { requestGenerationTokens: into.requestGenerationTokens } : {})
  }
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const id = key(value)
    const group = groups.get(id)
    if (group) group.push(value)
    else groups.set(id, [value])
  }
  return groups
}

function latest(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1)
}

function earliest(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort()[0]
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

const FILE_KINDS = new Set(['read', 'edit', 'delete', 'move'])

/**
 * ACP tool calls are stored as `acp:<kind>` with the Agent's wire payload as
 * arguments. Label them like native tools: the Agent's tool kind, then the
 * command, file or query it acted on (the title when there is none). Reads the
 * sideband presentation and falls back to the arguments of older records.
 */
export function agentToolLabel(call: Extract<TurnItem, { kind: 'tool_call' }>): {
  toolName: string
  argumentPreview: string
} | null {
  if (!call.toolName.startsWith('acp:')) return null
  const side = recordOf(call.meta?.delegatedTool)
  const args = recordOf(call.arguments)
  const input = recordOf(side.input ?? args.rawInput)
  const location = recordOf(Array.isArray(args.locations) ? args.locations[0] : undefined)
  const kind = text(side.kind) ?? text(args.kind) ?? call.toolName.slice(4)
  const path = text(side.filePath) ?? text(location.path) ??
    text(input.file_path) ?? text(input.filePath) ?? text(input.path)
  const line = typeof side.line === 'number' ? side.line : typeof location.line === 'number' ? location.line : undefined
  const file = path ? `${path}${line !== undefined ? `:${line}` : ''}` : undefined
  const command = text(side.command) ?? text(input.command) ?? text(input.cmd)
  const query = text(side.query) ?? text(input.query) ?? text(input.pattern)
  const target = kind === 'execute' ? command
    : kind === 'search' ? query ?? file
      : FILE_KINDS.has(kind) ? file
        : undefined
  return {
    toolName: text(side.name) ?? kind,
    argumentPreview: target ?? text(side.title) ?? text(args.title) ?? command ?? file ?? query ?? ''
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
