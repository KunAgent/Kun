import type { ReactElement } from 'react'
import { ArrowUpFromLine, CircleAlert, GripVertical, Loader2, Pencil, RotateCw, Trash2 } from 'lucide-react'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import {
  QueuedMessageAttachments,
  QueuedMessageDeliveryStatus,
  QueuedMessageSnapshotBadges
} from './FloatingComposerQueuedMessageBadges'
import { QueueRowMoreMenu, type QueueRowMenuItem } from './FloatingComposerQueueParts'
import {
  isQueuedSlashCommand,
  queuedComposerMessageDisplayText,
  queuedMessageStatus,
  queuedMessageSummary,
  type QueuedMessageRowState
} from './composer-queue-row-state'
import type { QueuedMessageReorder } from './composer-queue-reorder'
import css from './FloatingComposerQueuedMessages.module.css'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type QueueRowActionKind = 'edit' | 'remove' | 'guide'

/**
 * One queued message: grip (drag + keyboard reorder handle), the text on one
 * line, frozen-settings badges, attachments, delivery status, then the
 * actions. Actions always show on the first row and appear on hover or focus
 * for the others, laid over the trailing meta so the row never reflows.
 */
export function QueuedMessageRow({
  message,
  index,
  count,
  first,
  state,
  pausedCaptionShown,
  reorderEnabled,
  reorderHintId,
  reorder,
  busy,
  hasGuide,
  hasRestore,
  onAction,
  t
}: {
  message: QueuedComposerMessage
  index: number
  count: number
  first: boolean
  state: QueuedMessageRowState
  pausedCaptionShown: boolean
  reorderEnabled: boolean
  reorderHintId: string
  reorder: QueuedMessageReorder
  /** The in-flight row action, if any (interlocks every row). */
  busy: { id: string; kind: QueueRowActionKind } | null
  hasGuide: boolean
  hasRestore: boolean
  onAction: (id: string, kind: QueueRowActionKind) => void
  t: Translate
}): ReactElement {
  const text = queuedComposerMessageDisplayText(message)
  const rowBusyKind = busy?.id === message.id ? busy.kind : null
  const interlocked = busy !== null
  const { dragState } = reorder
  const reorderLabel = t('queuedMessageReorderHandle', {
    index: index + 1,
    count,
    summary: queuedMessageSummary(message)
  })
  const menuItems: QueueRowMenuItem[] = [
    ...(reorderEnabled && index > 0 ? [{
      key: 'move-top' as const,
      label: t('queuedMessageMoveToTop'),
      onSelect: () => reorder.moveToTop(message.id)
    }] : []),
    {
      key: 'copy' as const,
      label: t('queuedMessageCopy'),
      onSelect: () => void navigator.clipboard?.writeText(text).catch(() => undefined)
    }
  ]

  return (
    <li
      className={css.row}
      data-queued-message-id={message.id}
      data-delivery-state={message.deliveryState ?? 'pending'}
      data-first={first || undefined}
      data-plain={!reorderEnabled && count === 1 && !state.failed ? 'true' : undefined}
      data-queue-dragging={dragState?.sourceId === message.id || undefined}
      data-drop-position={dragState?.targetId === message.id ? dragState.position : undefined}
      onDragOver={(event) => reorder.onRowDragOver(event, message.id)}
      onDragLeave={(event) => reorder.onRowDragLeave(event, message.id)}
      onDrop={(event) => reorder.onRowDrop(event, message.id)}
    >
      {reorderEnabled ? (
        <button
          type="button"
          className={css.grip}
          data-queued-message-drag-handle
          data-queued-message-drag-id={message.id}
          draggable
          aria-label={reorderLabel}
          aria-describedby={reorderHintId}
          title={reorderLabel}
          ref={(node) => reorder.registerHandle(message.id, node)}
          onKeyDown={(event) => reorder.onHandleKeyDown(event, message.id)}
          onDragStart={(event) => reorder.onHandleDragStart(event, message.id)}
          onDragEnd={reorder.onHandleDragEnd}
        >
          <GripVertical size={13} strokeWidth={1.7} aria-hidden="true" />
        </button>
      ) : count > 1 ? (
        <span className={`${css.grip} ${css.gripIdle}`} aria-hidden="true">
          <GripVertical size={13} strokeWidth={1.7} />
        </span>
      ) : state.failed ? (
        <span className={`${css.lead} ${css.leadFailed}`} aria-hidden="true">
          <CircleAlert size={14} strokeWidth={2} />
        </span>
      ) : null}

      <span
        className={`${css.text} ${isQueuedSlashCommand(text) ? css.mono : ''}`.trim()}
        title={text}
      >
        {text}
      </span>

      <span className={css.meta}>
        <QueuedMessageSnapshotBadges message={message} />
        <QueuedMessageAttachments message={message} />
        <QueuedMessageDeliveryStatus status={queuedMessageStatus(message, pausedCaptionShown, t)} />
      </span>

      <span className={css.actions}>
        {hasGuide ? (
          <button
            type="button"
            className={css.nowAction}
            data-queued-message-action="guide"
            aria-label={state.canGuide ? state.guideLabel : state.guideTitle}
            title={state.guideTitle}
            hidden={state.guideHidden}
            disabled={interlocked || !state.canGuide}
            onClick={() => onAction(message.id, 'guide')}
          >
            {rowBusyKind === 'guide'
              ? <Loader2 className={css.spinner} size={12} aria-hidden="true" />
              : state.recoverable
                ? <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
                : <ArrowUpFromLine size={12} strokeWidth={2.2} aria-hidden="true" />}
            <span>{state.recoverable ? t('queuedMessageRetryShort') : t('composerQueue.now')}</span>
          </button>
        ) : null}
        {hasRestore ? (
          <button
            type="button"
            className={css.iconAction}
            data-queued-message-action="edit"
            aria-label={state.restoreLabel}
            title={state.restoreLabel}
            disabled={interlocked || !state.canRestore}
            onClick={() => onAction(message.id, 'edit')}
          >
            {rowBusyKind === 'edit'
              ? <Loader2 className={css.spinner} size={14} aria-hidden="true" />
              : <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />}
          </button>
        ) : null}
        <button
          type="button"
          className={css.iconAction}
          data-queued-message-action="remove"
          aria-label={t('queuedMessageRemove')}
          title={t('queuedMessageRemove')}
          disabled={interlocked || state.removeBlocked}
          onClick={() => onAction(message.id, 'remove')}
        >
          {rowBusyKind === 'remove'
            ? <Loader2 className={css.spinner} size={14} aria-hidden="true" />
            : <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />}
        </button>
        <QueueRowMoreMenu
          label={t('queuedMessageMoreActions')}
          disabled={interlocked}
          items={menuItems}
        />
      </span>
    </li>
  )
}
