import { useEffect, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import {
  isTerminalSubagentStatus,
  type SubagentLivenessStatus
} from '../subagents/SubagentLiveness'

export type CardStatus = SubagentLivenessStatus
export type OpenChildThreadHandler = (threadId: string) => void

export const KNOWN_POSE_IDS = new Set([
  'general',
  'explore',
  'design-reviewer',
  'over-engineering-reviewer',
  'code-reviewer',
  'test-engineer',
  'security-auditor',
  'web-performance-auditor',
  'code-review',
  'compaction',
  'title',
  'summary'
])

/** Parsed shape of the `delegate_task` / `fast_context` tool `detail` JSON (all optional). */
export type DelegateDetail = {
  /** The child thread id — always present in the tool result, unlike `meta.child`. */
  childId?: string
  parentThreadId?: string
  parentTurnId?: string
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  launcher?: 'delegate_task' | 'fast_context' | 'ppt_agent' | 'component_design' | 'graph'
  terminationReason?: 'user_stop' | 'manual_stop' | 'runtime_restart' | 'child_error'
  resumable?: boolean
  resumeCount?: number
  failure?: {
    source: 'model' | 'runtime' | 'contract'
    code?: string
    category?: string
    httpStatus?: number
    retryAfterMs?: number
  }
  proactiveRetry?: {
    enabled: boolean
    eligible: boolean
    count: number
    limit: number
    remaining: number
  }
  /** Short UI title from fast_context (or early lifecycle updates). */
  title?: string
  /** Narrow explore query from the initial tool arguments payload. */
  query?: string
  summary?: string
  summaryTruncated?: boolean
  resultRef?: {
    artifactId: string
    byteSize: number
    lineCount: number
    mimeType: 'text/markdown'
  }
  resultUnavailableReason?: string
  error?: string
  profile?: string
  profileName?: string
  model?: string
  toolPolicy?: string
  toolInvocations?: number
  attemptStartedAt?: string
  attemptDurationMs?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  detached?: boolean
  generated?: boolean
  generatedAgentName?: string
}

export type ExploreBatchChildDetail = DelegateDetail & {
  index: number
  title: string
  query: string
  status: NonNullable<DelegateDetail['status']>
  profile: 'explore'
  profileName: string
}

/** A bounded, renderer-safe projection of Fast Context's source evidence. */
export type FastContextEvidence = {
  path: string
  ranges: Array<[number, number]>
  excerpt?: string
  reason?: string
}

export type FastContextEvidenceTask = {
  index: number
  title: string
  query: string
  evidence: FastContextEvidence[]
  conclusion?: string
  uncertainties: string[]
}

export type FastContextEvidencePack = {
  version: 1
  tasks: FastContextEvidenceTask[]
  uncertainties: string[]
  evidenceCount: number
}

export function parseDelegateDetail(detail: string | undefined): DelegateDetail {
  const obj = parseDetailObject(detail)
  if (!obj) return {}
  const child = recordValue(obj.child)
  const usage = recordValue(obj.usage) ?? recordValue(child?.usage)
  const routing = obj.routing && typeof obj.routing === 'object' ? (obj.routing as Record<string, unknown>) : undefined
  const generatedAgent = obj.generatedAgent && typeof obj.generatedAgent === 'object'
    ? (obj.generatedAgent as Record<string, unknown>)
    : undefined
  const routingAgent = routing?.agent && typeof routing.agent === 'object'
    ? (routing.agent as Record<string, unknown>)
    : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const status = (v: unknown): DelegateDetail['status'] =>
    v === 'queued' || v === 'running' || v === 'completed' || v === 'failed' || v === 'aborted'
      ? v
      : undefined
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const launcher = (v: unknown): DelegateDetail['launcher'] =>
    v === 'delegate_task' || v === 'ppt_agent' || v === 'component_design' || v === 'graph' || v === 'fast_context'
      ? v
      : v === 'explore_agent'
        ? 'fast_context'
        : undefined
  const evidencePack = parseFastContextEvidencePack(detail)
  const singleTask = evidencePack?.tasks.length === 1 ? evidencePack.tasks[0] : undefined
  const resultRef = recordValue(obj.resultRef) ?? recordValue(child?.resultRef)
  const failure = recordValue(obj.failure) ?? recordValue(child?.failure)
  const proactiveRetry = recordValue(obj.proactiveRetry) ?? recordValue(child?.proactiveRetry)
  const artifactId = str(resultRef?.artifactId)
  const byteSize = num(resultRef?.byteSize)
  const lineCount = num(resultRef?.lineCount)
  return {
    childId: str(obj.childId) ?? str(child?.childId),
    parentThreadId: str(obj.parentThreadId) ?? str(child?.parentThreadId),
    parentTurnId: str(obj.parentTurnId) ?? str(child?.parentTurnId),
    status: status(obj.status) ?? status(child?.status),
    launcher: launcher(obj.launcher) ?? launcher(child?.launcher),
    terminationReason: obj.terminationReason === 'user_stop' || obj.terminationReason === 'manual_stop' ||
      obj.terminationReason === 'runtime_restart' || obj.terminationReason === 'child_error'
      ? obj.terminationReason
      : child?.terminationReason === 'user_stop' || child?.terminationReason === 'manual_stop' ||
          child?.terminationReason === 'runtime_restart' || child?.terminationReason === 'child_error'
        ? child.terminationReason
      : undefined,
    resumable: typeof obj.resumable === 'boolean'
      ? obj.resumable
      : typeof child?.resumable === 'boolean' ? child.resumable : undefined,
    resumeCount: num(obj.resumeCount) ?? num(child?.resumeCount),
    ...(failure?.source === 'model' || failure?.source === 'runtime' || failure?.source === 'contract'
      ? {
          failure: {
            source: failure.source,
            ...(str(failure.code) ? { code: str(failure.code) } : {}),
            ...(str(failure.category) ? { category: str(failure.category) } : {}),
            ...(num(failure.httpStatus) !== undefined ? { httpStatus: num(failure.httpStatus) } : {}),
            ...(num(failure.retryAfterMs) !== undefined ? { retryAfterMs: num(failure.retryAfterMs) } : {})
          }
        }
      : {}),
    ...(proactiveRetry && typeof proactiveRetry.enabled === 'boolean' &&
      typeof proactiveRetry.eligible === 'boolean' &&
      num(proactiveRetry.count) !== undefined && num(proactiveRetry.limit) !== undefined &&
      num(proactiveRetry.remaining) !== undefined
      ? {
          proactiveRetry: {
            enabled: proactiveRetry.enabled,
            eligible: proactiveRetry.eligible,
            count: num(proactiveRetry.count)!,
            limit: num(proactiveRetry.limit)!,
            remaining: num(proactiveRetry.remaining)!
          }
        }
      : {}),
    title: str(obj.title) ?? str(obj.label) ?? str(child?.title) ?? str(child?.label) ?? singleTask?.title,
    query: str(obj.query) ?? str(child?.query) ?? singleTask?.query,
    summary: str(obj.summary) ?? str(child?.summary),
    summaryTruncated: obj.summaryTruncated === true || child?.summaryTruncated === true,
    ...(artifactId && byteSize !== undefined && lineCount !== undefined
      ? { resultRef: { artifactId, byteSize, lineCount, mimeType: 'text/markdown' } }
      : {}),
    resultUnavailableReason: str(obj.resultUnavailableReason) ?? str(child?.resultUnavailableReason),
    error: str(obj.error) ?? str(child?.error),
    profile: str(obj.profile) ?? str(child?.profile),
    profileName: str(obj.profileName) ?? str(child?.profileName),
    model: str(obj.model) ?? str(child?.model),
    toolPolicy: str(obj.toolPolicy) ?? str(child?.toolPolicy),
    toolInvocations: num(obj.toolInvocations) ?? num(child?.toolInvocations),
    attemptStartedAt: str(obj.attemptStartedAt) ?? str(child?.attemptStartedAt),
    attemptDurationMs: num(obj.attemptDurationMs) ?? num(child?.attemptDurationMs),
    durationMs: num(obj.durationMs) ?? num(child?.durationMs),
    queuedMs: num(obj.queuedMs) ?? num(child?.queuedMs),
    totalTokens: usage ? num(usage.totalTokens) : undefined,
    detached: obj.detached === true || child?.detached === true,
    generated: routing?.selectedKind === 'generated' ||
      (str(obj.profile) ?? str(child?.profile))?.startsWith('generated:') === true,
    generatedAgentName: str(generatedAgent?.name) ?? str(routingAgent?.name)
  }
}

/**
 * Parse the single-child Fast Context evidence contract. Invalid subtrees are
 * ignored rather than rendered, so a malformed persisted detail never makes a
 * timeline card fail to mount.
 */
export function parseFastContextEvidencePack(detail: string | undefined): FastContextEvidencePack | undefined {
  const obj = parseDetailObject(detail)
  const rawPack = recordValue(obj?.evidencePack)
  if (!rawPack || rawPack.version !== 1 || !Array.isArray(rawPack.tasks)) return undefined
  if (rawPack.tasks.length < 1 || rawPack.tasks.length > 4) return undefined
  const tasks: FastContextEvidenceTask[] = []
  const seenIndexes = new Set<number>()
  for (const rawTask of rawPack.tasks) {
    const task = parseFastContextEvidenceTask(rawTask)
    if (!task || seenIndexes.has(task.index)) return undefined
    seenIndexes.add(task.index)
    tasks.push(task)
  }
  return {
    version: 1,
    tasks: tasks.sort((left, right) => left.index - right.index),
    uncertainties: stringList(rawPack.uncertainties, 12, 320),
    evidenceCount: tasks.reduce((count, task) => count + task.evidence.length, 0)
  }
}

function parseFastContextEvidenceTask(value: unknown): FastContextEvidenceTask | undefined {
  const rawTask = recordValue(value)
  if (!rawTask) return undefined
  const index = rawTask.index
  const title = boundedString(rawTask.title, 160)
  const query = boundedString(rawTask.query, 800)
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 3 || !title || !query) return undefined
  const evidence = Array.isArray(rawTask.evidence)
    ? rawTask.evidence.flatMap((item) => {
      const parsed = parseFastContextEvidence(item)
      return parsed ? [parsed] : []
    }).slice(0, 30)
    : []
  return {
    index: index as number,
    title,
    query,
    evidence,
    conclusion: boundedString(rawTask.conclusion, 1_600),
    uncertainties: stringList(rawTask.uncertainties, 8, 320)
  }
}

