import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Loader2,
  MessageCircle,
  Pencil,
  Trash2,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canInlineEditQueuedMessage } from '../../store/queued-message-edit'
import { queuedMessageGuidancePayload } from '../../store/queued-message-guidance'
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
  inlineEditEligible?: boolean
  mode?: string
  agentSurface?: 'code' | 'write' | 'design'
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
}

type QueueActionKind = 'edit' | 'remove' | 'guide'

type Props = {
  messages: QueuedComposerMessage[]
  running?: boolean
  guidanceTarget?: 'turn' | 'graph'
  onRemove: (id: string) => void
  onGuide?: (id: string) => void | Promise<unknown>
  onEdit?: (id: string, text: string) => boolean | void | Promise<boolean | void>
}

/** True when the steer contract can preserve the whole queued payload. */
export function canGuideQueuedComposerMessage(message: QueuedComposerMessage): boolean {
  return queuedMessageGuidancePayload(message) !== null
}

/** Compatibility export for callers that need to decide whether inline editing is lossless. */
export function canEditQueuedComposerMessage(message: QueuedComposerMessage): boolean {
  if (message.inlineEditEligible !== undefined) return message.inlineEditEligible
  return canInlineEditQueuedMessage(message as Parameters<typeof canInlineEditQueuedMessage>[0])
}

function queuedComposerMessageDisplayText(message: QueuedComposerMessage): string {
  const displayText = message.displayText?.trim()
  if (displayText) return displayText
  if (message.writeContext) {
    const userInput = parseWritePromptForDisplay(message.text)?.userInput.trim()
    if (userInput) return userInput
  }
  return message.text
}

function visibleQueue(messages: QueuedComposerMessage[]): QueuedComposerMessage[] {
  return messages.filter((message) => (
    !message.deliveryState ||
    message.deliveryState === 'pending' ||
    message.deliveryState === 'paused' ||
    message.deliveryState === 'failed'
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
  onEdit
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const queue = useMemo(() => visibleQueue(messages), [messages])
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState<{ id: string; kind: QueueActionKind } | null>(null)
  const listId = useId()

  useEffect(() => {
    if (queue.length === 0) setCollapsed(true)
    if (editing && !queue.some((message) => (
      message.id === editing.id && canEditQueuedComposerMessage(message)
    ))) setEditing(null)
  }, [editing, queue])

  if (queue.length === 0) return null

  const interactionActive = editing !== null || busy !== null
  const expanded = queue.length === 1 || !collapsed || interactionActive
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

  const saveEdit = async (): Promise<void> => {
    if (!editing || !onEdit || !editing.text.trim()) return
    const { id, text } = editing
    const saved = await applyAction(id, 'edit', () => onEdit(id, text.trim()))
    if (saved) setEditing(null)
  }

  return (
    <div
      className={css.dock}
      data-composer-stack-item="queue"
      data-composer-queue
      data-queue-dock
      data-queued-message-count={queue.length}
      data-busy-message-id={busy?.id}
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
                ? <ChevronDown size={14} strokeWidth={1.7} />
                : <ChevronUp size={14} strokeWidth={1.7} />}
            </span>
          </button>
        ) : null}

        <ul
          id={listId}
          className={css.list}
          aria-label={t('queuedMessagesTitle', { count: queue.length })}
          hidden={!expanded}
        >
          {expanded ? queue.map((message) => {
            const isEditing = editing?.id === message.id
            const isBusy = busy?.id === message.id
            const paused = message.deliveryState === 'paused'
            const failed = message.deliveryState === 'failed'
            const recoverable = paused || failed
            const imageCount = attachmentImageCount(message)
            const imageNames = imageCount > 0 ? attachmentImageNames(message) : ''
            const canEdit = Boolean(onEdit && canEditQueuedComposerMessage(message))
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
              >
                {queue.length === 1 ? (
                  <span className={css.lead} aria-hidden="true">
                    <MessageCircle size={14} strokeWidth={1.7} />
                  </span>
                ) : null}

                {isEditing ? (
                  <input
                    autoFocus
                    className={css.editor}
                    data-queued-message-editor
                    aria-label={t('queuedMessageEdit')}
                    value={editing.text}
                    disabled={busy !== null}
                    onChange={(event) => setEditing({ id: message.id, text: event.currentTarget.value })}
                    onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                      if (event.key === 'Escape') {
                        setEditing(null)
                        return
                      }
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void saveEdit()
                      }
                    }}
                  />
                ) : (
                  <span
                    className={css.preview}
                    title={queuedComposerMessageDisplayText(message)}
                  >
                    {queuedComposerMessageDisplayText(message)}
                  </span>
                )}

                {!isEditing && imageCount > 0 ? (
                  <span
                    className={css.imageMeta}
                    data-queued-message-images={imageCount}
                    title={imageNames || undefined}
                  >
                    <ImageIcon size={12} strokeWidth={1.8} aria-hidden="true" />
                    {imageCount}
                  </span>
                ) : null}

                {!isEditing && paused ? (
                  <span className={`${css.status} ${css.paused}`}>
                    {t('queuedMessagePaused')}
                  </span>
                ) : null}
                {!isEditing && failed ? (
                  <span
                    className={`${css.status} ${css.failed}`}
                    title={message.errorMessage || message.errorCode}
                  >
                    {message.errorMessage || message.errorCode || t('queuedMessageFailed')}
                  </span>
                ) : null}

                <div className={css.actions}>
                  {isEditing ? (
                    <>
                      <QueueActionButton
                        action="save"
                        label={t('queuedMessageSave')}
                        disabled={busy !== null || !editing.text.trim()}
                        onClick={() => void saveEdit()}
                      >
                        {isBusy && busy?.kind === 'edit'
                          ? <Loader2 className={css.spinner} size={14} />
                          : <Check size={14} strokeWidth={1.8} />}
                      </QueueActionButton>
                      <QueueActionButton
                        action="cancel"
                        label={t('queuedMessageCancelEdit')}
                        disabled={busy !== null}
                        onClick={() => setEditing(null)}
                      >
                        <X size={14} strokeWidth={1.8} />
                      </QueueActionButton>
                    </>
                  ) : (
                    <>
                      {onEdit ? (
                        <QueueActionButton
                          action="edit"
                          label={canEdit ? t('queuedMessageEdit') : t('queuedMessageEditUnsupported')}
                          title={canEdit ? t('queuedMessageEdit') : t('queuedMessageEditUnsupported')}
                          disabled={busy !== null || !canEdit}
                          onClick={() => setEditing({ id: message.id, text: message.text })}
                        >
                          <Pencil size={14} strokeWidth={1.8} />
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
                    </>
                  )}
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
  action: 'edit' | 'remove' | 'guide' | 'save' | 'cancel'
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
