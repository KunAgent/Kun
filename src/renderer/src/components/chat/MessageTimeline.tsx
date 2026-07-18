import type { ReactElement, RefObject } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommitHorizontal, Hash } from 'lucide-react'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { PresentationFilesPanel } from './PresentationFilesPanel'
import { presentationFileArtifactsForTurn } from './presentation-file-artifacts'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { ComponentPrototypeCard } from './ComponentPrototypeCard'
import type { OpenChildThreadHandler } from './SubagentCallCard'
import {
  AnimatedWorkLogo,
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useIkunWorkLogoVariant,
  useWorkLogoSwimMode
} from './AnimatedWorkLogo'
import type { UiPluginLabelKey } from '@shared/ui-plugin'
import { useUiPluginWorkLabel } from '../../store/ui-plugin-store'
import {
  groupTurns,
  isBackgroundShellNoticeBlock,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { InjectedMemoryLookupProvider } from './injected-memory-lookup'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'
import {
  TimelineFilePreviewWorkspaceProvider,
  timelineFilePreviewWorkspaceRoot
} from './timeline-file-preview-workspace'
import {
  RelativePathSchema,
  ResultPreviewSourceSchema,
  type JsonValue
} from '@kun/extension-api'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { boundedPlainText } from '../../extensions/safe-text'
import {
  DeclarativeActionBar,
  canOpenHostContextMenuForTarget,
  DeclarativeContextMenuOverlay,
  DeclarativeResultPreviews,
  type ExtensionResultPreviewSource
} from '../../extensions/ControlledContributionSurfaces'
import { resolveActiveExtensionWorkspaceRoot } from '../../extensions/active-extension-workspace'
import { extractDiffFilePath, extractUnifiedDiffText } from '../../lib/diff-stats'

export { summarizeToolBlock } from './message-timeline-process'

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  focusModeEnabled?: boolean
  devPreviewCard?: ReactElement | null
  /** Disables the inline Review Plan card's Build action while a turn runs. */
  planActionsBusy?: boolean
  /** Runs the active plan (Build button on the inline Review Plan card). */
  onBuildPlan?: () => void
  /** Opens/focuses the Plan panel (Open button on the inline card). */
  onOpenPlan?: () => void
  compactCards?: boolean
  onOpenChildThread?: OpenChildThreadHandler
  onComponentPrototypePrompt?: (prompt: string) => void
  extensionMessageActions?: readonly RegisteredContribution<'actions.message'>[]
  extensionContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionAttachmentContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionCommands?: readonly RegisteredContribution<'commands'>[]
  extensionResultPreviews?: readonly RegisteredContribution<'message.resultPreviews'>[]
  onExtensionCommand?: (commandId: string, context: JsonValue) => void | Promise<unknown>
}

type CompactionTimelineBlock = Extract<ChatBlock, { kind: 'compaction' }>

const TURN_PAGE_SIZE = 18
const TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX = 16
const TIMELINE_JUMP_RAIL_STAGE_INSET_PX = 16
const TIMELINE_JUMP_RAIL_WIDTH_PX = 62
const TIMELINE_JUMP_RAIL_PREVIEW_OFFSET_PX = 68
const TIMELINE_JUMP_RAIL_PREVIEW_WIDTH_PX = 416
const TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX = 16
const TIMELINE_JUMP_RAIL_PREVIEW_CONTAINER_GUTTER_PX = 88

export function goalTimelinePaddingClass(route: 'chat' | 'claw', hasActiveGoal: boolean): string {
  return route === 'chat' && hasActiveGoal ? 'pb-32 md:pb-40' : 'pb-10'
}

export function liveTurnProgressClass(hasActiveGoal: boolean): string {
  return hasActiveGoal
    ? 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted mb-16 md:mb-20'
    : 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted'
}