function parseFastContextEvidence(value: unknown): FastContextEvidence | undefined {
  const rawEvidence = recordValue(value)
  const path = boundedString(rawEvidence?.path, 600)
  if (!path || !Array.isArray(rawEvidence?.ranges)) return undefined
  const ranges = rawEvidence.ranges.flatMap((value) => {
    if (!Array.isArray(value) || value.length !== 2) return []
    const [start, end] = value
    return Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start
      ? [[start, end] as [number, number]]
      : []
  }).slice(0, 12)
  if (ranges.length === 0) return undefined
  return {
    path,
    ranges,
    excerpt: boundedString(rawEvidence.excerpt, 1_000),
    reason: boundedString(rawEvidence.reason, 500)
  }
}

function parseDetailObject(detail: string | undefined): Record<string, unknown> | undefined {
  if (!detail || !detail.trim()) return undefined
  try {
    return recordValue(JSON.parse(detail))
  } catch {
    return undefined
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const parsed = boundedString(item, maxLength)
      return parsed ? [parsed] : []
    }).slice(0, maxItems)
    : []
}

const COMPLETED_STATUS_MARKERS = [
  'status: completed',
  '"status":"completed"',
  '"status": "completed"'
] as const

/** Detects legacy bad records where a stringified completed tool_result was
 * used as the failure error text; such cards must not render as failed. */
