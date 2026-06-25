import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, ExternalLink, Hourglass, Loader2, TriangleAlert } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { AgentKun } from '../subagents/AgentKun'

/**
 * "Kun Crew" — the subagent (`delegate_task`) visualization for the chat
 * timeline. A single delegation renders as one {@link SubagentCallCard}; sibling
 * delegations of one turn coalesce under a {@link SwarmHeader} (only N >= 2).
 *
 * Three independent visual channels: AgentKun **pose** = role, **motion** =
 * liveness, **disc ring + status dot** = status. Bound only to fields that
 * exist today (`block.meta.child` + guarded parse of the tool `detail` JSON);
 * every read degrades gracefully so a contract change never blanks the card.
 */

type CardStatus = 'queued' | 'running' | 'done' | 'failed' | 'awaiting-permission'

const KNOWN_POSE_IDS = new Set([
  'general',
  'explore',
  'design-reviewer',
  'over-engineering-reviewer',
  'code-review',
  'compaction',
  'title',
  'summary'
])

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Parsed shape of the `delegate_task` tool `detail` JSON (all optional). */
type DelegateDetail = {
  /** The child thread id — always present in the tool result, unlike `meta.child`. */
  childId?: string
  summary?: string
  error?: string
  profile?: string
  toolPolicy?: string
  toolInvocations?: number
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
}