export function activeTimelineTurnKey(
  positions: readonly { key: string; top: number }[],
  threshold = 96
): string | null {
  if (positions.length === 0) return null
  let active = positions[0].key
  for (const position of positions) {
    if (position.top > threshold) break
    active = position.key
  }
  return active
}

export function timelineJumpRailLeft(containerWidth: number): number {
  const stageLeft = Math.max(TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX, TIMELINE_JUMP_RAIL_STAGE_INSET_PX)
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return stageLeft
  const maxLeft = Math.max(0, containerWidth - TIMELINE_JUMP_RAIL_WIDTH_PX - TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX)
  return Math.min(stageLeft, maxLeft)
}

export function timelineJumpRailPreviewLeft(
  railLeft: number,
  containerWidth: number
): number {
  const previewWidth = Math.min(
    TIMELINE_JUMP_RAIL_PREVIEW_WIDTH_PX,
    Math.max(0, containerWidth - TIMELINE_JUMP_RAIL_PREVIEW_CONTAINER_GUTTER_PX)
  )
  const minLeft = Math.max(TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX, TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX)
  const maxLeft = Math.max(minLeft, containerWidth - previewWidth - TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX)
  const preferredLeft = railLeft + TIMELINE_JUMP_RAIL_PREVIEW_OFFSET_PX
  return Math.min(Math.max(preferredLeft, minLeft), maxLeft)
}

function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

function turnPreview(turn: Turn, fallback: string): string {
  if (turn.user && isBackgroundShellNoticeBlock(turn.user)) {
    const display = turn.user.meta?.displayText?.trim()
    if (display) {
      return display.length > 48 ? `${display.slice(0, 47).trimEnd()}...` : display
    }
  }
  const text = turn.user?.text.trim() ?? ''
  if (!text) return fallback
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > 48 ? `${oneLine.slice(0, 47).trimEnd()}...` : oneLine
}

function turnResponsePreview(turn: Turn, fallback: string): string {
  for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
    const block = turn.blocks[index]
    if (block.kind !== 'assistant') continue
    const content = splitThink(block.text).content.trim()
    if (content) return content.replace(/\s+/g, ' ')
  }
  return fallback
}

export type TimelineJumpPreviewMetadata = {
  fileLabels: string[]
  hasCommit: boolean
}

function timelineJumpPreviewFileLabel(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').at(-1) ?? normalized
}

export function timelineJumpPreviewMetadata(turn: Turn): TimelineJumpPreviewMetadata {
  const fileLabels: string[] = []
  const seenFileLabels = new Set<string>()
  let hasCommit = false

  for (const block of turn.blocks) {
    if (block.kind !== 'tool' || block.status !== 'success') continue

    if (block.toolKind === 'file_change') {
      const filePath = extractDiffFilePath(extractUnifiedDiffText(block.detail), block.filePath)
      if (filePath) {
        const label = timelineJumpPreviewFileLabel(filePath)
        const key = label.toLocaleLowerCase()
        if (label && !seenFileLabels.has(key)) {
          seenFileLabels.add(key)
          fileLabels.push(label)
        }
      }
    }

    const command = typeof block.meta?.command === 'string' ? block.meta.command : ''
    if (/\bgit(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))?\s+commit\b/i.test(command)) {
      hasCommit = true
    }
  }

  return { fileLabels: fileLabels.slice(0, 32), hasCommit }
}

export function timelineJumpPreviewTop(
  buttonTop: number,
  buttonHeight: number,
  railAnchorTop: number
): number {
  return buttonTop + buttonHeight / 2 - railAnchorTop
}

export function timelineJumpWaveDistance(index: number, hoveredIndex: number): number | null {
  if (hoveredIndex < 0) return null
  return Math.min(Math.abs(index - hoveredIndex), 3)
}

function processBlockHasError(block: ChatBlock): boolean {
  return (
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'review' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error') ||
    (block.kind === 'system' && block.severity === 'error')
  )
}