function errorSelfDescribesCompletion(error: string | undefined): boolean {
  if (!error) return false
  const normalized = error.replace(/\s+/g, ' ')
  return COMPLETED_STATUS_MARKERS.some((marker) => normalized.includes(marker))
}

/** Parse the new aggregate explore result without changing legacy scalar parsing. */
export function parseExploreBatchChildren(detail: string | undefined): ExploreBatchChildDetail[] {
  if (!detail || !detail.trim()) return []
  let raw: unknown
  try {
    raw = JSON.parse(detail)
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const children = (raw as Record<string, unknown>).children
  if (!Array.isArray(children) || children.length < 1 || children.length > 4) return []
  const parsed: ExploreBatchChildDetail[] = []
  const seen = new Set<number>()
  for (const candidate of children) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const child = candidate as Record<string, unknown>
    const detailValue = parseDelegateDetail(JSON.stringify(child))
    const index = child.index
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 3 || seen.has(index as number)) {
      return []
    }
    if (!detailValue.title || !detailValue.query || !detailValue.status || detailValue.profile !== 'explore') {
      return []
    }
    seen.add(index as number)
    parsed.push({
      ...detailValue,
      index: index as number,
      title: detailValue.title,
      query: detailValue.query,
      status: detailValue.status,
      profile: 'explore',
      profileName: detailValue.profileName || 'Repository Explorer'
    })
  }
  return parsed.sort((left, right) => left.index - right.index)
}

