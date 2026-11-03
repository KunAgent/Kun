import { queuedMessageGuidancePayload } from '../../store/queued-message-guidance'
import { parseWritePromptForDisplay } from '../../write/quoted-selection'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'

/*
 * Pure queue-row rules shared by the tray queue: which rows show, what each
 * row says, and which actions it offers. Kept free of React so the rules are
 * unit-testable without rendering.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string

/** turn/graph: guidance joins the run; deferred: after its current step; unsupported: next turn only. */
export type QueueGuidanceTarget = 'turn' | 'graph' | 'deferred' | 'unsupported'

/** Rows the user can still see and manage; settled deliveries drop out. */
export function visibleQueuedMessages(messages: readonly QueuedComposerMessage[]): QueuedComposerMessage[] {
  return messages.filter((message) => (
    !message.deliveryState ||
    message.deliveryState === 'pending' ||
    message.deliveryState === 'paused' ||
    message.deliveryState === 'failed' ||
    message.deliveryState === 'starting' ||
    // Admitted to the durable runtime queue: visible so the user can still
    // edit, remove, or reorder it while it waits for the running turn.
    message.deliveryState === 'in_flight'
  ))
}

/** True when the steer contract can preserve the whole queued payload. */
export function canGuideQueuedComposerMessage(message: QueuedComposerMessage): boolean {
  return queuedMessageGuidancePayload(message) !== null
}

export function queuedComposerMessageDisplayText(message: QueuedComposerMessage): string {
  const displayText = message.displayText?.trim()
  if (displayText) return displayText
  if (message.writeContext) {
    const userInput = parseWritePromptForDisplay(message.text)?.userInput.trim()
    if (userInput) return userInput
  }
  return message.text
}

const QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT = 24

/** Short one-line summary for screen-reader labels. */
export function queuedMessageSummary(message: QueuedComposerMessage): string {
  const text = queuedComposerMessageDisplayText(message).replace(/\s+/g, ' ').trim()
  return text.length > QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT
    ? `${text.slice(0, QUEUED_MESSAGE_LABEL_SUMMARY_LIMIT)}...`
    : text
}

/** Slash commands render in the mono face so they read as commands. */
export function isQueuedSlashCommand(text: string): boolean {
  return /^\/[\p{L}\p{N}_-]/u.test(text.trim())
}

export type QueuedAttachmentSummary = {
  /** Image count (also the `data-queued-message-images` value). */
  imageCount: number
  documentCount: number
  /** The one named attachment, shown by name instead of a count. */
  singleName: string | null
  /** Every known name, for the tooltip. */
  names: string
}

export function queuedAttachmentSummary(message: QueuedComposerMessage): QueuedAttachmentSummary {
  const attachments = message.attachments ?? []
  const named = attachments
    .map((attachment) => attachment.name?.trim())
    .filter((name): name is string => Boolean(name))
  if (attachments.length > 0) {
    const imageCount = attachments.filter((attachment) => attachment.kind !== 'document').length
    return {
      imageCount,
      documentCount: attachments.length - imageCount,
      singleName: attachments.length === 1 && named.length === 1 ? named[0]! : null,
      names: named.join(', ')
    }
  }
  // Ids without metadata come from image paste/upload paths.
  return {
    imageCount: message.attachmentIds?.length ?? 0,
    documentCount: 0,
    singleName: null,
    names: ''
  }
}

export type QueuedMessageRowState = {
  paused: boolean
  failed: boolean
  inFlight: boolean
  starting: boolean
  /** Paused or failed: the row action becomes Retry. */
  recoverable: boolean
  canRestore: boolean
  canGuide: boolean
  /** Idle rows have nothing to steer; the paused caption owns resuming. */
  guideHidden: boolean
  /** Accessible name of the guide/retry button. */
  guideLabel: string
  /** Tooltip of the guide/retry button: the target, or why it is unavailable. */
  guideTitle: string
  /** Tooltip / accessible name of the edit button (a block reason when disabled). */
  restoreLabel: string
  removeBlocked: boolean
}

export function queuedMessageRowState(
  message: QueuedComposerMessage,
  {
    running,
    guidanceTarget,
    pausedCaptionShown,
    hasGuide,
    hasRestore
  }: {
    running: boolean
    guidanceTarget: QueueGuidanceTarget
    pausedCaptionShown: boolean
    hasGuide: boolean
    hasRestore: boolean
  },
  t: Translate
): QueuedMessageRowState {
  const paused = message.deliveryState === 'paused'
  const failed = message.deliveryState === 'failed'
  const inFlight = message.deliveryState === 'in_flight'
  const starting = message.deliveryState === 'starting'
  const recoverable = paused || failed
  const canRestore = Boolean(hasRestore && message.composerRestoreEligible && !message.steeringRequest && !starting)
  const canGuide = Boolean(hasGuide && !message.editIntent && !starting && (message.steeringRequest || (recoverable
    ? !running && !message.waitForRuntimeAdmission
    : (
      running &&
      guidanceTarget !== 'unsupported' &&
      message.guidanceEligible !== false &&
      canGuideQueuedComposerMessage(message)
    ))))
  const guideLabel = recoverable ? t('queuedMessageRetry') : t('composerQueue.nowLabel')
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
        : guidanceTarget === 'unsupported'
          ? t('guideQueuedMessageUnsupported')
          : message.guidanceEligible === false || !canGuideQueuedComposerMessage(message)
            ? t('guideQueuedMessageTextOnly')
            : guidanceTarget === 'graph'
              ? t('guideQueuedMessageGraphHint')
              : guidanceTarget === 'deferred'
                ? t('guideQueuedMessageDeferredHint')
                : t('guideQueuedMessageHint')
  const guideHidden = (paused && pausedCaptionShown) ||
    (!failed && !paused && !running && !message.steeringRequest)
  const restoreLabel = canRestore
    ? t('queuedMessageEditInComposer')
    : t(message.composerRestoreBlockReason ?? 'queuedMessageEditUnsupported')
  return {
    paused,
    failed,
    inFlight,
    starting,
    recoverable,
    canRestore,
    canGuide,
    guideHidden,
    guideLabel,
    guideTitle,
    restoreLabel,
    removeBlocked: starting || Boolean(message.steeringRequest)
  }
}

export type QueuedMessageStatus =
  | { tone: 'muted'; label: string }
  | { tone: 'warning'; label: string }
  | { tone: 'danger'; label: string; detail?: string }

/** Delivery status chip text and tone, or null when the row needs none. */
export function queuedMessageStatus(
  message: QueuedComposerMessage,
  pausedCaptionShown: boolean,
  t: Translate
): QueuedMessageStatus | null {
  switch (message.deliveryState) {
    case 'starting':
      return { tone: 'muted', label: t('queuedMessageConfirming') }
    case 'paused':
      if (message.editIntent === 'restoring') return { tone: 'warning', label: t('queuedMessageRestorePending') }
      if (message.editIntent === 'cancelling') return { tone: 'warning', label: t('queuedMessageCancelPending') }
      return pausedCaptionShown ? null : { tone: 'warning', label: t('queuedMessagePaused') }
    case 'in_flight':
      return { tone: 'muted', label: t('queuedMessageInFlight') }
    case 'failed': {
      const detail = message.errorMessage || message.errorCode
      return { tone: 'danger', label: t('queuedMessageFailed'), ...(detail ? { detail } : {}) }
    }
    default:
      return null
  }
}
