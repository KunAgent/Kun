import { memo, useMemo, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeChildActivity, ToolBlock } from '../../agent/types'
import { formatChildActivityLabel } from './explore-peek-summary'
import { useChatStore } from '../../store/chat-store'
import { deriveTurnSections, groupTurnProcessTimeline } from './derive-turn-sections'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { GeneratedDocumentFilesPanel } from './GeneratedDocumentFilesPanel'
import {
  generatedDocumentArtifactsForTurn,
  type GeneratedDocumentArtifact,
  type GeneratedDocumentCollection
} from './generated-document-artifacts'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import {
  ProcessSectionRow,
  groupProcessSections,
  summarizeToolBlock
} from './message-timeline-process'
import { ComponentPrototypeCard } from './ComponentPrototypeCard'
import { DiagramPrototypeCard } from './DiagramPrototypeCard'
import { ConversationVisualizationCard } from './ConversationVisualizationCard'
import { ChartRenderer } from './ChartRenderer'
import type { OpenChildThreadHandler } from './SubagentCallCard'
import {
  AnimatedWorkLogo,
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useIkunWorkLogoVariant,
  useWorkLogoSwimMode,
  type IkunWorkLogoVariant,
  type WorkLogoSwimMode
} from './AnimatedWorkLogo'
import type { UiPluginLabelKey } from '@shared/ui-plugin'
import { useUiPluginWorkLabel } from '../../store/ui-plugin-store'
import { sameTurnContent, splitThink, type Turn } from './message-timeline-turns'
import { extractPlanMetadataFromBlock, type GuiPlanToolMeta } from '../../plan/plan-tool'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import { TimelineRuntimeError, liveTurnProgressClass } from './message-timeline-jump-preview'
import type { TurnUsageSummary } from '../../hooks/use-turn-usage'
import { TurnUsageRow } from './TurnUsageRow'
import { hasLivePendingUserInput } from '../../store/chat-store-runtime-helpers'
import { CircleHelp } from 'lucide-react'
import { formatDuration } from './message-timeline-tools'
import {
  parseDelegateDetail,
  readChildMeta,
  resolveStatus
} from './subagent-call-card-support'

export type ConversationTurnProps = {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  durationMs?: number
  reasoningDurationMs?: number
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  graphEnabled?: boolean
  onBuildPlan?: (orchestration: PlanBuildOrchestration, meta?: GuiPlanToolMeta) => void
  onOpenPlan?: (meta?: GuiPlanToolMeta) => void
  onOpenChanges?: () => void
  onReviewChanges?: () => void
  reviewChangesDisabled?: boolean
  threadId?: string
  onPreviewGeneratedDocument?: (
    file: GeneratedDocumentArtifact,
    workspaceRoot: string
  ) => void
  onOpenGeneratedDocuments?: (collection: GeneratedDocumentCollection) => void
  onOpenChildThread?: OpenChildThreadHandler
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
  onComponentPrototypePrompt?: (prompt: string) => void
  filePreviewWorkspaceRoot: string
  viewportRef: RefObject<HTMLDivElement | null>
  compactCards?: boolean
  /** Main-thread actions must stay disabled for isolated side conversations. */
  allowMainThreadActions?: boolean
  /** Recovery fallback is available only while the whole thread is idle. */
  allowRecoveryContinue?: boolean
  turnUsage?: TurnUsageSummary
  turnUsageStale?: boolean
}

