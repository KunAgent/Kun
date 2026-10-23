import { useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import { QueueCaption, QueueExpander, QueuePausedCaption } from './FloatingComposerQueueParts'
import { QueuedMessageRow, type QueueRowActionKind } from './composer-queue-row'
import {
  queuedMessageRowState,
  visibleQueuedMessages,
  type QueueGuidanceTarget
} from './composer-queue-row-state'
import { useQueuedMessageReorder, type QueueDropPosition } from './composer-queue-reorder'
import {
  calculateComposerPopoverPlacement,
  type ComposerPopoverAnchorRect,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'
import css from './FloatingComposerQueuedMessages.module.css'

export { canGuideQueuedComposerMessage } from './composer-queue-row-state'

const LEGACY_MENU_WIDTH = 176
const LEGACY_MENU_HEIGHT = 48
const LEGACY_MENU_MARGIN = 8
const LEGACY_MENU_GAP = 6
const LEGACY_POPOVER_WIDTH = 640
const LEGACY_POPOVER_MAX_HEIGHT = 360
const LEGACY_POPOVER_MARGIN = 12
const LEGACY_POPOVER_GAP = 8

/** Rows shown before the "n more" disclosure folds the rest away. */
export const QUEUE_COLLAPSED_ROW_LIMIT = 3

export type QueuedComposerMessage = {
  id: string
  text: string
  deliveryState?: 'pending' | 'paused' | 'starting' | 'in_flight' | 'failed'
  editIntent?: 'cancelling' | 'restoring'
  steeringRequest?: { operationId: string; turnId: string }
  deliveryTurnId?: string
  deliveryUserMessageItemId?: string
  waitForRuntimeAdmission?: boolean
  displayText?: string
  errorCode?: string
  errorMessage?: string
  guidanceEligible?: boolean
  mode?: string
  agentSurface?: 'code' | 'write' | 'design'
  model?: string
  reasoningEffort?: string
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  attachmentIds?: readonly string[]
  attachments?: readonly { name?: string; kind?: 'image' | 'document' }[]
  fileReferences?: readonly unknown[]
  composerContexts?: readonly unknown[]
  subagentResume?: unknown
  messageSource?: unknown
  guiPlan?: unknown
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: unknown
  designProfile?: unknown
  designDocumentTarget?: unknown
  designImagePlacementTarget?: unknown
  writeContext?: unknown
  composerRestoreBlockReason?: import('../../store/queued-message-edit').QueueEditBlockReason
  composerRestoreEligible?: boolean
}

type Props = {
  messages: QueuedComposerMessage[]
  running?: boolean
  /** turn/graph: guidance joins the run; deferred: after its current step; unsupported: next turn only. */
  guidanceTarget?: QueueGuidanceTarget
  onRemove: (id: string) => void
  onGuide?: (id: string) => void | Promise<unknown>
  onRestoreToComposer?: (id: string) => boolean | void | Promise<boolean | void>
  onReorder?: (id: string, targetId: string, position: QueueDropPosition) => void
  /** Resume a queue parked by an interrupt; shown on the paused caption. */
  onResume?: () => void | Promise<unknown>
}

/**
 * The queue section at the bottom of the composer activity tray, right above
 * the input. The tray owns the surface and the hairline above; this renders
 * the caption (or the paused notice), the rows, and an "n more" disclosure
 * once more than three messages wait.
 */
export function FloatingComposerQueuedMessages({
  messages,
  running = false,
  guidanceTarget = 'turn',
  onRemove,
  onGuide,
  onRestoreToComposer,
  onReorder,
  onResume
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const queue = useMemo(() => visibleQueuedMessages(messages), [messages])
  const [collapsed, setCollapsed] = useState(true)
  const [busy, setBusy] = useState<{ id: string; kind: QueueRowActionKind } | null>(null)
  const [resuming, setResuming] = useState(false)
  const listId = useId()
  const reorderHintId = useId()
  const interactionActive = busy !== null
  const reorderEnabled = Boolean(onReorder && queue.length > 1 && !interactionActive &&
    !queue.some((message) => message.editIntent || message.deliveryState === 'starting'))
  const reorder = useQueuedMessageReorder({
    queue,
    enabled: reorderEnabled,
    busy: interactionActive,
    onReorder,
    onRevealIndex: (index) => {
      if (index >= QUEUE_COLLAPSED_ROW_LIMIT) setCollapsed(false)
    },
    t
  })

  useEffect(() => {
    if (queue.length === 0) setCollapsed(true)
  }, [queue])

  if (queue.length === 0) return null

  const pausedCount = queue.filter((message) => message.deliveryState === 'paused' && !message.editIntent).length
  const showPausedCaption = pausedCount > 0
  const foldable = queue.length > QUEUE_COLLAPSED_ROW_LIMIT
  const expanded = !foldable || !collapsed
  const rows = expanded ? queue : queue.slice(0, QUEUE_COLLAPSED_ROW_LIMIT)
  const queueTitle = t('queuedMessagesTitle', { count: queue.length })

  const runAction = (id: string, kind: QueueRowActionKind): void => {
    if (busy) return
    const action = kind === 'guide'
      ? () => onGuide?.(id)
      : kind === 'edit'
        ? () => onRestoreToComposer?.(id)
        : () => onRemove(id)
    setBusy({ id, kind })
    void Promise.resolve()
      .then(action)
      .catch(() => undefined)
      .finally(() => setBusy(null))
  }

  const resume = (): void => {
    if (!onResume || busy || resuming) return
    setResuming(true)
    void Promise.resolve()
      .then(onResume)
      .catch(() => undefined)
      .finally(() => setResuming(false))
  }

  return (
    <div
      className={css.dock}
      data-composer-stack-item="queue"
      data-composer-queue
      data-queue-dock
      data-queued-message-count={queue.length}
      data-busy-message-id={busy?.id}
      data-queue-paused={showPausedCaption || undefined}
      data-queue-reorder-enabled={reorderEnabled || undefined}
    >
      {showPausedCaption ? (
        <QueuePausedCaption
          count={pausedCount}
          running={running}
          busy={resuming || interactionActive}
          onResume={onResume ? resume : undefined}
        />
      ) : (
        <QueueCaption
          count={queue.length}
          running={running}
          confirming={queue.some((message) => message.deliveryState === 'starting')}
          showDragHint={reorderEnabled}
        />
      )}

      <span id={reorderHintId} className={css.assistiveText}>
        {t('queuedMessageReorder')}
      </span>
      <span className={css.assistiveText} role="status" aria-live="polite" aria-atomic="true">
        {reorder.announcement}
      </span>

      <ul
        id={listId}
        className={css.list}
        aria-label={queueTitle}
        data-queue-expanded={expanded || undefined}
      >
        {rows.map((message, index) => (
          <QueuedMessageRow
            key={message.id}
            message={message}
            index={index}
            count={queue.length}
            first={index === 0}
            state={queuedMessageRowState(message, {
              running,
              guidanceTarget,
              pausedCaptionShown: showPausedCaption,
              hasGuide: Boolean(onGuide),
              hasRestore: Boolean(onRestoreToComposer)
            }, t)}
            pausedCaptionShown={showPausedCaption}
            reorderEnabled={reorderEnabled}
            reorderHintId={reorderHintId}
            reorder={reorder}
            busy={busy}
            hasGuide={Boolean(onGuide)}
            hasRestore={Boolean(onRestoreToComposer)}
            onAction={runAction}
            t={t}
          />
        ))}
      </ul>

      {foldable ? (
        <QueueExpander
          hiddenCount={queue.length - QUEUE_COLLAPSED_ROW_LIMIT}
          expanded={expanded}
          disabled={interactionActive}
          controls={listId}
          onToggle={() => setCollapsed((value) => !value)}
        />
      ) : null}
    </div>
  )
}

/* Retained pure exports keep downstream placement callers source-compatible;
   the queue itself is inline in the tray and never creates a body portal. */
export type QueuedMessagesPopoverPlacement = ComposerPopoverPlacement

export function calculateQueuedMessagesPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: ComposerPopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): QueuedMessagesPopoverPlacement {
  return calculateComposerPopoverPlacement({
    anchorRect,
    popoverHeight,
    viewportHeight,
    viewportWidth,
    coordinateScale,
    preferredWidth: LEGACY_POPOVER_WIDTH,
    maximumHeight: LEGACY_POPOVER_MAX_HEIGHT,
    margin: LEGACY_POPOVER_MARGIN,
    gap: LEGACY_POPOVER_GAP
  })
}

export type QueuedMessageMenuPlacement = { left: number; top: number; width: number }

export function calculateQueuedMessageMenuPlacement({
  anchorRect,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: Pick<DOMRect, 'bottom' | 'right' | 'top'>
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): QueuedMessageMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const normalizedRight = anchorRect.right / scale
  const normalizedTop = anchorRect.top / scale
  const normalizedBottom = anchorRect.bottom / scale
  const width = Math.min(
    LEGACY_MENU_WIDTH,
    Math.max(1, normalizedViewportWidth - LEGACY_MENU_MARGIN * 2)
  )
  const left = Math.min(
    Math.max(LEGACY_MENU_MARGIN, normalizedRight - width),
    Math.max(LEGACY_MENU_MARGIN, normalizedViewportWidth - LEGACY_MENU_MARGIN - width)
  )
  const belowTop = normalizedBottom + LEGACY_MENU_GAP
  const top = belowTop + LEGACY_MENU_HEIGHT <= normalizedViewportHeight - LEGACY_MENU_MARGIN
    ? belowTop
    : Math.max(LEGACY_MENU_MARGIN, normalizedTop - LEGACY_MENU_GAP - LEGACY_MENU_HEIGHT)
  return { left, top, width }
}
