import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Eye, Hourglass, Loader2, RotateCcw } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { BUILTIN_AGENT_CATALOG_BY_ID } from '../../../../../kun/src/delegation/builtin-agent-catalog'
import { AgentKun } from '../subagents/AgentKun'
import {
  SubagentLiveAvatar as AvatarDisc,
  SubagentLivenessLane as LaneHairline,
  useSubagentElapsed,
  useSubagentReducedMotion
} from '../subagents/SubagentLiveness'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ExplorePeekPopover } from './ExplorePeekPopover'
import { FastContextEvidenceDetail, FastContextEvidencePill } from './FastContextEvidenceDetail'
import {
  firstUsefulLine,
  isBareSubagentToolName,
  isFastContextToolBlock,
  resolveFastContextTaskTitle
} from './fast-context-card-copy'
import {
  formatChildActivityLabel,
  readChildActivityFromBlock
} from './explore-peek-summary'
import {
  AgentModelMetadata,
  BackgroundPill,
  ExploreKindBadge,
  GeneratedPill,
  KNOWN_POSE_IDS,
  MetaChip,
  ProactiveRetryBadge,
  StatusPill,
  hashHue,
  isTerminal,
  parseDelegateDetail,
  parseExploreBatchChildren,
  parseFastContextEvidencePack,
  readChildMeta,
  resolveStatus,
  subagentStatusText,
  subagentResumeRequestId,
  useOnScreen,
  type OpenChildThreadHandler
} from './subagent-call-card-support'
import { SubagentStopControl } from './SubagentStopControl'

export { parseDelegateDetail } from './subagent-call-card-support'
export type { OpenChildThreadHandler } from './subagent-call-card-support'

const SUBAGENT_RESUME_PROMPT = [
  'Continue the interrupted delegated task in the existing child session.',
  'Review its history and current workspace state, avoid repeating completed work,',
  'and finish the original delegated task or report a concrete blocker.'
].join(' ')