export type ChildMeta = {
  childId?: string
  childLabel?: string
  childProfile?: string
  childProfileName?: string
  childModel?: string
  childStatus?: string
  childSeq?: number
  childLauncher?: DelegateDetail['launcher']
  childTerminationReason?: DelegateDetail['terminationReason']
  resumable?: boolean
  resumeCount?: number
  failure?: DelegateDetail['failure']
  proactiveRetry?: DelegateDetail['proactiveRetry']
  parentThreadId?: string
  parentTurnId?: string
  toolInvocations?: number
  attemptStartedAt?: string
  attemptDurationMs?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  summaryTruncated?: boolean
  resultRef?: DelegateDetail['resultRef']
  resultUnavailableReason?: string
  detached?: boolean
}

export function readChildMeta(block: ChatBlock): ChildMeta {
  const meta =
    block.kind === 'tool' || block.kind === 'approval' || block.kind === 'user'
      ? block.meta
      : undefined
  const child = meta?.child && typeof meta.child === 'object' ? (meta.child as Record<string, unknown>) : null
  if (!child) return {}
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const launcher = (v: unknown): DelegateDetail['launcher'] =>
    v === 'delegate_task' || v === 'ppt_agent' || v === 'component_design' || v === 'graph' || v === 'fast_context'
      ? v
      : v === 'explore_agent'
        ? 'fast_context'
        : undefined
  return {
    childId: str(child.childId),
    childLabel: str(child.childLabel),
    childProfile: str(child.childProfile),
    childProfileName: str(child.childProfileName),
    childModel: str(child.childModel),
    childStatus: str(child.childStatus),
    childSeq: typeof child.childSeq === 'number' ? child.childSeq : undefined,
    childLauncher: launcher(child.childLauncher),
    childTerminationReason: child.childTerminationReason === 'user_stop' || child.childTerminationReason === 'manual_stop' ||
      child.childTerminationReason === 'runtime_restart' || child.childTerminationReason === 'child_error'
      ? child.childTerminationReason
      : undefined,
    resumable: typeof child.resumable === 'boolean' ? child.resumable : undefined,
    resumeCount: typeof child.resumeCount === 'number' ? child.resumeCount : undefined,
    ...(child.failure && typeof child.failure === 'object'
      ? { failure: child.failure as DelegateDetail['failure'] }
      : {}),
    ...(child.proactiveRetry && typeof child.proactiveRetry === 'object'
      ? { proactiveRetry: child.proactiveRetry as DelegateDetail['proactiveRetry'] }
      : {}),
    parentThreadId: str(child.parentThreadId),
    parentTurnId: str(child.parentTurnId),
    toolInvocations: typeof child.toolInvocations === 'number' ? child.toolInvocations : undefined,
    attemptStartedAt: str(child.attemptStartedAt),
    attemptDurationMs: typeof child.attemptDurationMs === 'number' ? child.attemptDurationMs : undefined,
    durationMs: typeof child.durationMs === 'number' ? child.durationMs : undefined,
    queuedMs: typeof child.queuedMs === 'number' ? child.queuedMs : undefined,
    totalTokens: typeof child.totalTokens === 'number' ? child.totalTokens : undefined,
    summaryTruncated: child.summaryTruncated === true,
    ...(child.resultRef && typeof child.resultRef === 'object'
      ? { resultRef: child.resultRef as DelegateDetail['resultRef'] }
      : {}),
    resultUnavailableReason: str(child.resultUnavailableReason),
    detached: child.detached === true
  }
}