export function ConversationTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  durationMs,
  reasoningDurationMs,
  devPreviewCard,
  planActionsBusy,
  graphEnabled = false,
  onBuildPlan,
  onOpenPlan,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  threadId,
  onPreviewGeneratedDocument,
  onOpenGeneratedDocuments,
  onOpenChildThread,
  onCancelToolCall,
  onComponentPrototypePrompt,
  filePreviewWorkspaceRoot,
  viewportRef,
  compactCards = false,
  allowMainThreadActions = true,
  allowRecoveryContinue = true,
  turnUsage,
  turnUsageStale = false
}: ConversationTurnProps): ReactElement {
  const { t } = useTranslation('common')
  const forkThreadFromTurn = useChatStore((s) => s.forkThreadFromTurn)
  const rollbackWorkspaceToCheckpoint = useChatStore((s) => s.rollbackWorkspaceToCheckpoint)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const archiveActiveThreadToTurn = useChatStore((s) => s.archiveActiveThreadToTurn)
  const [forking, setForking] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [rollingBackCheckpointId, setRollingBackCheckpointId] = useState<string | null>(null)
  // Inline Review Plan card: surfaced under a turn that produced a
  // successful `create_plan` result so the user can open/build the plan
  // without leaving the conversation.
  const planResult = useMemo(() => {
    if (isProcessing) return null
    for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
      const block = turn.blocks[index]
      if (block.kind !== 'tool' || block.status !== 'success') continue
      const meta = extractPlanMetadataFromBlock(block)
      if (meta) return meta
    }
    return null
  }, [turn.blocks, isProcessing])
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const [workExpandedOverride, setWorkExpandedOverride] = useState<boolean | null>(null)

  const {
    processBlocks,
    processTimelineBlocks,
    assistantContentBlocks,
    runtimeErrorBlocks,
    runtimeErrorsBeforeFinalContent,
    runtimeErrorsAfterFinalContent,
    componentPrototypeBlocks,
    diagramPrototypeBlocks,
    conversationVisualizationBlocks,
    generatedFileBlocks,
    turnFileChanges,
    chartBlocks
  } = useMemo(
    () =>
      deriveTurnSections({
        turn,
        isProcessing,
        liveProcessText,
        liveContent,
        workspaceRoot: filePreviewWorkspaceRoot
      }),
    [turn, isProcessing, liveProcessText, liveContent, filePreviewWorkspaceRoot]
  )
  const generatedDocuments = useMemo(
    () => generatedDocumentArtifactsForTurn(
      turn.blocks,
      filePreviewWorkspaceRoot,
      isProcessing,
      typeof window === 'undefined' ? '' : window.kunGui?.platform ?? ''
    ),
    [turn.blocks, filePreviewWorkspaceRoot, isProcessing]
  )
  const generatedDocumentTurnId = (
    turn.turnId ||
    turn.user?.turnId ||
    turn.user?.meta?.turnId ||
    turn.user?.id ||
    turn.blocks.find((block) => block.turnId)?.turnId ||
    ''
  ).trim()
  const workProcessBlocks = processBlocks
  const workExpanded = workExpandedOverride ?? false
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )

  const processTimelineEntries = useMemo(
    () => isProcessing
      ? groupTurnProcessTimeline(processTimelineBlocks)
      : workExpanded
        ? groupProcessSections(workProcessBlocks).map((section) => ({
            kind: 'process' as const,
            section
          }))
        : [],
    [isProcessing, processTimelineBlocks, workProcessBlocks, workExpanded]
  )
  const reasoningSectionCount = useMemo(
    () => processTimelineEntries.filter(
      (entry) => entry.kind === 'process' && entry.section.kind === 'reasoning'
    ).length,
    [processTimelineEntries]
  )
  const forkTurnId =
    turn.user?.turnId?.trim() ||
    [...assistantContentBlocks].reverse().find((block) => block.turnId?.trim())?.turnId?.trim() ||
    ''
  const forkActionBlockId =
    allowMainThreadActions && !isProcessing && forkTurnId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined
  const rollbackCheckpointId = turn.user?.meta?.workspaceCheckpointId?.trim() ?? ''
  const rollbackActionBlockId =
    allowMainThreadActions && !isProcessing && rollbackCheckpointId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined

  // During a live turn, assistant text, reasoning, and tools share one ordered
  // process timeline. Once complete, that timeline folds by default and only
  // the final assistant text remains outside it.

  const hasProcess =
    isProcessing ||
    workProcessBlocks.length > 0 ||
    (runtimeErrorBlocks.length > 0 && typeof durationMs === 'number')
  const liveToolBlock = useMemo(
    () => [...workProcessBlocks].reverse().find(
      (block): block is Extract<ChatBlock, { kind: 'tool' }> =>
        block.kind === 'tool' && block.status === 'running'
    ) ?? [...workProcessBlocks].reverse().find(
      (block): block is Extract<ChatBlock, { kind: 'tool' }> =>
        block.kind === 'tool'
    ),
    [workProcessBlocks]
  )
  const liveChildActivityLabel = useMemo(() => {
    if (!liveToolBlock) return undefined
    const child = liveToolBlock.meta?.child
    if (!child || typeof child !== 'object' || Array.isArray(child)) return undefined
    const activity = (child as {
      activity?: { phase?: RuntimeChildActivity['phase']; label?: string; toolName?: string; startedAt?: string; updatedAt?: string }
    }).activity
    if (!activity?.label?.trim()) return undefined
    return formatChildActivityLabel({
      phase: activity.phase ?? 'tool',
      label: activity.label.trim(),
      ...(activity.toolName?.trim() ? { toolName: activity.toolName.trim() } : {}),
      startedAt: activity.startedAt ?? '',
      updatedAt: activity.updatedAt ?? ''
    })
  }, [liveToolBlock])
  // A live user_input gate means the turn is parked waiting for the user, not
  // computing. Surface that instead of the generic "thinking" label.
  const awaitingUserInput = isProcessing && hasLivePendingUserInput(turn.blocks)
  const hasDedicatedLiveOwner = isProcessing && (
    awaitingUserInput ||
    workProcessBlocks.some((block) =>
      subagentBlockOwnsLiveStatus(block) ||
      (block.kind === 'approval' && block.status === 'pending') ||
      (block.kind === 'approval_review' && block.status === 'in-progress') ||
      (block.kind === 'user_input' && block.status === 'pending' && block.live === true)
    )
  )
  const showLiveProgress = isProcessing && !hasDedicatedLiveOwner
  const showWorkMeta = hasProcess && !isProcessing
  const showLiveThinking = Boolean(liveProcessText.trim()) && !liveChildActivityLabel && !liveToolBlock
  const hasSettledResultEvidence = !isProcessing && Boolean(
    assistantContentBlocks.length > 0 ||
    generatedFileBlocks.length > 0 ||
    generatedDocuments.length > 0 ||
    reviewBlocks.length > 0 ||
    planResult ||
    turnFileChanges.length > 0 ||
    componentPrototypeBlocks.length > 0 ||
    diagramPrototypeBlocks.length > 0 ||
    conversationVisualizationBlocks.length > 0 ||
    chartBlocks.length > 0 ||
    Boolean(devPreviewCard)
  )
  const forkFromTurn = async (): Promise<void> => {
    if (!allowMainThreadActions || !forkTurnId || forking) return
    setForking(true)
    try {
      await forkThreadFromTurn(forkTurnId)
    } finally {
      setForking(false)
    }
  }
  const archiveToTurn = async (): Promise<void> => {
    if (!allowMainThreadActions || !forkTurnId || archiving || isProcessing) return
    if (!window.confirm(t('archiveHistoryConfirm'))) return
    setArchiving(true)
    try {
      await archiveActiveThreadToTurn(forkTurnId)
    } finally {
      setArchiving(false)
    }
  }
  const rollbackWorkspace = async (checkpointId: string): Promise<void> => {
    const targetCheckpointId = checkpointId.trim()
    if (!allowMainThreadActions || !targetCheckpointId || rollingBackCheckpointId) return
    setRollingBackCheckpointId(targetCheckpointId)
    try {
      await rollbackWorkspaceToCheckpoint(targetCheckpointId)
    } finally {
      setRollingBackCheckpointId(null)
    }
  }

  return (
    <div className={`flex min-w-0 flex-col ${compactCards ? 'gap-2.5' : 'gap-4'}`}>
      {turn.user ? (
        <MessageBubble block={turn.user} allowThreadActions={allowMainThreadActions} />
      ) : null}

      {showWorkMeta || processTimelineEntries.length > 0 ? (
        <div className="flex flex-col gap-1 pb-2">
          {showWorkMeta ? (
            <WorkMetaRow
              processing={false}
              durationMs={durationMs}
              expanded={workExpanded}
              collapsible={workProcessBlocks.length > 0}
              onToggle={() => setWorkExpandedOverride((value) => !(value ?? false))}
            />
          ) : null}
          {processTimelineEntries.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processTimelineEntries.map((entry) => entry.kind === 'runtime_error' ? (
                <TimelineRuntimeError key={entry.block.id} block={entry.block} />
              ) : (
                <ProcessSectionRow
                  key={entry.section.id}
                  section={entry.section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  workspaceRoot={filePreviewWorkspaceRoot}
                  viewportRef={viewportRef}
                  onOpenChildThread={onOpenChildThread}
                  onCancelToolCall={onCancelToolCall}
                  allowThreadActions={allowMainThreadActions}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {runtimeErrorsBeforeFinalContent.map((block) => (
        <TimelineRuntimeError key={block.id} block={block} />
      ))}

      {componentPrototypeBlocks.map((block) => (
        <ComponentPrototypeCard
          key={block.id}
          block={block}
          workspaceRoot={filePreviewWorkspaceRoot}
          onPrompt={onComponentPrototypePrompt}
        />
      ))}

      {diagramPrototypeBlocks.map((block) => (
        <DiagramPrototypeCard
          key={block.id}
          block={block}
          workspaceRoot={filePreviewWorkspaceRoot}
        />
      ))}

      {conversationVisualizationBlocks.map((block) => (
        <ConversationVisualizationCard key={block.id} block={block} />
      ))}

      {chartBlocks.map((block) => (
        <ChartRenderer key={block.id} spec={block.spec} />
      ))}

      {assistantContentBlocks.map((block) => (
        <MessageBubble
          key={block.id}
          block={block}
          allowThreadActions={allowMainThreadActions}
          forkAction={
            block.id === forkActionBlockId
              ? {
                  busy: forking,
                  onFork: () => {
                    void forkFromTurn()
                  }
                }
              : undefined
          }
          rollbackAction={
            block.id === rollbackActionBlockId
              ? {
                  busy: rollingBackCheckpointId === rollbackCheckpointId,
                  onRollback: () => {
                    void rollbackWorkspace(rollbackCheckpointId)
                  }
                }
              : undefined
          }
        />
      ))}

      {!isProcessing && assistantContentBlocks.length > 0 && turnUsage ? (
        <TurnUsageRow usage={turnUsage} stale={turnUsageStale} />
      ) : null}

      {!isProcessing ? (
        <GeneratedFilesPanel blocks={generatedFileBlocks} placement="turn" />
      ) : null}

      <GeneratedDocumentFilesPanel
        files={generatedDocuments}
        workspaceRoot={filePreviewWorkspaceRoot}
        onPreview={onPreviewGeneratedDocument
          ? (file) => onPreviewGeneratedDocument(file, filePreviewWorkspaceRoot)
          : undefined}
        onOpenAll={
          onOpenGeneratedDocuments && threadId && generatedDocumentTurnId
            ? (files) => onOpenGeneratedDocuments({
                threadId,
                turnId: generatedDocumentTurnId,
                workspaceRoot: filePreviewWorkspaceRoot,
                files: [...files]
              })
            : undefined
        }
      />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {runtimeErrorsAfterFinalContent.map((block) => (
        <TimelineRuntimeError
          key={block.id}
          block={block}
          onContinue={
            !isProcessing && allowMainThreadActions && allowRecoveryContinue
              ? () => {
                  void sendMessage(t('continueInterruptedTaskPrompt'))
                }
              : undefined
          }
        />
      ))}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          planId={planResult.planId}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          graphEnabled={graphEnabled}
          planMeta={planResult}
          onOpen={onOpenPlan ? () => onOpenPlan(planResult) : undefined}
          onBuild={onBuildPlan ? (orchestration) => onBuildPlan(orchestration, planResult) : undefined}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary
          changes={turnFileChanges}
          viewportRef={viewportRef}
          compact={compactCards}
          onOpenChanges={allowMainThreadActions ? onOpenChanges : undefined}
          onReviewChanges={allowMainThreadActions ? onReviewChanges : undefined}
          reviewChangesDisabled={reviewChangesDisabled}
        />
      ) : null}

      {allowMainThreadActions && hasSettledResultEvidence && forkTurnId ? (
        <div className="flex justify-end pt-6" data-archive-history-action>
          <button
            type="button"
            disabled={archiving}
            onClick={() => void archiveToTurn()}
            className="rounded-md px-2 py-1 text-[11px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          >
            {archiving ? t('archiveHistoryWorking') : t('archiveHistoryToHere')}
          </button>
        </div>
      ) : null}

      {showLiveProgress ? (
        <LiveTurnProgressRow
          tool={liveToolBlock}
          thinking={showLiveThinking}
          activityLabel={liveChildActivityLabel}
          awaitingUserInput={awaitingUserInput}
          durationMs={durationMs}
        />
      ) : null}
    </div>
  )
}

function LiveTurnProgressRow({
  tool,
  thinking,
  activityLabel,
  awaitingUserInput = false,
  durationMs
}: {
  tool?: Extract<ChatBlock, { kind: 'tool' }>
  thinking: boolean
  activityLabel?: string
  awaitingUserInput?: boolean
  durationMs?: number
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const swimMode = useWorkLogoSwimMode(true)
  const ikunVariant = useIkunWorkLogoVariant(true)
  // iKun 模式是全局 html 属性;进行行每个回合重新挂载,挂载时读取即可
  const [ikunModeOn] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-ikun-mode') === 'on'
  )
  const swimLabelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
  // UI 插件可声明自己的进行中文案(按泳姿键、按语言),未声明则用默认文案
  const pluginLabel = useUiPluginWorkLabel(
    swimLabelKey as UiPluginLabelKey,
    i18n.language ?? 'zh'
  )
  const activityText = awaitingUserInput
    ? t('awaitingYourInput')
    : activityLabel
    ? t('workingToolAction', { action: activityLabel })
    : thinking
      ? t('thinkingNow')
      : tool
        ? t('workingToolAction', { action: summarizeToolBlock(tool, t) })
        : ikunModeOn
          ? t(IKUN_WORK_LOGO_VARIANT_LABEL_KEYS[ikunVariant])
          : pluginLabel ?? t(swimLabelKey)
  const label = typeof durationMs === 'number'
    ? `${activityText} · ${formatDuration(durationMs)}`
    : activityText

  return (
    <LiveTurnActivityRow
      label={label}
      ikunVariant={ikunVariant}
      swimMode={swimMode}
      awaitingUserInput={awaitingUserInput}
    />
  )
}

function LiveTurnActivityRow({
  label,
  ikunVariant,
  swimMode,
  awaitingUserInput = false
}: {
  label: string
  ikunVariant?: IkunWorkLogoVariant
  swimMode?: WorkLogoSwimMode
  awaitingUserInput?: boolean
}): ReactElement {
  return (
    <div className={liveTurnProgressClass()} data-turn-live-status-owner="generic">
      {awaitingUserInput ? (
        <CircleHelp
          className="mr-0.5 h-4 w-4 shrink-0 text-amber-500 motion-safe:animate-pulse"
          strokeWidth={2}
          role="img"
          aria-label={label}
        />
      ) : (
        <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
          <AnimatedWorkLogo active ikunVariant={ikunVariant} mode={swimMode} phase="trail" size="sm" />
        </span>
      )}
      <span className={awaitingUserInput ? 'font-medium text-amber-600 dark:text-amber-300' : 'ds-shiny-text'}>
        {label}
      </span>
    </div>
  )
}

export const MemoMessageTurn = memo(ConversationTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.graphEnabled === next.graphEnabled &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.onOpenChanges === next.onOpenChanges &&
  prev.onReviewChanges === next.onReviewChanges &&
  prev.reviewChangesDisabled === next.reviewChangesDisabled &&
  prev.threadId === next.threadId &&
  prev.onPreviewGeneratedDocument === next.onPreviewGeneratedDocument &&
  prev.onOpenGeneratedDocuments === next.onOpenGeneratedDocuments &&
  prev.onOpenChildThread === next.onOpenChildThread &&
  prev.onCancelToolCall === next.onCancelToolCall &&
  prev.onComponentPrototypePrompt === next.onComponentPrototypePrompt &&
  prev.filePreviewWorkspaceRoot === next.filePreviewWorkspaceRoot &&
  prev.compactCards === next.compactCards &&
  prev.allowMainThreadActions === next.allowMainThreadActions &&
  prev.allowRecoveryContinue === next.allowRecoveryContinue &&
  prev.turnUsage === next.turnUsage &&
  prev.turnUsageStale === next.turnUsageStale &&
  prev.viewportRef === next.viewportRef
))

function subagentBlockOwnsLiveStatus(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  const child = readChildMeta(block)
  const detail = parseDelegateDetail(block.detail)
  if (!child.childId && !detail.childId) return false
  const status = resolveStatus(block, child, detail)
  return status === 'queued' || status === 'running' || status === 'awaiting-permission'
}