export function resultPreviewSourcesForTurn(turn: Turn): ExtensionResultPreviewSource[] {
  const sources: ExtensionResultPreviewSource[] = []
  const seen = new Set<string>()
  for (const block of turn.blocks) {
    if (block.kind !== 'tool' || block.status !== 'success' || !block.meta) continue
    const generatedFiles = block.meta.generatedFiles
    if (!Array.isArray(generatedFiles)) continue
    generatedFiles.slice(0, 32).forEach((input, index) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return
      const file = input as Record<string, unknown>
      const mimeType = typeof file.mimeType === 'string'
        ? file.mimeType.trim().toLowerCase().split(';', 1)[0].slice(0, 128)
        : ''
      if (!mimeType) return
      const artifactId = typeof file.artifactId === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(file.artifactId)
        ? file.artifactId
        : undefined
      const mediaHandleId = typeof file.mediaHandleId === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(file.mediaHandleId)
        ? file.mediaHandleId
        : undefined
      const availability = file.availability === 'available' || file.availability === 'unavailable'
        ? file.availability
        : undefined
      const attachmentId = !artifactId && typeof file.id === 'string' && /^[A-Za-z0-9._:-]+$/.test(file.id)
        ? file.id.slice(0, 256)
        : undefined
      const relativePathResult = RelativePathSchema.safeParse(file.relativePath)
      const relativePath = relativePathResult.success ? relativePathResult.data : undefined
      const boundedName = typeof file.name === 'string' ? boundedPlainText(file.name, 256).trim() : ''
      const name = boundedName || undefined
      const sourceId = `${block.id}:${artifactId || attachmentId || relativePath || name || index}`
        .replace(/[^A-Za-z0-9._:/+-]/g, '_')
        .slice(0, 512)
      if (seen.has(sourceId)) return
      const source = ResultPreviewSourceSchema.safeParse({
        sourceId,
        mimeType,
        ...(name ? { name } : {}),
        ...(attachmentId ? { attachmentId } : {}),
        ...(artifactId ? { artifactId } : {}),
        ...(mediaHandleId ? { mediaHandleId } : {}),
        ...(availability ? { availability } : {}),
        ...(relativePath ? { relativePath } : {}),
        ...(typeof file.byteSize === 'number' && Number.isFinite(file.byteSize)
          ? { byteSize: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(file.byteSize))) }
          : {}),
        ...(typeof file.width === 'number' && Number.isFinite(file.width)
          ? { width: Math.min(1_000_000, Math.max(0, Math.trunc(file.width))) }
          : {}),
        ...(typeof file.height === 'number' && Number.isFinite(file.height)
          ? { height: Math.min(1_000_000, Math.max(0, Math.trunc(file.height))) }
          : {})
      })
      if (!source.success) return
      seen.add(sourceId)
      sources.push(source.data)
    })
  }
  return sources
}

function compactionDividerLabel(
  block: CompactionTimelineBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.status === 'running') return t('compactionRunning')
  if (block.status === 'error') return block.summary || t('compactionFailed')
  return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
}

function CompactionDivider({ block }: { block: CompactionTimelineBlock }): ReactElement {
  const { t } = useTranslation('common')
  const error = block.status === 'error'
  return (
    <div
      role={block.status === 'running' ? 'status' : undefined}
      aria-live={block.status === 'running' ? 'polite' : undefined}
      className="flex w-full items-center gap-4 py-2"
    >
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-red-200/80 dark:bg-red-900/50' : 'bg-ds-border-muted/80'}`} />
      <span
        className={`shrink-0 text-[15px] font-semibold leading-6 ${
          error ? 'text-red-600 dark:text-red-300' : 'text-ds-faint'
        }`}
      >
        {compactionDividerLabel(block, t)}
      </span>
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-red-200/80 dark:bg-red-900/50' : 'bg-ds-border-muted/80'}`} />
    </div>
  )
}

