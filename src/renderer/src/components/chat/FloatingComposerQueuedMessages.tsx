import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ImageIcon,
  Loader2,
  MessageCircle,
  Pencil,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import { queuedMessageGuidancePayload } from '../../store/queued-message-guidance'
import { QueuedMessageSnapshotBadges } from './FloatingComposerQueuedMessageBadges'
import { parseWritePromptForDisplay } from '../../write/quoted-selection'
import {
  calculateComposerPopoverPlacement,
  type ComposerPopoverAnchorRect,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'
import css from './FloatingComposerQueuedMessages.module.css'

const LEGACY_MENU_WIDTH = 176
const LEGACY_MENU_HEIGHT = 48
const LEGACY_MENU_MARGIN = 8
const LEGACY_MENU_GAP = 6
const LEGACY_POPOVER_WIDTH = 640
const LEGACY_POPOVER_MAX_HEIGHT = 360
const LEGACY_POPOVER_MARGIN = 12
const LEGACY_POPOVER_GAP = 8

export type QueuedComposerMessage = {
  id: string
  text: string
  deliveryState?: 'pending' | 'paused' | 'starting' | 'in_flight' | 'failed'
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
  composerRestoreEligible?: boolean
}

type QueueActionKind = 'edit' | 'remove' | 'guide'
type QueueDropPosition = 'before' | 'after'

type QueueDragState = {
  sourceId: string
  targetId?: string
  position?: QueueDropPosition
}

type Props = {
  messages: QueuedComposerMessage[]
  running?: boolean
  guidanceTarget?: 'turn' | 'graph'
  onRemove: (id: string) => void
  onGuide?: (id: string) => void | Promise<unknown>
  onRestoreToComposer?: (id: string) => boolean | void | Promise<boolean | void>
  onReorder?: (id: string, targetId: string, position: QueueDropPosition) => void
}

/** True when the steer contract can preserve the whole queued payload. */
export function canGuideQueuedComposerMessage(message: QueuedComposerMessage): boolean {
  return queuedMessageGuidancePayload(message) !== null
}

const QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT = 24

function queuedComposerMessageDisplayText(message: QueuedComposerMessage): string {
  const displayText = message.displayText?.trim()
  if (displayText) return displayText
  if (message.writeContext) {
    const userInput = parseWritePromptForDisplay(message.text)?.userInput.trim()
    if (userInput) return userInput
  }
  return message.text
}

function queuedMessageSummary(message: QueuedComposerMessage): string {
  const text = queuedComposerMessageDisplayText(message).replace(/\s+/g, ' ').trim()
  return text.length > QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT
    ? `${text.slice(0, QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT)}...`
    : text
}

function visibleQueue(messages: QueuedComposerMessage[]): QueuedComposerMessage[] {
  return messages.filter((message) => (
    !message.deliveryState ||
    message.deliveryState === 'pending' ||
    message.deliveryState === 'paused' ||
    message.deliveryState === 'failed' ||
    // Admitted to the durable runtime queue: visible so the user can still
    // edit, remove, or reorder it while it waits for the running turn.
    message.deliveryState === 'in_flight'
  ))
}

/**
 * The DSH-style composer queue dock: one row is direct, while multiple rows
 * start behind a compact count header and expand in place for interaction.
 */
export function FloatingComposerQueuedMessages({
  messages,
  running = false,
  guidanceTarget = 'turn',
  onRemove,
  onGuide,
  onRestoreToComposer,
  onReorder
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const queue = useMemo(() => visibleQueue(messages), [messages])
  const [collapsed, setCollapsed] = useState(true)
  const [busy, setBusy] = useState<{ id: string; kind: QueueActionKind } | null>(null)
  const [dragState, setDragState] = useState<QueueDragState | null>(null)
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  const reorderHandleRefs = useRef(new Map<string, HTMLButtonElement>())
  const listId = useId()
  const reorderHintId = useId()
  const queueRevision = useMemo(() => JSON.stringify(queue.map((message) => [
    message.id,
    message.deliveryState,
    message.text
  ])), [queue])

  useEffect(() => {
    if (queue.length === 0) setCollapsed(true)
  }, [queue])

  useEffect(() => {
    setDragState(null)
  }, [queueRevision])

  useEffect(() => {
    if (busy) setDragState(null)
  }, [busy])

  if (queue.length === 0) return null

  const interactionActive = busy !== null
  const expanded = queue.length === 1 || !collapsed || interactionActive
  const reorderEnabled = Boolean(onReorder && expanded && queue.length > 1 && !interactionActive)

  const focusReorderHandle = (id: string): void => {
    queueMicrotask(() => reorderHandleRefs.current.get(id)?.focus())
  }

  const reorderWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: string
  ): void => {
    if (!reorderEnabled || !onReorder || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return
    }
    const sourceIndex = queue.findIndex((message) => message.id === id)
    const targetIndex = event.key === 'ArrowUp' ? sourceIndex - 1 : sourceIndex + 1
    const target = queue[targetIndex]
    if (sourceIndex < 0 || !target) return
    event.preventDefault()
    event.stopPropagation()
    onReorder(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
    setMoveAnnouncement(t('queuedMessageMovedToPosition', { position: targetIndex + 1 }))
    focusReorderHandle(id)
  }

  const startDragging = (event: ReactDragEvent<HTMLButtonElement>, id: string): void => {
    if (!reorderEnabled) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDragState({ sourceId: id })
  }

  const updateDropTarget = (
    event: ReactDragEvent<HTMLLIElement>,
    targetId: string
  ): void => {
    if (!reorderEnabled || !dragState || dragState.sourceId === targetId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const position: QueueDropPosition = event.clientY < bounds.top + bounds.height / 2
      ? 'before'
      : 'after'
    setDragState((current) => current
      ? { sourceId: current.sourceId, targetId, position }
      : null)
  }

  const dropQueuedMessage = (
    event: ReactDragEvent<HTMLLIElement>,
    targetId: string
  ): void => {
    event.preventDefault()
    const sourceId = dragState?.sourceId || event.dataTransfer.getData('text/plain')
    const position = dragState?.targetId === targetId ? dragState.position : undefined
    const ids = new Set(queue.map((message) => message.id))
    if (
      reorderEnabled &&
      onReorder &&
      sourceId &&
      sourceId !== targetId &&
      position &&
      ids.has(sourceId) &&
      ids.has(targetId)
    ) {
      onReorder(sourceId, targetId, position)
    }
    setDragState(null)
  }
  const applyAction = async (
    id: string,
    kind: QueueActionKind,
    action: () => unknown | Promise<unknown>
  ): Promise<boolean> => {
    if (busy) return false
    setBusy({ id, kind })
    try {
      return (await action()) !== false
    } catch {
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={css.dock}
      data-composer-stack-item="queue"
      data-composer-queue
      data-queue-dock
      data-queued-message-count={queue.length}
      data-busy-message-id={busy?.id}
      data-queue-reorder-enabled={reorderEnabled || undefined}
    >
      <div className={css.panel}>
        {queue.length > 1 ? (
          <button
            type="button"
            className={css.header}
            data-queued-message-header
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className={css.lead} aria-hidden="true">
              <MessageCircle size={14} strokeWidth={1.7} />
            </span>
            <span className={css.count}>{t('queuedMessagesTitle', { count: queue.length })}</span>
            <span className={css.chevron} aria-hidden="true">
              {expanded
                ? <ChevronUp size={14} strokeWidth={1.7} />
                : <ChevronDown size={14} strokeWidth={1.7} />}
            </span>
          </button>
        ) : null}

        <span id={reorderHintId} className={css.assistiveText}>
          {t('queuedMessageReorder')}
        </span>
        <span
          className={css.assistiveText}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {moveAnnouncement}
        </span>

        <ul
          id={listId}
          className={css.list}
          aria-label={t('queuedMessagesTitle', { count: queue.length })}
          hidden={!expanded}
        >
          {expanded ? queue.map((message, index) => {
            const isBusy = busy?.id === message.id
            const paused = message.deliveryState === 'paused'
            const failed = message.deliveryState === 'failed'
            const inFlight = message.deliveryState === 'in_flight'
            const recoverable = paused || failed
            const imageCount = attachmentImageCount(message)
            const imageNames = imageCount > 0 ? attachmentImageNames(message) : ''
            const canRestore = Boolean(onRestoreToComposer && message.composerRestoreEligible)
            const canGuide = Boolean(onGuide && (recoverable
              ? !running && !message.waitForRuntimeAdmission
              : (
                running &&
                message.guidanceEligible !== false &&
                canGuideQueuedComposerMessage(message)
              )))
            const guideLabel = recoverable
              ? t('queuedMessageRetry')
              : t('queuedMessageSteer')
            const reorderLabel = t('queuedMessageReorderHandle', {
              index: index + 1,
              count: queue.length,
              summary: queuedMessageSummary(message)
            })
            const guideTitle = failed
              ? message.waitForRuntimeAdmission
                ? t('queuedMessageRetryUnavailable')
                : message.errorMessage || message.errorCode || guideLabel
              : paused
                ? message.waitForRuntimeAdmission
                  ? t('queuedMessageRetryUnavailable')
                  : t('queuedMessageRetry')
                : !running
                  ? t('guideQueuedMessageNoActiveTurn')
                  : message.guidanceEligible === false || !canGuideQueuedComposerMessage(message)
                    ? t('guideQueuedMessageTextOnly')
                : guidanceTarget === 'graph'
                  ? t('guideQueuedMessageGraphHint')
                  : t('guideQueuedMessageHint')

            return (
              <li
                key={message.id}
                className={css.row}
                data-queued-message-id={message.id}
                data-delivery-state={message.deliveryState ?? 'pending'}
                data-queue-dragging={dragState?.sourceId === message.id || undefined}
                data-drop-position={dragState?.targetId === message.id
                  ? dragState.position
                  : undefined}
                onDragOver={(event) => updateDropTarget(event, message.id)}
                onDragLeave={(event) => {
                  if (
                    event.currentTarget.contains(event.relatedTarget as Node | null) ||
                    dragState?.targetId !== message.id
                  ) return
                  setDragState((current) => current ? { sourceId: current.sourceId } : null)
                }}
                onDrop={(event) => dropQueuedMessage(event, message.id)}
              >
                {queue.length === 1 ? (
                  <span className={css.lead} aria-hidden="true">
                    <MessageCircle size={14} strokeWidth={1.7} />
                  </span>
                ) : null}

                {reorderEnabled ? (
                  <button
                    type="button"
                    className={css.dragHandle}
                    data-queued-message-drag-handle
                    data-queued-message-drag-id={message.id}
                    draggable={reorderEnabled}
                    aria-label={reorderLabel}
                    aria-describedby={reorderHintId}
                    title={reorderLabel}
                    ref={(node) => {
                      if (node) reorderHandleRefs.current.set(message.id, node)
                      else reorderHandleRefs.current.delete(message.id)
                    }}
                    onKeyDown={(event) => reorderWithKeyboard(event, message.id)}
                    onDragStart={(event) => startDragging(event, message.id)}
                    onDragEnd={() => setDragState(null)}
                  >
                    <GripVertical size={15} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                ) : null}

                <span
                  className={css.preview}
                  title={queuedComposerMessageDisplayText(message)}
                >
                  {queuedComposerMessageDisplayText(message)}
                </span>

                {imageCount > 0 ? (
                  <span
                    className={css.imageMeta}
                    data-queued-message-images={imageCount}
                    title={imageNames || undefined}
                  >
                    <ImageIcon size={12} strokeWidth={1.8} aria-hidden="true" />
                    {imageCount}
                  </span>
                ) : null}

                <QueuedMessageSnapshotBadges message={message} />

                {paused ? (
                  <span className={`${css.status} ${css.paused}`}>
                    {t('queuedMessagePaused')}
                  </span>
                ) : null}
                {inFlight ? (
                  <span className={`${css.status} ${css.queued}`}>
                    {t('queuedMessageInFlight')}
                  </span>
                ) : null}
                {failed ? (
                  <span
                    className={`${css.status} ${css.failed}`}
                    title={message.errorMessage || message.errorCode}
                  >
                    {message.errorMessage || message.errorCode || t('queuedMessageFailed')}
                  </span>
                ) : null}

                <div className={css.actions}>
                  {onRestoreToComposer ? (
                    <QueueActionButton
                      action="edit"
                      label={canRestore
                        ? t('queuedMessageEditInComposer')
                        : t('queuedMessageEditUnsupported')}
                      title={canRestore
                        ? t('queuedMessageEditInComposer')
                        : t('queuedMessageEditUnsupported')}
                      disabled={busy !== null || !canRestore}
                      onClick={() => void applyAction(
                        message.id,
                        'edit',
                        () => onRestoreToComposer(message.id)
                      )}
                    >
                      {isBusy && busy?.kind === 'edit'
                        ? <Loader2 className={css.spinner} size={14} />
                        : <Pencil size={14} strokeWidth={1.8} />}
                    </QueueActionButton>
                  ) : null}
                  <QueueActionButton
                    action="remove"
                    label={t('queuedMessageRemove')}
                    disabled={busy !== null}
                    onClick={() => void applyAction(
                      message.id,
                      'remove',
                      () => onRemove(message.id)
                    )}
                  >
                    {isBusy && busy?.kind === 'remove'
                      ? <Loader2 className={css.spinner} size={14} />
                      : <Trash2 size={14} strokeWidth={1.8} />}
                  </QueueActionButton>
                  {onGuide ? (
                    <QueueActionButton
                      action="guide"
                      label={canGuide ? guideLabel : guideTitle}
                      title={guideTitle}
                      disabled={busy !== null || !canGuide}
                      onClick={() => void applyAction(
                        message.id,
                        'guide',
                        () => onGuide(message.id)
                      )}
                    >
                      {isBusy && busy?.kind === 'guide'
                        ? <Loader2 className={css.spinner} size={14} />
                        : <ArrowUp size={15} strokeWidth={1.8} />}
                    </QueueActionButton>
                  ) : null}
                </div>
              </li>
            )
          }) : null}
        </ul>
      </div>
    </div>
  )
}

function attachmentImageCount(message: QueuedComposerMessage): number {
  const images = message.attachments?.filter((attachment) => attachment.kind !== 'document')
  if (images?.length) return images.length
  if (message.attachments?.length) return 0
  return message.attachmentIds?.length ?? 0
}

function attachmentImageNames(message: QueuedComposerMessage): string {
  return message.attachments
    ?.filter((attachment) => attachment.kind !== 'document')
    .map((attachment) => attachment.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(', ') ?? ''
}

function QueueActionButton({
  action,
  label,
  title = label,
  disabled,
  onClick,
  children
}: {
  action: 'edit' | 'remove' | 'guide'
  label: string
  title?: string
  disabled: boolean
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      className={css.action}
      data-queued-message-action={action}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/* Retained pure exports keep downstream placement callers source-compatible;
   the dock itself is now inline and never creates a body portal. */
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
