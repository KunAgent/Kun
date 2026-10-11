/**
 * Renderer view of `meta.externalSubagent` (kun/src/contracts/external-subagent.ts):
 * a subagent spawned by an external Agent. It is mapped onto the same
 * `meta.child` shape Kun's own subagents use, so the timeline renders it with
 * the existing subagent card, preview and side-session view.
 */
export type ExternalSubagentSource = 'opencode' | 'opencode2' | 'codemaker' | 'codex' | 'claude-code' | 'devin'
export type ExternalSubagentStatus = 'queued' | 'running' | 'awaiting' | 'completed' | 'failed' | 'aborted'

export type ExternalSubagentView = {
  source: ExternalSubagentSource
  status: ExternalSubagentStatus
  childThreadId?: string
  nativeId?: string
  profile?: string
  label?: string
  model?: string
  detached?: boolean
  steps?: number
  activity?: string
  summary?: string
  error?: string
  progressChecks?: number
  closedByParent?: boolean
  endedWithTurn?: boolean
  unavailableReason?: string
  awaitingPermission?: 'kun' | 'native'
  stoppable?: boolean
  startedAt?: string
  durationMs?: number
  totalTokens?: number
}

export const EXTERNAL_SUBAGENT_SOURCE_LABELS: Record<ExternalSubagentSource, string> = {
  opencode: 'OpenCode',
  opencode2: 'OpenCode2',
  codemaker: 'CodeMaker',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  devin: 'Devin'
}

const SOURCES = new Set(Object.keys(EXTERNAL_SUBAGENT_SOURCE_LABELS))
const STATUSES = new Set(['queued', 'running', 'awaiting', 'completed', 'failed', 'aborted'])

/** Side threads created for external subagents carry the source Agent as `harnessId`. */
export function externalSubagentSourceForHarness(harnessId: string | undefined | null): ExternalSubagentSource | undefined {
  return harnessId && SOURCES.has(harnessId) ? harnessId as ExternalSubagentSource : undefined
}

export function readExternalSubagentMeta(meta: unknown): ExternalSubagentView | undefined {
  const record = asRecord(asRecord(meta)?.externalSubagent)
  if (!record || record.version !== 1) return undefined
  if (typeof record.source !== 'string' || !SOURCES.has(record.source)) return undefined
  if (typeof record.status !== 'string' || !STATUSES.has(record.status)) return undefined
  const view: ExternalSubagentView = {
    source: record.source as ExternalSubagentSource,
    status: record.status as ExternalSubagentStatus
  }
  for (const key of ['childThreadId', 'nativeId', 'profile', 'label', 'model', 'activity', 'summary', 'error', 'unavailableReason', 'startedAt'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) view[key] = value.trim()
  }
  for (const key of ['steps', 'progressChecks', 'durationMs', 'totalTokens'] as const) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) view[key] = Math.trunc(value)
  }
  for (const key of ['detached', 'closedByParent', 'endedWithTurn', 'stoppable'] as const) {
    if (record[key] === true) view[key] = true
  }
  if (record.awaitingPermission === 'kun' || record.awaitingPermission === 'native') {
    view.awaitingPermission = record.awaitingPermission
  }
  return view
}

/** The `meta.child` record the subagent card reads, derived from the external view. */
export function externalSubagentChildMeta(
  view: ExternalSubagentView,
  item: { threadId?: string; turnId?: string }
): Record<string, unknown> {
  const childStatus = view.status === 'completed' ? 'completed'
    : view.status === 'failed' ? 'failed'
      : view.status === 'aborted' ? 'aborted'
        : view.status === 'queued' ? 'queued' : 'running'
  const now = view.startedAt ?? new Date(0).toISOString()
  return {
    ...(item.threadId ? { parentThreadId: item.threadId } : {}),
    ...(item.turnId ? { parentTurnId: item.turnId } : {}),
    ...(view.childThreadId ? { childId: view.childThreadId } : {}),
    ...(view.label ? { childLabel: view.label } : {}),
    ...(view.profile ? { childProfile: view.profile } : {}),
    ...(view.model ? { childModel: view.model } : {}),
    childStatus,
    childSeq: 0,
    ...(view.status === 'aborted' ? { childTerminationReason: 'user_stop' } : {}),
    ...(view.detached ? { detached: true } : {}),
    ...(view.steps !== undefined ? { toolInvocations: view.steps } : {}),
    ...(view.startedAt ? { attemptStartedAt: view.startedAt } : {}),
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
    ...(view.totalTokens !== undefined ? { totalTokens: view.totalTokens } : {}),
    ...(view.activity && (childStatus === 'running' || childStatus === 'queued')
      ? { activity: { phase: 'tool', label: view.activity, startedAt: now, updatedAt: now } }
      : {})
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

const knownChildSources = new Map<string, ExternalSubagentSource>()

/** Remember which Agent owns an external subagent's side thread (for its return bar). */
export function rememberExternalSubagentChild(view: ExternalSubagentView): void {
  if (view.childThreadId) knownChildSources.set(view.childThreadId, view.source)
}

export function externalSubagentSourceForThread(threadId: string | null | undefined): ExternalSubagentSource | undefined {
  return threadId ? knownChildSources.get(threadId) : undefined
}