export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  focusModeEnabled = false,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  compactCards = false,
  onOpenChildThread,
  onComponentPrototypePrompt,
  extensionMessageActions = [],
  extensionContextMenus = [],
  extensionAttachmentContextMenus = [],
  extensionCommands = [],
  extensionResultPreviews = [],
  onExtensionCommand
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    route,
    workspaceRoot,
    chooseWorkspace,
    activeClawChannel,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThreadGoal,
    activeThread
  } = useTimelineStores(activeThreadId)
  const extensionWorkspaceRoot = resolveActiveExtensionWorkspaceRoot(
    activeThreadId,
    activeThread ? [activeThread] : [],
    workspaceRoot
  )

  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnRefMap = useRef(new Map<string, HTMLDivElement>())
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null)
  const [jumpRailLayout, setJumpRailLayout] = useState<{
    railLeft: number
    previewLeft: number
  } | null>(null)
  const [jumpRailPreview, setJumpRailPreview] = useState<{
    key: string
    title: string
    prompt: string
    fileLabels: string[]
    hasCommit: boolean
    top: number
  } | null>(null)
  const [messageContextMenu, setMessageContextMenu] = useState<{
    position: { x: number; y: number }
    context: JsonValue
  } | null>(null)

  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length
  ].join(':')
  const {
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns
  } = useTimelineScroll({
    containerRef,
    endRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    totalTurns: turns.length,
    busy,
    scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: currentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const visibleTurnAnchors = useMemo(
    () => {
      const anchors: Array<{
        key: string
        title: string
        prompt: string
        fileLabels: string[]
        hasCommit: boolean
      }> = []
      let questionIndex = turns
        .slice(0, hiddenTurnCount)
        .filter((turn) => turn.user)
        .length

      visibleTurns.forEach((turn, index) => {
        if (!turn.user) return
        questionIndex += 1
        const absoluteTurnIndex = hiddenTurnCount + index
        const key = stableTurnKey(turn, absoluteTurnIndex)
        const metadata = timelineJumpPreviewMetadata(turn)
        anchors.push({
          key,
          title: turnPreview(turn, t('timelineJumpTurn', { index: questionIndex })),
          prompt: turnResponsePreview(turn, t('timelineJumpTurn', { index: questionIndex })),
          ...metadata
        })
      })
      return anchors
    },
    [hiddenTurnCount, t, turns, visibleTurns]
  )
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined
  const filePreviewWorkspaceRoot = timelineFilePreviewWorkspaceRoot(activeThread, workspaceRoot)

  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length === 0) {
      setActiveTurnKey(null)
      return
    }
    let frame: number | null = null
    const update = (): void => {
      frame = null
      if (container.scrollHeight - container.scrollTop - container.clientHeight <= 2) {
        setActiveTurnKey(visibleTurnAnchors.at(-1)?.key ?? null)
        return
      }
      const containerTop = container.getBoundingClientRect().top
      const positions = visibleTurnAnchors.flatMap((anchor) => {
        const node = turnRefMap.current.get(anchor.key)
        return node ? [{ key: anchor.key, top: node.getBoundingClientRect().top - containerTop }] : []
      })
      setActiveTurnKey(activeTimelineTurnKey(positions))
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [visibleTurnAnchors])

  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length <= 2) {
      setJumpRailLayout(null)
      return
    }
    const update = (): void => {
      const rect = container.getBoundingClientRect()
      const railLeft = timelineJumpRailLeft(rect.width)
      setJumpRailLayout({
        railLeft,
        previewLeft: timelineJumpRailPreviewLeft(railLeft, rect.width)
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [visibleTurnAnchors.length])

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId])

  const jumpToTurn = (key: string): void => {
    const target = turnRefMap.current.get(key)
    if (!target) return
    setActiveTurnKey(key)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showJumpRailPreview = (
    anchor: {
      key: string
      title: string
      prompt: string
      fileLabels: string[]
      hasCommit: boolean
    },
    node: HTMLButtonElement
  ): void => {
    const nodeRect = node.getBoundingClientRect()
    const railAnchor = node.closest<HTMLElement>('.timeline-jump-rail-anchor')
    const railAnchorTop = railAnchor?.getBoundingClientRect().top ?? nodeRect.top
    setJumpRailPreview({
      key: anchor.key,
      title: anchor.title,
      prompt: anchor.prompt || anchor.title,
      fileLabels: anchor.fileLabels,
      hasCommit: anchor.hasCommit,
      top: timelineJumpPreviewTop(nodeRect.top, nodeRect.height, railAnchorTop)
    })
  }

  const jumpRailHoveredIndex = jumpRailPreview
    ? visibleTurnAnchors.findIndex((item) => item.key === jumpRailPreview.key)
    : -1

  return (
    <TimelineFilePreviewWorkspaceProvider workspaceRoot={filePreviewWorkspaceRoot}>
    <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot}>
    <div ref={containerRef} className="ds-no-drag relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {visibleTurnAnchors.length > 2 && jumpRailLayout ? (
        <div className="timeline-jump-rail-anchor">
          <nav
            aria-label={t('timelineJumpRailLabel')}
            className="timeline-jump-rail"
            style={{
              left: `${jumpRailLayout.railLeft}px`
            }}
            onMouseLeave={() => setJumpRailPreview(null)}
          >
            {visibleTurnAnchors.map((anchor, index) => {
              const waveDistance = timelineJumpWaveDistance(index, jumpRailHoveredIndex)
              return (
                <button
                  key={anchor.key}
                  type="button"
                  className={`timeline-jump-rail-button${activeTurnKey === anchor.key ? ' is-active' : ''}`}
                  data-wave-distance={waveDistance ?? undefined}
                  aria-label={anchor.title}
                  aria-current={activeTurnKey === anchor.key ? 'true' : undefined}
                  onMouseEnter={(event) => showJumpRailPreview(anchor, event.currentTarget)}
                  onFocus={(event) => showJumpRailPreview(anchor, event.currentTarget)}
                  onBlur={() => setJumpRailPreview(null)}
                  onClick={() => jumpToTurn(anchor.key)}
                />
              )
            })}
          </nav>
          {jumpRailPreview ? (
            <div
              className="timeline-jump-rail-preview"
              style={{
                left: `${jumpRailLayout.previewLeft}px`,
                top: `${jumpRailPreview.top}px`
              }}
              role="tooltip"
            >
              <div className="timeline-jump-rail-preview-title">{jumpRailPreview.title}</div>
              <div className="timeline-jump-rail-preview-text">{jumpRailPreview.prompt}</div>
              {jumpRailPreview.fileLabels.length > 0 || jumpRailPreview.hasCommit ? (
                <div className="timeline-jump-rail-preview-meta" aria-hidden="true">
                  {jumpRailPreview.fileLabels.slice(0, 2).map((fileLabel) => (
                    <span key={fileLabel} className="timeline-jump-rail-preview-meta-item">
                      <Hash />
                      <span className="timeline-jump-rail-preview-file-label">{fileLabel}</span>
                    </span>
                  ))}
                  {jumpRailPreview.fileLabels.length > 2 ? (
                    <span className="timeline-jump-rail-preview-meta-count">
                      +{jumpRailPreview.fileLabels.length - 2}
                    </span>
                  ) : null}
                  {jumpRailPreview.hasCommit ? (
                    <span className="timeline-jump-rail-preview-meta-item">
                      <GitCommitHorizontal />
                      {t('userInputSubmit')}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`ds-message-timeline-content ds-chat-column-inset ds-chat-content-max-width mx-auto flex w-full min-w-0 flex-col gap-8 pt-8 ${
        goalTimelinePaddingClass(heroRoute, Boolean(activeThreadGoal))
      }`}>
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            focusModeEnabled={focusModeEnabled}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && currentTurnUserId === userId)
          const startedAt = userId ? turnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? turnDurationByUserId[userId] : undefined
          const durationMs =
            recordedDuration ??
            (isLive && typeof startedAt === 'number'
              ? Math.max(0, tickNow - startedAt)
              : undefined)
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? turnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
          const turnPending = threadHasPendingRuntimeWork(turn.blocks)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          const turnIsProcessing = (busy && isLatestTurn) || turnPending || hasLiveStream
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          const turnKey = stableTurnKey(turn, absoluteTurnIndex)
          return (
            <div
              key={turnKey}
              ref={(node) => {
                if (node) {
                  turnRefMap.current.set(turnKey, node)
                } else {
                  turnRefMap.current.delete(turnKey)
                }
              }}
              className="scroll-mt-6"
              data-extension-message-context
              onContextMenu={(event) => {
                const attachmentItem = event.target instanceof Element
                  ? event.target.closest<HTMLElement>('[data-extension-attachment-item]')
                  : null
                const attachment = Boolean(attachmentItem) || (event.target instanceof Element &&
                  event.target.closest('[data-extension-attachment-context]') !== null)
                if (
                  !onExtensionCommand ||
                  (!attachment && !canOpenHostContextMenuForTarget(event.target))
                ) return
                const contributions = attachment
                  ? extensionAttachmentContextMenus
                  : extensionContextMenus
                if (contributions.length === 0) return
                event.preventDefault()
                event.stopPropagation()
                setMessageContextMenu({
                  position: { x: event.clientX, y: event.clientY },
                  context: {
                    surface: attachment ? 'attachment' : 'message',
                    threadId: activeThreadId,
                    turnId: turn.user?.turnId ?? null,
                    messageId: turn.user?.id ?? null,
                    attachmentId: attachmentItem?.dataset.extensionAttachmentId || null,
                    mimeType: attachmentItem?.dataset.extensionAttachmentMime || null
                  }
                })
              }}
            >
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                isProcessing={turnIsProcessing}
                liveReasoning={isLatestTurn ? liveReasoning : ''}
                live={isLatestTurn ? live : ''}
                durationMs={durationMs}
                reasoningDurationMs={reasoningDurationMs}
                devPreviewCard={isLatestTurn ? devPreviewCard : null}
                planActionsBusy={planActionsBusy}
                onBuildPlan={onBuildPlan}
                onOpenPlan={onOpenPlan}
                onOpenChildThread={onOpenChildThread}
                onComponentPrototypePrompt={onComponentPrototypePrompt}
                filePreviewWorkspaceRoot={filePreviewWorkspaceRoot}
                viewportRef={containerRef}
                compactCards={compactCards}
              />
              {!turnIsProcessing && extensionMessageActions.length && onExtensionCommand ? (
                <div className="mt-1 flex justify-end">
                  <DeclarativeActionBar
                    contributions={extensionMessageActions}
                    context={{
                      surface: 'message',
                      threadId: activeThreadId,
                      turnId: turn.user?.turnId ?? null,
                      messageId: turn.user?.id ?? null
                    }}
                    onCommand={onExtensionCommand}
                    compact
                  />
                </div>
              ) : null}
              {!turnIsProcessing && extensionResultPreviews.length ? (
                <DeclarativeResultPreviews
                  contributions={extensionResultPreviews}
                  sources={resultPreviewSourcesForTurn(turn)}
                  threadId={activeThreadId}
                  turnId={turn.user?.turnId}
                  workspaceRoot={extensionWorkspaceRoot}
                />
              ) : null}
            </div>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning) ? (
          <MemoMessageTurn
            turn={{ blocks: [] }}
            isProcessing={busy}
            liveReasoning={liveReasoning}
            live={live}
            devPreviewCard={devPreviewCard}
            filePreviewWorkspaceRoot={filePreviewWorkspaceRoot}
            viewportRef={containerRef}
            onOpenChildThread={onOpenChildThread}
            onComponentPrototypePrompt={onComponentPrototypePrompt}
            compactCards={compactCards}
            durationMs={
              currentTurnUserId && typeof turnStartedAtByUserId[currentTurnUserId] === 'number'
                ? Math.max(0, tickNow - turnStartedAtByUserId[currentTurnUserId])
                : undefined
            }
            reasoningDurationMs={(() => {
              if (!currentTurnUserId) return undefined
              const first = turnReasoningFirstAtByUserId[currentTurnUserId]
              const last = turnReasoningLastAtByUserId[currentTurnUserId]
              if (typeof first !== 'number' || typeof last !== 'number') return undefined
              return Math.max(0, last - first)
            })()}
          />
        ) : null}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
      {onExtensionCommand ? (
        <DeclarativeContextMenuOverlay
          contributions={messageContextMenu?.context &&
            typeof messageContextMenu.context === 'object' &&
            !Array.isArray(messageContextMenu.context) &&
            messageContextMenu.context.surface === 'attachment'
            ? extensionAttachmentContextMenus
            : extensionContextMenus}
          commands={extensionCommands}
          context={messageContextMenu?.context ?? null}
          position={messageContextMenu?.position ?? null}
          onCommand={onExtensionCommand}
          onClose={() => setMessageContextMenu(null)}
        />
      ) : null}
    </div>
    </InjectedMemoryLookupProvider>
    </TimelineFilePreviewWorkspaceProvider>
  )
}

function MessageTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  durationMs,
  reasoningDurationMs,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  onOpenChildThread,
  onComponentPrototypePrompt,
  filePreviewWorkspaceRoot,
  viewportRef,
  compactCards = false
}: {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  durationMs?: number
  reasoningDurationMs?: number
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  onBuildPlan?: () => void
  onOpenPlan?: () => void
  onOpenChildThread?: OpenChildThreadHandler
  onComponentPrototypePrompt?: (prompt: string) => void
  filePreviewWorkspaceRoot: string
  viewportRef: RefObject<HTMLDivElement | null>
  compactCards?: boolean
}): ReactElement {
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const forkThreadFromTurn = useChatStore((s) => s.forkThreadFromTurn)
  const rollbackWorkspaceToCheckpoint = useChatStore((s) => s.rollbackWorkspaceToCheckpoint)
  const [forking, setForking] = useState(false)
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

  const { processBlocks, assistantContentBlocks, componentPrototypeBlocks, generatedFileBlocks, turnFileChanges } = useMemo(
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
  const presentationFiles = useMemo(
    () => presentationFileArtifactsForTurn(
      turn.blocks,
      filePreviewWorkspaceRoot,
      isProcessing,
      typeof window === 'undefined' ? '' : window.kunGui?.platform ?? ''
    ),
    [turn.blocks, filePreviewWorkspaceRoot, isProcessing]
  )
  const compactionBlocks = useMemo(
    () => processBlocks.filter((block): block is CompactionTimelineBlock => block.kind === 'compaction'),
    [processBlocks]
  )
  const workProcessBlocks = useMemo(
    () => processBlocks.filter((block) => block.kind !== 'compaction'),
    [processBlocks]
  )
  const onlyCompactionProcess = processBlocks.length > 0 && workProcessBlocks.length === 0
  const hasProcessError = workProcessBlocks.some(processBlockHasError)
  // Keep active failures visible while a turn is still running, but fold
  // completed failures into the normal work summary until the user opens it.
  const forceExpandForError = isProcessing && hasProcessError
  const workExpanded = forceExpandForError || (workExpandedOverride ?? isProcessing)
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )

  const processSections = useMemo(
    () => (workExpanded ? groupProcessSections(workProcessBlocks) : []),
    [workProcessBlocks, workExpanded]
  )
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  // Show the live assistant bubble whenever the SSE has streamed any text
  // into `live`. We deliberately do NOT gate on `isProcessing`: the
  // processing indicator (WorkMetaRow above) already covers "the agent is
  // working", and hiding the streaming text here causes real-time updates
  // (Feishu bot streaming) to appear only after turn_completed, which the
  // user perceives as a long delay.
  // Note: `live` is the generic SSE sink output across ALL channels
  // (Kun runtime turns, claw channel replies from feishu/weixin/etc),
  // not feishu-specific. Removing the !isProcessing gate is intentional
  // for all streaming paths, not just feishu.
  const showLiveAssistant = !!liveContent.trim()
  const forkTurnId =
    turn.user?.turnId?.trim() ||
    [...assistantContentBlocks].reverse().find((block) => block.turnId?.trim())?.turnId?.trim() ||
    ''
  const forkActionBlockId =
    !isProcessing && forkTurnId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined
  const rollbackCheckpointId = turn.user?.meta?.workspaceCheckpointId?.trim() ?? ''
  const rollbackActionBlockId =
    !isProcessing && rollbackCheckpointId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined

  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const hasProcess = (isProcessing && !onlyCompactionProcess) || workProcessBlocks.length > 0
  const showLiveProgress = isProcessing && !onlyCompactionProcess
  const forkFromTurn = async (): Promise<void> => {
    if (!forkTurnId || forking) return
    setForking(true)
    try {
      await forkThreadFromTurn(forkTurnId)
    } finally {
      setForking(false)
    }
  }
  const rollbackWorkspace = async (checkpointId: string): Promise<void> => {
    const targetCheckpointId = checkpointId.trim()
    if (!targetCheckpointId || rollingBackCheckpointId) return
    setRollingBackCheckpointId(targetCheckpointId)
    try {
      await rollbackWorkspaceToCheckpoint(targetCheckpointId)
    } finally {
      setRollingBackCheckpointId(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            processing={isProcessing}
            stepCount={workProcessBlocks.length}
            durationMs={durationMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            collapsible={!forceExpandForError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  workspaceRoot={filePreviewWorkspaceRoot}
                  viewportRef={viewportRef}
                  onOpenChildThread={onOpenChildThread}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {componentPrototypeBlocks.map((block) => (
        <ComponentPrototypeCard
          key={block.id}
          block={block}
          workspaceRoot={filePreviewWorkspaceRoot}
          onPrompt={onComponentPrototypePrompt}
        />
      ))}

      {assistantContentBlocks.map((block) => (
        <MessageBubble
          key={block.id}
          block={block}
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

      {showLiveAssistant ? (
        <MessageBubble block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }} />
      ) : null}

      <GeneratedFilesPanel blocks={generatedFileBlocks} />

      <PresentationFilesPanel files={presentationFiles} workspaceRoot={filePreviewWorkspaceRoot} />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {showLiveProgress ? <LiveTurnProgressRow hasActiveGoal={Boolean(activeThreadGoal)} /> : null}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          onOpen={onOpenPlan}
          onBuild={onBuildPlan}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} compact={compactCards} />
      ) : null}

      {/* The compaction marker renders LAST so "已压缩上下文" sits at the very
          bottom of the turn it belongs to — i.e. the bottom of the latest turn
          when the compaction just happened — rather than wedged between the
          user's question and the assistant's answer. */}
      {compactionBlocks.map((block) => (
        <CompactionDivider key={block.id} block={block} />
      ))}
    </div>
  )
}

function LiveTurnProgressRow({ hasActiveGoal }: { hasActiveGoal: boolean }): ReactElement {
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
  const label = ikunModeOn
    ? t(IKUN_WORK_LOGO_VARIANT_LABEL_KEYS[ikunVariant])
    : pluginLabel ?? t(swimLabelKey)

  return (
    <div className={liveTurnProgressClass(hasActiveGoal)}>
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active ikunVariant={ikunVariant} mode={swimMode} phase="trail" size="sm" />
      </span>
      <span className="ds-shiny-text">{label}</span>
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.onOpenChildThread === next.onOpenChildThread &&
  prev.onComponentPrototypePrompt === next.onComponentPrototypePrompt &&
  prev.filePreviewWorkspaceRoot === next.filePreviewWorkspaceRoot &&
  prev.compactCards === next.compactCards &&
  prev.viewportRef === next.viewportRef
))