export function subagentResumeRequestId(childId: string, resumeCount: number): string {
  return `subagent-resume:${resumeCount}:${childId}`.slice(0, 256)
}

/**
 * Map the child run + block status to one of five card states. Terminal
 * evidence is monotonic: a stale replayed `queued`/`running` child snapshot
 * must not override a settled tool result that is already on the timeline.
 */
export function resolveStatus(block: ChatBlock, child: ChildMeta, detail?: DelegateDetail): CardStatus {
  const detached = child.detached === true || detail?.detached === true
  const cs = child.childStatus
  const blockStatus =
    'status' in block && typeof block.status === 'string' ? block.status : undefined
  const userStopped = (child.childTerminationReason ?? detail?.terminationReason) === 'user_stop'

  // A terminal child event is the most specific signal and can still turn a
  // superficially successful tool result into a failed child card.
  if (cs === 'completed') return 'done'
  if (cs === 'aborted') return userStopped ? 'stopped' : 'failed'
  if (cs === 'failed') return 'failed'
  if (detail?.status === 'completed') return 'done'
  if (detail?.status === 'aborted') return userStopped ? 'stopped' : 'failed'
  // Legacy bad records: a failed detail whose error text self-describes a
  // completed child (stringified tool_result used as a fake summary) must not
  // render a misleading red "failed" card. Requiring an evidence pack keeps
  // this downgrade pinned to the Fast Context bad-record shape instead of any
  // failure whose error text happens to mention "status: completed".
  if (
    detail?.status === 'failed' &&
    errorSelfDescribesCompletion(detail.error) &&
    parseFastContextEvidencePack(block.kind === 'tool' ? (block as ToolBlock).detail : undefined) !== undefined
  ) return 'done'
  if (detail?.status === 'failed') return 'failed'

  // Detaching settles the wrapper tool call, not the child run. Keep live
  // detached lifecycle evidence authoritative until a child terminal event arrives.
  if (detached) {
    if (cs === 'queued' || cs === 'running') return 'running'
    if (detail?.status === 'queued' || detail?.status === 'running') return 'running'
  }

  // For foreground and legacy records, a settled wrapper result remains a
  // useful fallback when lifecycle metadata is missing or stale.
  if (blockStatus === 'success') return 'done'
  if (blockStatus === 'error') return 'failed'

  if (cs === 'queued') return 'queued'
  if (cs === 'running') return 'running'
  if (detail?.status === 'queued') return 'queued'
  if (detail?.status === 'running') return 'running'
  // Pending approval surfaced as an approval block alongside the child.
  if (block.kind === 'approval' && block.status === 'pending') return 'awaiting-permission'
  if (blockStatus === 'running') return 'running'
  return 'running'
}

export function isTerminal(status: CardStatus): boolean {
  return isTerminalSubagentStatus(status)
}

/** Deterministic hue from a string, so same-pose custom agents differ. */
export function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}

/** Freeze animation when the card scrolls out of the viewport. */
export function useOnScreen(ref: React.RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry) setOnScreen(entry.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return onScreen
}

export function StatusPill({ status, t }: { status: CardStatus; t: (k: string) => string }): ReactElement | null {
  const base = 'whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-semibold'
  switch (status) {
    case 'queued':
      return <span className={`${base} bg-ds-card-muted text-ds-muted`}>{t('subagentStatusQueued')}</span>
    case 'running':
      return <span className={`${base} bg-accent/10 text-accent`}>{t('subagentStatusRunning')}</span>
    case 'done':
      return (
        <span className={`${base} text-ds-success bg-ds-success-soft`}>{t('subagentStatusDone')}</span>
      )
    case 'stopped':
      return (
        <span className={`${base} bg-ds-card-muted text-ds-muted`}>{t('subagentStatusStopped')}</span>
      )
    case 'failed':
      return (
        <span className={`${base} text-ds-danger bg-ds-danger-soft`}>{t('subagentStatusFailed')}</span>
      )
    case 'awaiting-permission':
      return (
        <span className={`${base} bg-amber-500/10 text-amber-600 dark:text-amber-300`}>
          {t('subagentStatusAwaiting')}
        </span>
      )
    default:
      return null
  }
}