export function SubagentCallCard({
  block,
  compact = false,
  inGroup = false,
  tickNow,
  onOpenChildThread
}: {
  block: ChatBlock
  /** Smaller avatar variant used inside a swarm group. */
  compact?: boolean
  /** Inside a SwarmHeader group: suppress own shell, inline-toggle only. */
  inGroup?: boolean
  /** Parent group clock used to keep all child timers moving in lockstep. */
  tickNow?: number
  onOpenChildThread?: OpenChildThreadHandler
}): ReactElement | null {
  const { t } = useTranslation('common')
  const selectThread = useChatStore((s) => s.selectThread)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const parentBusy = useChatStore((s) => s.busy)
  const reducedMotion = useSubagentReducedMotion()
  const ref = useRef<HTMLElement | null>(null)
  const onScreen = useOnScreen(ref)

  const child = readChildMeta(block)
  const detail = useMemo(
    () => parseDelegateDetail(block.kind === 'tool' ? (block as ToolBlock).detail : undefined),
    [block]
  )
  const evidencePack = useMemo(
    () => parseFastContextEvidencePack(block.kind === 'tool' ? (block as ToolBlock).detail : undefined),
    [block]
  )
  const activity = useMemo(() => readChildActivityFromBlock(block), [block])
  const status = resolveStatus(block, child, detail)
  const detached = child.detached === true || detail.detached === true
  const resultRef = child.resultRef ?? detail.resultRef
  const resultExternalized = Boolean(resultRef)
  const resultUnavailableReason = child.resultUnavailableReason ?? detail.resultUnavailableReason
  const generated = detail.generated === true || (child.childProfile?.startsWith('generated:') ?? false)
  const animate = !reducedMotion && onScreen && status === 'running'
  const launcher = child.childLauncher || detail.launcher
  const isFastContext = launcher === 'fast_context' || (launcher as string | undefined) === 'explore_agent' || (
    block.kind === 'tool' && isFastContextToolBlock(block as ToolBlock)
  )

  // Profile id: prefer the live `childProfile` from the runtime metadata (set on
  // the first queued/running event) so the agent type shows immediately; the
  // result-JSON `profile` only arrives after the child completes.
  const profileId = child.childProfile || detail.profile || (isFastContext ? 'explore' : undefined)
  // Pose key: profile → childLabel → block toolName → 'custom'.
  const poseId = profileId || (isFastContext ? 'explore' : undefined) || child.childLabel || child.childId || 'custom'
  const isKnownPose = KNOWN_POSE_IDS.has(poseId)
  const hue = isKnownPose ? null : hashHue(poseId)

  // Keep the task label and the selected agent identity separate. The runtime
  // snapshot is authoritative for custom/generated roles; built-ins may use a
  // localized catalog label without consulting mutable profile settings.
  const taskText = block.kind === 'tool' ? splitTaskLine(block as ToolBlock) : undefined
  const exploreCatalog = BUILTIN_AGENT_CATALOG_BY_ID.explore
  const recordedAgentName = child.childProfileName || detail.profileName || detail.generatedAgentName
  const localizedBuiltinName =
    profileId && BUILTIN_AGENT_CATALOG_BY_ID[profileId]
      ? t(`subagentsPanel.role.${profileId}.name`, BUILTIN_AGENT_CATALOG_BY_ID[profileId]!.name)
      : undefined
  const fastContextName = t(
    'subagentsPanel.role.explore.name',
    exploreCatalog?.name ?? 'Repository Explorer'
  )
  const agentName = isFastContext
    ? (localizedBuiltinName || recordedAgentName || fastContextName)
    : (
      localizedBuiltinName ||
      recordedAgentName ||
      (profileId && KNOWN_POSE_IDS.has(profileId)
        ? t(`subagentsPanel.role.${profileId}.name`, profileId)
        : undefined) ||
      profileId?.trim() ||
      t('subagentNotRecorded', { defaultValue: 'Not recorded' })
    )
  const agentIdentity = isFastContext
    ? agentName
    : (profileId && agentName !== profileId ? `${agentName} (${profileId})` : agentName)
  const model = (child.childModel || detail.model || '').trim() || undefined
  const taskTitle = isFastContext
    ? resolveFastContextTaskTitle({
      childLabel: child.childLabel,
      title: detail.title,
      query: detail.query,
      summary: detail.summary,
      blockSummary: block.kind === 'tool' ? (block as ToolBlock).summary : undefined,
      fallback: t('exploreTaskDefaultTitle', { defaultValue: 'Explore task' })
    })
    : (
      firstUsefulLine(child.childLabel) ||
      firstUsefulLine(detail.title) ||
      firstUsefulLine(taskText, 48) ||
      (isBareSubagentToolName(agentName) ? t('subagentDefaultName') : agentName) ||
      t('subagentDefaultName')
    )
  const activityLine = !isTerminal(status) ? formatChildActivityLabel(activity) : undefined
  const steps = child.toolInvocations ?? detail.toolInvocations
  const childId = child.childId || detail.childId
  // Short subtitle only — keep CTA on the explicit process button, not in truncated text.
  const taskLine = activityLine || (
    isFastContext && isTerminal(status)
      ? (firstUsefulLine(detail.summary, 96) || firstUsefulLine(detail.query, 96) || undefined)
      : (
        detail.summary?.trim() ||
        detail.query?.trim() ||
        (taskText?.trim() !== taskTitle ? taskText?.trim() : '') ||
        undefined
      )
  )

  const elapsed = useSubagentElapsed(
    status,
    child.attemptStartedAt ?? detail.attemptStartedAt ?? block.createdAt,
    child.attemptDurationMs ?? detail.attemptDurationMs ?? child.durationMs ?? detail.durationMs,
    tickNow
  )

  const hasBody = Boolean(detail.summary?.trim() || detail.error?.trim() || evidencePack)
  const [conclusionExpanded, setConclusionExpanded] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)
  const [resuming, setResuming] = useState(false)
  const resumeObservedBusy = useRef(false)
  const expanded = hasBody && !peekOpen && conclusionExpanded
  const resumeCount = child.resumeCount ?? detail.resumeCount ?? 0
  const proactiveRetry = child.proactiveRetry ?? detail.proactiveRetry
  const attemptParentTurnId = child.parentTurnId || detail.parentTurnId
  const canResume = Boolean(
    childId &&
    (status === 'failed' || status === 'stopped') &&
    (child.resumable ?? detail.resumable) === true &&
    (!attemptParentTurnId || !block.turnId || attemptParentTurnId === block.turnId)
  )

  useEffect(() => {
    if (!canResume) setResuming(false)
  }, [canResume])
  useEffect(() => {
    if (!resuming) {
      resumeObservedBusy.current = false
      return
    }
    if (parentBusy) {
      resumeObservedBusy.current = true
    } else if (resumeObservedBusy.current) {
      resumeObservedBusy.current = false
      setResuming(false)
    }
  }, [parentBusy, resuming])

  const canJump = Boolean(childId)
  const openChild = (): void => {
    if (!childId) return
    setPeekOpen(false)
    if (onOpenChildThread) {
      onOpenChildThread(childId)
      return
    }
    void selectThread(childId).catch(() => undefined)
  }
  const toggleConclusion = (): void => {
    if (!hasBody) return
    setConclusionExpanded((value) => !value)
  }
  const resumeChild = async (): Promise<void> => {
    if (!canResume || !childId || resuming || parentBusy || !sendMessage) return
    setResuming(true)
    const accepted = await sendMessage(SUBAGENT_RESUME_PROMPT, 'agent', {
      clientRequestId: subagentResumeRequestId(childId, resumeCount),
      ...(child.parentThreadId || detail.parentThreadId
        ? { expectedThreadId: child.parentThreadId || detail.parentThreadId }
        : {}),
      displayText: t('subagentResumeDisplayText', { defaultValue: 'Continue interrupted subagent' }),
      orchestration: 'direct',
      subagentResume: { childId, expectedResumeCount: resumeCount }
    }).catch(() => false)
    if (!accepted) setResuming(false)
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
      aria-label={`${taskTitle} · ${agentIdentity}${model ? ` · ${model}` : ''} · ${subagentStatusText(status, t)}`}
      data-testid="subagent-call-card"
      data-explore={isFastContext ? 'true' : 'false'}
      data-activity-label={activityLine ?? ''}
      data-conclusion-expanded={expanded ? 'true' : 'false'}
    >
      <div
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        onClick={() => {
          if (hasBody) toggleConclusion()
        }}
        onKeyDown={(e) => {
          if (!hasBody) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleConclusion()
          }
        }}
        className={`flex items-center gap-3 px-4 ${compact ? 'py-2.5' : 'py-3'} text-left ${
          hasBody ? 'cursor-pointer transition hover:bg-ds-hover/30' : ''
        }`}
      >
        <span className="ds-subagent-focus-decoration contents">
          <AvatarDisc poseId={poseId} status={status} hue={hue} compact={compact} animate={animate} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {isFastContext ? <ExploreKindBadge t={t} /> : null}
            {isFastContext ? <FastContextEvidencePill pack={evidencePack} status={status} t={t} /> : null}
            <span className="truncate text-[14px] font-semibold text-ds-ink" title={taskTitle}>{taskTitle}</span>
            {generated ? <GeneratedPill t={t} /> : null}
            {detached ? <BackgroundPill t={t} /> : null}
            {proactiveRetry && proactiveRetry.count > 0
              ? <ProactiveRetryBadge retry={proactiveRetry} t={t} />
              : null}
            {resultExternalized ? (
              <span
                className="whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-[2px] text-[10.5px] font-semibold text-amber-700 dark:text-amber-300"
                title={resultRef?.artifactId}
                data-testid="subagent-result-externalized"
              >
                {t('subagentResultExternalized', { defaultValue: 'Externalized' })}
              </span>
            ) : null}
            {!compact || !inGroup ? <StatusPill status={status} t={t} /> : null}
          </div>
          <AgentModelMetadata
            agentIdentity={agentIdentity}
            profileId={profileId}
            model={model}
            compact={compact}
            t={t}
          />
          {taskLine && !expanded ? (
            <span
              className={`mt-0.5 block truncate text-[12.5px] ${
                activityLine ? 'text-accent' : 'text-ds-muted'
              }`}
              title={taskLine}
              data-testid="subagent-activity-line"
            >
              {taskLine}
            </span>
          ) : null}
          {hasBody && !expanded ? (
            <span className="mt-0.5 block text-[11.5px] font-semibold text-accent">
              {t('exploreExpandConclusion', { defaultValue: 'Show conclusion' })}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-[13px] font-semibold text-ds-ink">{elapsed}</span>
          <span className="mt-px block text-[10.5px] text-ds-faint">
            {typeof steps === 'number'
              ? t('subagentSteps', { count: steps })
                : status === 'queued' && typeof (child.queuedMs ?? detail.queuedMs) === 'number'
                  ? t('subagentQueuedHint')
                  : ''}
          </span>
        </span>
        {canResume ? (
          <button
            type="button"
            disabled={resuming || parentBusy}
            onClick={(e) => {
              e.stopPropagation()
              void resumeChild()
            }}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
            aria-label={t('subagentResumeAction', { defaultValue: 'Continue subagent' })}
            title={t('subagentResumeAction', { defaultValue: 'Continue subagent' })}
            data-testid="subagent-resume-button"
          >
            {resuming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            <span>{t('subagentResumeShort', { defaultValue: 'Continue' })}</span>
          </button>
        ) : null}
        <SubagentStopControl
          childId={childId}
          active={status === 'queued' || status === 'running' || status === 'awaiting-permission'}
          t={t}
        />
        {childId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setPeekOpen((value) => !value)
            }}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('explorePeekPreview', { defaultValue: 'Preview' })}
            title={t('explorePeekPreview', { defaultValue: 'Preview' })}
            data-testid="explore-peek-button"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="hidden sm:inline">{t('explorePeekPreview', { defaultValue: 'Preview' })}</span>
          </button>
        ) : null}
        {childId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openChild()
            }}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11px] font-semibold text-accent transition hover:bg-accent/15"
            aria-label={
              isFastContext
                ? t('exploreViewProcess', { defaultValue: 'View explore process' })
                : t('subagentOpenSession')
            }
            title={
              isFastContext
                ? t('exploreViewProcess', { defaultValue: 'View explore process' })
                : t('subagentOpenSession')
            }
            data-testid="explore-open-process-button"
          >
            {isFastContext
              ? t('exploreViewProcessShort', { defaultValue: 'Open' })
              : t('subagentOpenSessionShort', { defaultValue: 'Open' })}
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
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
        <div
          className="border-t border-ds-border-muted/70 px-4 py-3.5"
          data-testid="subagent-conclusion-body"
        >
          {detail.error?.trim() ? (
            <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-red-200/80 bg-red-50/80 px-3 py-2.5 font-mono text-[12px] leading-5 text-ds-danger dark:border-red-800/40 dark:bg-red-500/10">
              {detail.error}
            </pre>
          ) : detail.summary?.trim() ? (
            isFastContext ? (
              <div className="max-h-[360px] overflow-y-auto text-[14px] leading-6 text-ds-ink">
                <AssistantMarkdown
                  text={detail.summary}
                  streaming={false}
                  className="ds-markdown text-[14px] leading-6 text-ds-ink"
                />
              </div>
            ) : (
              <p className="max-h-[320px] overflow-y-auto whitespace-pre-wrap text-[14px] leading-6 text-ds-muted">
                {detail.summary}
              </p>
            )
          ) : null}
          <FastContextEvidenceDetail pack={evidencePack} t={t} />

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {detail.profile ? <MetaChip title={detail.profile}>{detail.profile}</MetaChip> : null}
            {typeof (child.totalTokens ?? detail.totalTokens) === 'number' && (child.totalTokens ?? detail.totalTokens ?? 0) > 0 ? (
              <MetaChip>{t('subagentTokensChip', { count: child.totalTokens ?? detail.totalTokens })}</MetaChip>
            ) : null}
            {detail.toolPolicy ? (
              <MetaChip>
                {detail.toolPolicy === 'readOnly' ? t('subagentPolicyReadOnly') : t('subagentPolicyFull')}
              </MetaChip>
            ) : null}
            {proactiveRetry
              ? <ProactiveRetryBadge retry={proactiveRetry} t={t} remaining />
              : null}
            {resultRef ? (
              <MetaChip title={resultRef.artifactId}>
                {t('subagentResultSize', {
                  defaultValue: '{{lines}} lines · {{bytes}} bytes',
                  lines: resultRef.lineCount,
                  bytes: resultRef.byteSize
                })}
              </MetaChip>
            ) : null}
            {resultUnavailableReason ? (
              <MetaChip title={resultUnavailableReason}>
                {t('subagentResultUnavailable', { defaultValue: 'Full result unavailable' })}
              </MetaChip>
            ) : null}
          </div>
        </div>
      ) : null}

      {childId ? (
        <ExplorePeekPopover
          open={peekOpen}
          anchorEl={ref.current}
          childId={childId}
          title={taskTitle}
          elapsedLabel={elapsed}
          statusLabel={subagentStatusText(status, t)}
          activity={activity}
          summary={detail.summary}
          onClose={() => setPeekOpen(false)}
          onOpenChildThread={(threadId) => {
            setPeekOpen(false)
            if (onOpenChildThread) {
              onOpenChildThread(threadId)
              return
            }
            void selectThread(threadId).catch(() => undefined)
          }}
        />
      ) : null}
    </section>
  )
}

