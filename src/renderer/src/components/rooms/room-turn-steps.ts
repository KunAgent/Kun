import type { RoomMessage, RoomRunStep, RoomRunSteps } from '@shared/rooms-api'

/** Where a private-chat Agent message sits in its turn (one run). */
export type RoomTurnPosition = { runId: string; first: boolean; last: boolean; since?: string }
export type RoomToolStep = Extract<RoomRunStep, { kind: 'tool' }>
export type RoomApprovalStep = Extract<RoomRunStep, { kind: 'approval' }>
export type RoomStepGroup = 'command' | 'edit' | 'read' | 'search' | 'tool'

// Choice cards render outside RoomMessageRow, so steps before one go with the next row instead.
const turnRunId = (message: RoomMessage) => message.authorKind === 'member' && message.originRunId &&
  message.presentationKind !== 'choice' ? message.originRunId : undefined

/** The first loaded message of a run carries the turn header; each later one shows the work since the previous. */
export function privateTurnPositions(rows: readonly RoomMessage[]): Map<string, RoomTurnPosition> {
  const lastIndex = new Map<string, number>()
  rows.forEach((message, index) => {
    const runId = turnRunId(message)
    if (runId) lastIndex.set(runId, index)
  })
  const previous = new Map<string, string>()
  const positions = new Map<string, RoomTurnPosition>()
  rows.forEach((message, index) => {
    const runId = turnRunId(message)
    if (!runId) return
    const since = previous.get(runId)
    positions.set(message.id, { runId, first: since === undefined, last: lastIndex.get(runId) === index, ...(since ? { since } : {}) })
    previous.set(runId, message.createdAt)
  })
  return positions
}

/** Steps that started in [since, until). Missing bounds are open. */
export function stepsBetween(steps: readonly RoomRunStep[], since?: string, until?: string): RoomRunStep[] {
  const from = since ? Date.parse(since) : -Infinity
  const to = until ? Date.parse(until) : Infinity
  return steps.filter((step) => {
    const at = Date.parse(step.startedAt)
    return at >= from && at < to
  })
}

export const isToolStep = (step: RoomRunStep): step is RoomToolStep => step.kind === 'tool'
export const isDecidedApproval = (step: RoomRunStep): step is RoomApprovalStep =>
  step.kind === 'approval' && step.status !== 'pending'
export const isLiveRun = (steps?: RoomRunSteps) => !steps || steps.run.status === 'queued' || steps.run.status === 'running'

export function stepGroup(step: RoomToolStep): RoomStepGroup {
  if (step.toolKind === 'command_execution') return 'command'
  if (step.toolKind === 'file_change') return 'edit'
  if (/^(read|read_file|view|ls|list_dir|glob|grep|repo_map|fast_context|web_fetch|paper_details)$/i.test(step.toolName)) return 'read'
  if (/search|find|citations/i.test(step.toolName)) return 'search'
  return 'tool'
}

const GROUP_ORDER: RoomStepGroup[] = ['command', 'edit', 'read', 'search', 'tool']

/** Counts per kind of work, in reading order; edits count distinct files. */
export function stepCounts(steps: readonly RoomToolStep[]): Array<{ group: RoomStepGroup; count: number }> {
  const counts = new Map<RoomStepGroup, number>()
  const files = new Set<string>()
  for (const step of steps) {
    const group = stepGroup(step)
    if (group === 'edit') {
      const key = step.target ?? step.id
      if (files.has(key)) continue
      files.add(key)
    }
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return GROUP_ORDER.filter((group) => counts.has(group)).map((group) => ({ group, count: counts.get(group)! }))
}

export function changedFiles(steps: readonly RoomRunStep[]): string[] {
  return [...new Set(steps.filter(isToolStep).filter((step) => stepGroup(step) === 'edit' && step.target)
    .map((step) => step.target!))]
}

/** Wall time from the first step's start to the last step's end, or to `now` while one runs. */
export function stepSpanMs(steps: readonly RoomToolStep[], now = Date.now()): number {
  if (!steps.length) return 0
  const start = Math.min(...steps.map((step) => Date.parse(step.startedAt)))
  const end = Math.max(...steps.map((step) => step.status === 'running' ? now
    : Date.parse(step.endedAt ?? step.startedAt)))
  return Math.max(0, end - start)
}

export function runElapsedMs(run: RoomRunSteps['run']): number | undefined {
  if (run.elapsedMs !== undefined) return run.elapsedMs
  return run.startedAt && run.endedAt ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)) : undefined
}

export function durationParts(ms: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / 1000))
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 }
}

/** Compact, language-neutral step time: "8s", "3:41", "1:02:05". */
export function stepClock(ms: number): string {
  const { hours, minutes, seconds } = durationParts(ms)
  if (!hours && !minutes) return `${seconds}s`
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