export function subagentStatusText(status: CardStatus, t: (key: string) => string): string {
  const keys: Record<CardStatus, string> = {
    queued: 'subagentStatusQueued',
    running: 'subagentStatusRunning',
    done: 'subagentStatusDone',
    stopped: 'subagentStatusStopped',
    failed: 'subagentStatusFailed',
    'awaiting-permission': 'subagentStatusAwaiting'
  }
  return t(keys[status])
}

export function BackgroundPill({ t }: { t: (k: string) => string }): ReactElement {
  return (
    <span className="whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-[2px] text-[10.5px] font-semibold text-sky-600 dark:text-sky-300">
      {t('subagentDetachedBadge')}
    </span>
  )
}

export function GeneratedPill({ t }: { t: TFunction<'common'> }): ReactElement {
  return (
    <span className="whitespace-nowrap rounded-full bg-violet-500/10 px-2 py-[2px] text-[10.5px] font-semibold text-violet-600 dark:text-violet-300">
      {t('subagentGeneratedBadge', { defaultValue: 'Generated' })}
    </span>
  )
}

export function ExploreKindBadge({ t }: { t: TFunction<'common'> }): ReactElement {
  return (
    <span
      data-testid="explore-kind-badge"
      className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-[2px] text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300"
    >
      {t('exploreKindBadge', { defaultValue: 'Explore' })}
    </span>
  )
}

export function MetaChip({ children, title }: { children: React.ReactNode; title?: string }): ReactElement {
  return (
    <span
      className="rounded-[7px] border border-ds-border-muted bg-ds-card-muted/45 px-2 py-[3px] text-[10.5px] text-ds-muted"
      title={title}
    >
      {children}
    </span>
  )
}

export function ProactiveRetryBadge({
  retry,
  t,
  remaining = false
}: {
  retry: NonNullable<DelegateDetail['proactiveRetry']>
  t: TFunction<'common'>
  remaining?: boolean
}): ReactElement {
  if (remaining) {
    return (
      <MetaChip>
        {t('subagentProactiveRetryRemaining', {
          defaultValue: '{{remaining}} proactive retries left',
          remaining: retry.remaining
        })}
      </MetaChip>
    )
  }
  return (
    <span
      className="whitespace-nowrap rounded-full bg-sky-500/10 px-2 py-[2px] text-[10.5px] font-semibold text-sky-700 dark:text-sky-300"
      data-testid="subagent-proactive-retry-progress"
    >
      {t('subagentProactiveRetryProgress', {
        defaultValue: 'Retry {{count}}/{{limit}}',
        count: retry.count,
        limit: retry.limit
      })}
    </span>
  )
}

export function AgentModelMetadata({
  agentIdentity,
  profileId,
  model,
  compact,
  t
}: {
  agentIdentity: string
  profileId?: string
  /** When omitted/empty, the model chips are hidden (never show "Not recorded"). */
  model?: string
  compact: boolean
  t: TFunction<'common'>
}): ReactElement {
  const labelClass = 'shrink-0 rounded-[5px] bg-ds-card-muted/70 px-1.5 py-0.5 font-semibold text-ds-faint'
  const valueClass = 'min-w-0 truncate rounded-[5px] bg-ds-card-muted/45 px-1.5 py-0.5 text-ds-muted'
  const modelValue = model?.trim() || ''
  return (
    <div
      data-testid="subagent-route-metadata"
      data-agent-id={profileId ?? ''}
      data-model={modelValue}
      className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden text-[10.5px] leading-4"
    >
      <span className={labelClass}>{t('subagentAgentLabel', { defaultValue: 'Agent' })}</span>
      <span
        className={`${valueClass} ${compact ? 'max-w-[180px]' : 'max-w-[240px]'}`}
        title={agentIdentity}
      >
        {agentIdentity}
      </span>
      {modelValue ? (
        <>
          <span className="shrink-0 text-ds-faint">·</span>
          <span className={labelClass}>{t('subagentModelLabel', { defaultValue: 'Model' })}</span>
          <span
            className={`${valueClass} ${compact ? 'max-w-[130px]' : 'max-w-[180px]'} font-mono`}
            title={modelValue}
          >
            {modelValue}
          </span>
        </>
      ) : null}
    </div>
  )
}