/** Best-effort task one-liner from a generic delegate/explore summary string. */
function splitTaskLine(block: ToolBlock): string | undefined {
  const detail = parseDelegateDetail(block.detail)
  if (detail.title?.trim()) return detail.title.trim()
  const raw = block.summary?.trim()
  if (!raw) return undefined
  const stripped = raw
    .replace(/^(delegate_task|fast_context|explore_agent|generate_subagent)\s*:\s*/i, '')
    .trim()
  if (!stripped || stripped.length > 160) return undefined
  // Bare tool name (no task text yet, e.g. while running) — nothing useful.
  if (/^(delegate_task|fast_context|explore_agent|generate_subagent)$/i.test(stripped)) return undefined
  return stripped
}

/**
 * Coalesces sibling {@link SubagentCallCard}s of one turn. Renders a single
 * full card for N=1 (no header); for N>=2 wraps them under a {@link SwarmHeader}
 * with a stacked-avatar cluster and an aggregate count line.
 */
export function SubagentGroup({
  blocks,
  onOpenChildThread
}: {
  blocks: ChatBlock[]
  onOpenChildThread?: OpenChildThreadHandler
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [collapsed, setCollapsed] = useState(false)
  const reducedMotion = useSubagentReducedMotion()
  const [tickNow, setTickNow] = useState(() => Date.now())

  const expandedBlocks = blocks.flatMap(expandExploreBatchBlock)
  const sorted = [...expandedBlocks].sort((a, b) => {
    const sa = readChildMeta(a).childSeq ?? 0
    const sb = readChildMeta(b).childSeq ?? 0
    return sa - sb
  })

  let running = 0
  let queued = 0
  let done = 0
  for (const b of sorted) {
    const detail = parseDelegateDetail(b.kind === 'tool' ? (b as ToolBlock).detail : undefined)
    const s = resolveStatus(b, readChildMeta(b), detail)
    if (s === 'running' || s === 'awaiting-permission') running += 1
    else if (s === 'queued') queued += 1
    else if (s === 'done') done += 1
  }
  const anyRunning = running > 0 || queued > 0
  useEffect(() => {
    if (!anyRunning) return
    setTickNow(Date.now())
    const id = globalThis.setInterval(() => setTickNow(Date.now()), 1000)
    return () => globalThis.clearInterval(id)
  }, [anyRunning])

  if (sorted.length === 0) return null

  const allExplore = sorted.every(
    (b) => b.kind === 'tool' && isFastContextToolBlock(b as ToolBlock)
  )

  // N=1, or an all-explore cluster: full independent cards (no swarm shell).
  if (sorted.length === 1 || allExplore) {
    if (sorted.length === 1) {
      return <SubagentCallCard block={sorted[0]} tickNow={tickNow} onOpenChildThread={onOpenChildThread} />
    }
    return (
      <div className="flex flex-col gap-2" data-testid="explore-independent-stack">
        {sorted.map((b) => (
          <SubagentCallCard
            key={b.id}
            block={b}
            tickNow={tickNow}
            onOpenChildThread={onOpenChildThread}
          />
        ))}
      </div>
    )
  }

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
        <span className="ds-subagent-focus-decoration flex shrink-0">
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
            <SubagentCallCard
              key={b.id}
              block={b}
              compact
              inGroup
              tickNow={tickNow}
              onOpenChildThread={onOpenChildThread}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
function expandExploreBatchBlock(block: ChatBlock): ChatBlock[] {
  if (block.kind !== 'tool' || !isFastContextToolBlock(block as ToolBlock)) return [block]
  const tool = block as ToolBlock
  const children = parseExploreBatchChildren(tool.detail)
  if (children.length === 0) return [block]
  return children.map((child) => ({
    ...tool,
    id: `${tool.id}:explore:${child.index}`,
    summary: child.title,
    status: child.status === 'completed'
      ? 'success'
      : child.status === 'failed' || child.status === 'aborted'
        ? 'error'
        : 'running',
    detail: JSON.stringify({
      ...child,
      ...(typeof child.totalTokens === 'number'
        ? { usage: { totalTokens: child.totalTokens } }
        : {})
    }),
    meta: {
      ...tool.meta,
      toolName: 'fast_context',
      child: {
        childId: child.childId,
        childLabel: child.title,
        childProfile: 'explore',
        childProfileName: child.profileName,
        childModel: child.model,
        childStatus: child.status,
        childSeq: child.index,
        parentTurnId: tool.turnId,
        toolInvocations: child.toolInvocations,
        attemptStartedAt: child.attemptStartedAt,
        attemptDurationMs: child.attemptDurationMs,
        durationMs: child.durationMs,
        totalTokens: child.totalTokens
      }
    }
  }))
}