function parseDelegateDetail(detail: string | undefined): DelegateDetail {
  if (!detail || !detail.trim()) return {}
  let raw: unknown
  try {
    raw = JSON.parse(detail)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const usage = obj.usage && typeof obj.usage === 'object' ? (obj.usage as Record<string, unknown>) : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  return {
    childId: str(obj.childId),
    summary: str(obj.summary),
    error: str(obj.error),
    profile: str(obj.profile),
    toolPolicy: str(obj.toolPolicy),
    toolInvocations: num(obj.toolInvocations),
    durationMs: num(obj.durationMs),
    queuedMs: num(obj.queuedMs),
    totalTokens: usage ? num(usage.totalTokens) : undefined
  }
}

type ChildMeta = {
  childId?: string
  childLabel?: string
  childProfile?: string
  childStatus?: string
  childSeq?: number
  parentTurnId?: string
}

function readChildMeta(block: ChatBlock): ChildMeta {
  const meta =
    block.kind === 'tool' || block.kind === 'approval' || block.kind === 'user'
      ? block.meta
      : undefined
  const child = meta?.child && typeof meta.child === 'object' ? (meta.child as Record<string, unknown>) : null
  if (!child) return {}
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  return {
    childId: str(child.childId),
    childLabel: str(child.childLabel),
    childProfile: str(child.childProfile),
    childStatus: str(child.childStatus),
    childSeq: typeof child.childSeq === 'number' ? child.childSeq : undefined,
    parentTurnId: str(child.parentTurnId)
  }
}

/**
 * Map the child run + block status to one of five card states. `childStatus`
 * (when present) wins; otherwise fall back to `block.status`.
 */
function resolveStatus(block: ChatBlock, child: ChildMeta): CardStatus {
  const cs = child.childStatus
  if (cs === 'queued') return 'queued'
  if (cs === 'running') return 'running'
  if (cs === 'completed') return 'done'
  if (cs === 'failed' || cs === 'aborted') return 'failed'
  // Pending approval surfaced as an approval block alongside the child.
  if (block.kind === 'approval' && block.status === 'pending') return 'awaiting-permission'
  const blockStatus =
    'status' in block && typeof block.status === 'string' ? block.status : undefined
  if (blockStatus === 'running') return 'running'
  if (blockStatus === 'error') return 'failed'
  if (blockStatus === 'success') return 'done'
  return 'running'
}

function isTerminal(status: CardStatus): boolean {
  return status === 'done' || status === 'failed'
}

/** Deterministic hue from a string, so same-pose custom agents differ. */
function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 360
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(REDUCED_MOTION_QUERY)
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/** Freeze animation when the card scrolls out of the viewport. */
function useOnScreen(ref: React.RefObject<Element | null>): boolean {
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

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Live elapsed ticker. While `running`, ticks `now - createdAt` once a second;
 * on a terminal status it freezes at `durationMs` (or the last tick). Local-only.
 */
function useElapsed(
  status: CardStatus,
  createdAt: string | undefined,
  durationMs: number | undefined
): string {
  const start = useMemo(() => {
    const parsed = createdAt ? Date.parse(createdAt) : NaN
    return Number.isFinite(parsed) ? parsed : Date.now()
  }, [createdAt])
  const [now, setNow] = useState(() => Date.now())
  const running = status === 'running' || status === 'awaiting-permission' || status === 'queued'
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  if (status === 'queued') return '—'
  if (isTerminal(status) && typeof durationMs === 'number') return mmss(durationMs)
  return mmss(now - start)
}

const DISC_BG: Record<CardStatus, string> = {
  queued: 'radial-gradient(circle at 50% 36%,#fff 0%,#eef4fb 80%)',
  running: 'radial-gradient(circle at 50% 36%,#fff 0%,#e3eefb 82%)',
  done: 'radial-gradient(circle at 50% 36%,#fff 0%,#e4f5ee 82%)',
  failed: 'radial-gradient(circle at 50% 36%,#fff 0%,#fbe6e4 82%)',
  'awaiting-permission': 'radial-gradient(circle at 50% 36%,#fff 0%,#fbf0df 82%)'
}
const DISC_RING: Record<CardStatus, string> = {
  queued: 'inset 0 0 0 1px rgba(188,214,245,0.7)',
  running: 'inset 0 0 0 1px var(--ds-accent, #3b82d8)',
  done: 'inset 0 0 0 1px #8fd9bf',
  failed: 'inset 0 0 0 1px #efa8a2',
  'awaiting-permission': 'inset 0 0 0 1px #e8c486'
}

function StatusDot({ status }: { status: CardStatus }): ReactElement {
  const ring = 'absolute -bottom-px -right-px flex h-[13px] w-[13px] items-center justify-center rounded-full border-[2.5px] border-ds-card'
  if (status === 'done') {
    return (
      <span className={`${ring} bg-emerald-500 dark:bg-emerald-400`}>
        <Check className="h-2 w-2 text-white" strokeWidth={3.5} />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={`${ring} bg-red-500 dark:bg-red-400`}>
        <TriangleAlert className="h-2 w-2 text-white" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'queued') {
    return <span className={`${ring} bg-ds-faint/60`} />
  }
  if (status === 'awaiting-permission') {
    return <span className={`${ring} bg-amber-500`} />
  }
  // running: pulsing accent dot
  return <span className={`${ring} ds-subagent-dot-pulse bg-accent`} />
}

function StatusPill({ status, t }: { status: CardStatus; t: (k: string) => string }): ReactElement | null {
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

/** 2.5px liveness lane directly under the trigger row. */
function LaneHairline({ status, animate }: { status: CardStatus; animate: boolean }): ReactElement | null {
  if (status === 'queued') return null
  const base = 'relative h-[2.5px] w-full overflow-hidden bg-ds-border-muted'
  if (status === 'running') {
    return (
      <div className={base}>
        {animate ? (
          <span className="ds-subagent-lane-sweep absolute top-0 h-full w-2/5 rounded-[2px]" />
        ) : (
          <span className="absolute inset-y-0 left-0 w-1/3 bg-accent/60" />
        )}
      </div>
    )
  }
  if (status === 'done') {
    return (
      <div className={base}>
        <span className="absolute inset-0 bg-emerald-500" />
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className={base}>
        <span className="absolute inset-y-0 left-0 w-[62%] bg-red-500" />
      </div>
    )
  }
  // awaiting-permission: striped amber, paused
  return (
    <div className={base}>
      <span
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg,#dd9444 0 6px,transparent 6px 12px)'
        }}
      />
    </div>
  )
}

function AvatarDisc({
  poseId,
  status,
  hue,
  compact,
  animate
}: {
  poseId: string
  status: CardStatus
  hue: number | null
  compact: boolean
  animate: boolean
}): ReactElement {
  // Failed: keep the pose, freeze motion, tint disc red (reads "stuck", not "asleep").
  // Queued: AgentKun's disabled (resting) path, grayscale + static.
  const disabled = status === 'queued'
  const frozen = !animate || status === 'failed' || isTerminal(status)
  const size = compact ? 'h-9 w-9' : 'h-11 w-11'
  const inner = compact ? 'h-[31px] w-[31px]' : 'h-9 w-9'
  // Hash-tint for same-pose custom agents — applied to the wrapper gradient only.
  const bg =
    hue !== null && status !== 'failed' && status !== 'done'
      ? `radial-gradient(circle at 50% 36%,#fff 0%,hsl(${hue} 60% 94%) 82%)`
      : DISC_BG[status]
  return (
    <span
      className={`relative flex ${size} shrink-0 items-center justify-center rounded-full ${
        frozen ? 'ds-subagent-frozen' : ''
      }`}
      style={{ background: bg, boxShadow: DISC_RING[status] }}
    >
      <AgentKun id={poseId} disabled={disabled} className={inner} />
      <StatusDot status={status} />
    </span>
  )
}

function MetaChip({ children, title }: { children: React.ReactNode; title?: string }): ReactElement {
  return (
    <span
      className="rounded-[7px] border border-ds-border-muted bg-ds-card-muted/45 px-2 py-[3px] text-[10.5px] text-ds-muted"
      title={title}
    >
      {children}
    </span>
  )
}

export function SubagentCallCard({
  block,
  compact = false,
  inGroup = false
}: {
  block: ChatBlock
  /** Smaller avatar variant used inside a swarm group. */
  compact?: boolean
  /** Inside a SwarmHeader group: suppress own shell, inline-toggle only. */
  inGroup?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const selectThread = useChatStore((s) => s.selectThread)
  const reducedMotion = useReducedMotion()
  const ref = useRef<HTMLElement | null>(null)
  const onScreen = useOnScreen(ref)

  const child = readChildMeta(block)
  const detail = useMemo(
    () => parseDelegateDetail(block.kind === 'tool' ? (block as ToolBlock).detail : undefined),
    [block]
  )
  const status = resolveStatus(block, child)
  const animate = !reducedMotion && onScreen && status === 'running'

  // Profile id: prefer the live `childProfile` from the runtime metadata (set on
  // the first queued/running event) so the agent type shows immediately; the
  // result-JSON `profile` only arrives after the child completes.
  const profileId = child.childProfile || detail.profile
  // Pose key: profile → childLabel → block toolName → 'custom'.
  const poseId = profileId || child.childLabel || child.childId || 'custom'
  const isKnownPose = KNOWN_POSE_IDS.has(poseId)
  const hue = isKnownPose ? null : hashHue(poseId)

  // Name priority: localized name for a known built-in role → the model's label
  // → a custom profile's own name → a short name derived from the task → default.
  const taskText = block.kind === 'tool' ? splitTaskLine(block as ToolBlock) : undefined
  const roleName =
    (profileId && KNOWN_POSE_IDS.has(profileId)
      ? t(`subagentsPanel.role.${profileId}.name`, profileId)
      : undefined) ||
    child.childLabel?.trim() ||
    profileId?.trim() ||
    taskText?.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 28) ||
    t('subagentDefaultName')
  const taskParts = [child.childLabel, detail.summary || (block.kind === 'tool' ? splitTaskLine(block as ToolBlock) : undefined)]
    .filter((p): p is string => Boolean(p && p.trim()))
  const taskLine = taskParts.join(' · ')

  const elapsed = useElapsed(status, block.createdAt, detail.durationMs)
  const steps = detail.toolInvocations

  // Auto-expand once on first terminal transition iff summary/error present.
  const hasBody = Boolean(detail.summary?.trim() || detail.error?.trim())
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const autoExpandedRef = useRef(false)
  const [autoExpanded, setAutoExpanded] = useState(false)
  useEffect(() => {
    if (autoExpandedRef.current) return
    if (isTerminal(status) && hasBody && !inGroup) {
      autoExpandedRef.current = true
      setAutoExpanded(true)
    }
  }, [status, hasBody, inGroup])
  const expanded = (userToggled ?? autoExpanded) && hasBody

  // `meta.child` is only attached on the live child events (which the renderer
  // currently drops), so for a completed delegation the reliable source of the
  // child thread id is the tool result JSON (`detail.childId`).
  const childId = child.childId || detail.childId
  const openChild = (): void => {
    if (!childId) return
    void selectThread(childId).catch(() => undefined)
  }

  // Stagger sweep/pulse per child so a swarm reads as independent.
  const staggerDelay = typeof child.childSeq === 'number' ? `${(child.childSeq % 6) * 0.18}s` : '0s'

  const shellClass = inGroup
    ? 'overflow-hidden border-t border-ds-border-muted first:border-t-0'
    : 'ds-subagent-mount overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/80 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl'
  const failBorder = !inGroup && status === 'failed' ? ' border-ds-danger/60' : ''

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={`${shellClass}${failBorder}`}
      style={{ ['--ds-subagent-stagger' as string]: staggerDelay }}
      aria-label={`${roleName} · ${pillText(status, t)}`}
    >
      <div
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        onClick={() => {
          if (hasBody) setUserToggled(!expanded)
        }}
        onKeyDown={(e) => {
          if (!hasBody) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setUserToggled(!expanded)
          }
        }}
        className={`flex items-center gap-3 px-4 ${compact ? 'py-2.5' : 'py-3'} text-left ${
          hasBody ? 'cursor-pointer transition hover:bg-ds-hover/30' : ''
        }`}
      >
        <AvatarDisc poseId={poseId} status={status} hue={hue} compact={compact} animate={animate} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-ds-ink">{roleName}</span>
            {!compact || !inGroup ? <StatusPill status={status} t={t} /> : null}
          </span>
          {taskLine ? (
            <span className="mt-0.5 block truncate text-[12.5px] text-ds-muted">{taskLine}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-[13px] font-semibold text-ds-ink">{elapsed}</span>
          <span className="mt-px block text-[10.5px] text-ds-faint">
            {typeof steps === 'number'
              ? t('subagentSteps', { count: steps })
              : status === 'queued' && typeof detail.queuedMs === 'number'
                ? t('subagentQueuedHint')
                : ''}
          </span>
        </span>
        {childId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openChild()
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-accent/10 hover:text-accent"
            aria-label={t('subagentOpenSession')}
            title={t('subagentOpenSession')}
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
        {hasBody ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          )
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint/40" strokeWidth={1.8} />
        )}
      </div>

      <LaneHairline status={status} animate={animate} />

      {expanded ? (
        <div className="border-t border-ds-border-muted/70 px-4 py-3.5">
          {detail.error?.trim() ? (
            <pre className="whitespace-pre-wrap break-words rounded-[10px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 font-mono text-[12px] leading-5 text-ds-danger dark:border-red-800/40 dark:bg-red-500/10">
              {detail.error}
            </pre>
          ) : detail.summary?.trim() ? (
            <p className="whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">{detail.summary}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {detail.profile ? <MetaChip title={detail.profile}>{detail.profile}</MetaChip> : null}
            {typeof detail.totalTokens === 'number' && detail.totalTokens > 0 ? (
              <MetaChip>{t('subagentTokensChip', { count: detail.totalTokens })}</MetaChip>
            ) : null}
            {detail.toolPolicy ? (
              <MetaChip>
                {detail.toolPolicy === 'readOnly' ? t('subagentPolicyReadOnly') : t('subagentPolicyFull')}
              </MetaChip>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function pillText(status: CardStatus, t: (k: string) => string): string {
  switch (status) {
    case 'queued':
      return t('subagentStatusQueued')
    case 'running':
      return t('subagentStatusRunning')
    case 'done':
      return t('subagentStatusDone')
    case 'failed':
      return t('subagentStatusFailed')
    case 'awaiting-permission':
      return t('subagentStatusAwaiting')
    default:
      return ''
  }
}

/** Best-effort task one-liner from a generic delegate_task summary string. */
function splitTaskLine(block: ToolBlock): string | undefined {
  const raw = block.summary?.trim()
  if (!raw) return undefined
  const stripped = raw.replace(/^delegate_task\s*:\s*/i, '').trim()
  if (!stripped || stripped.length > 160) return undefined
  // Bare tool name (no task text yet, e.g. while running) — nothing useful.
  if (/^delegate_task$/i.test(stripped)) return undefined
  return stripped
}

/**
 * Coalesces sibling {@link SubagentCallCard}s of one turn. Renders a single
 * full card for N=1 (no header); for N>=2 wraps them under a {@link SwarmHeader}
 * with a stacked-avatar cluster and an aggregate count line.
 */
export function SubagentGroup({ blocks }: { blocks: ChatBlock[] }): ReactElement | null {
  const { t } = useTranslation('common')
  const [collapsed, setCollapsed] = useState(false)
  const reducedMotion = useReducedMotion()

  if (blocks.length === 0) return null
  // N=1: single full card, no swarm header.
  if (blocks.length === 1) {
    return <SubagentCallCard block={blocks[0]} />
  }

  const sorted = [...blocks].sort((a, b) => {
    const sa = readChildMeta(a).childSeq ?? 0
    const sb = readChildMeta(b).childSeq ?? 0
    return sa - sb
  })

  let running = 0
  let queued = 0
  let done = 0
  for (const b of sorted) {
    const s = resolveStatus(b, readChildMeta(b))
    if (s === 'running' || s === 'awaiting-permission') running += 1
    else if (s === 'queued') queued += 1
    else if (s === 'done') done += 1
  }
  const anyRunning = running > 0 || queued > 0

  const clusterPoses = sorted.slice(0, 5).map((b) => {
    const c = readChildMeta(b)
    const d = parseDelegateDetail(b.kind === 'tool' ? (b as ToolBlock).detail : undefined)
    return c.childProfile || d.profile || c.childLabel || c.childId || 'custom'
  })
  const overflow = sorted.length - clusterPoses.length

  const summaryParts: string[] = []
  if (running > 0) summaryParts.push(t('subagentSwarmRunning', { count: running }))
  if (queued > 0) summaryParts.push(t('subagentSwarmQueued', { count: queued }))
  if (done > 0) summaryParts.push(t('subagentSwarmDone', { count: done }))

  return (
    <section className="ds-subagent-mount overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/80 shadow-[0_16px_40px_rgba(86,103,136,0.08)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 border-b border-ds-border-muted bg-gradient-to-b from-ds-card to-ds-card-muted/40 px-4 py-3 text-left transition hover:bg-ds-hover/30"
      >
        {anyRunning && !reducedMotion ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={2.2} />
        ) : anyRunning ? (
          <Hourglass className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
        ) : (
          <Check className="h-4 w-4 shrink-0 text-ds-success" strokeWidth={2.4} />
        )}
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ds-heading">
          {t('subagentSwarmTitle', { count: sorted.length })}
          {summaryParts.length > 0 ? (
            <span className="font-normal text-ds-muted"> · {summaryParts.join(' · ')}</span>
          ) : null}
        </span>
        <span className="flex shrink-0">
          {clusterPoses.map((pose, i) => (
            <span
              key={`${pose}-${i}`}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ds-card"
              style={{
                marginLeft: i === 0 ? 0 : -8,
                background: 'radial-gradient(circle at 50% 36%,#fff,#eef4fb)'
              }}
            >
              <AgentKun id={pose} className="h-5 w-5" />
            </span>
          ))}
          {overflow > 0 ? (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ds-card bg-ds-card-muted text-[9px] font-semibold text-ds-muted"
              style={{ marginLeft: -8 }}
            >
              +{overflow}
            </span>
          ) : null}
        </span>
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>
      {!collapsed ? (
        <div>
          {sorted.map((b) => (
            <SubagentCallCard key={b.id} block={b} compact inGroup />
          ))}
        </div>
      ) : null}
    </section>
  )
}
