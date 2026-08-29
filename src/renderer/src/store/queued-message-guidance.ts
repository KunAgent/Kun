import type { QueuedUserMessage } from './chat-store-types'
import type { RuntimeDisclosureMetadata } from '../agent/types'

export type QueuedMessageGuidanceInput = {
  text: string
  displayText?: string
  attachmentIds?: readonly unknown[]
  attachments?: readonly unknown[]
  fileReferences?: readonly unknown[]
  composerContexts?: readonly unknown[]
  guiPlan?: unknown
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: unknown
  writeContext?: unknown
}

export type QueuedMessageGuidancePayload = {
  text: string
  displayText?: string
  attachmentIds?: string[]
}

/**
 * Resolve the payload that can safely replace a queued send as live steering.
 * Design canvas turns queue an expanded internal prompt plus renderer-only
 * routing flags. The running Design turn already owns that canvas context, so
 * its visible user text is the correct steering payload.
 */
export function queuedMessageGuidancePayload(
  message: QueuedMessageGuidanceInput
): QueuedMessageGuidancePayload | null {
  const attachmentIds = normalizedAttachmentIds(message.attachmentIds)
  const hasAttachmentReferences = Boolean(message.attachments?.length)
  if (
    !message.text.trim() ||
    attachmentIds === null ||
    (hasAttachmentReferences && attachmentIds.length === 0) ||
    message.attachments?.some((attachment) => !isImageAttachmentReference(attachment)) ||
    message.fileReferences?.length ||
    message.composerContexts?.length ||
    message.guiDesignArtifact ||
    message.writeContext
  ) {
    return null
  }

  const hasDesignRouting = message.guiDesignCanvas === true || message.guiDesignMode === true
  if (hasDesignRouting) {
    const displayText = message.displayText?.trim()
    if (
      message.guiDesignCanvas !== true ||
      message.guiDesignMode !== true ||
      !displayText
    ) {
      return null
    }
    return {
      text: displayText,
      displayText,
      ...(attachmentIds.length ? { attachmentIds } : {})
    }
  }

  const text = message.text.trim()
  const displayText = message.displayText?.trim()
  return {
    text,
    ...(displayText ? { displayText } : {}),
    ...(attachmentIds.length ? { attachmentIds } : {})
  }
}

/** True when the steer contract can preserve the queued text and optional images. */
export function canGuideQueuedMessage(message: QueuedUserMessage): boolean {
  return queuedMessageGuidancePayload(message) !== null
}

function effectiveSurface(
  value: Pick<QueuedUserMessage, 'agentSurface' | 'guiDesignCanvas' | 'guiDesignMode'> |
    Pick<RuntimeDisclosureMetadata, 'agentSurface' | 'guiDesignCanvas' | 'guiDesignMode' | 'designProfile'>
): 'code' | 'write' | 'design' {
  if (value.agentSurface) return value.agentSurface
  if (value.guiDesignCanvas || value.guiDesignMode || ('designProfile' in value && value.designProfile)) {
    return 'design'
  }
  return 'code'
}

function sameSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** A queued send can steer only the turn whose immutable routing snapshot it matches. */
export function queuedMessageMatchesRunningTurn(
  message: QueuedUserMessage,
  running: RuntimeDisclosureMetadata | undefined
): boolean {
  const surface = effectiveSurface(message)
  if (!running || surface !== effectiveSurface(running)) return false
  const queuedIsPlan = message.mode === 'plan' || Boolean(message.guiPlan)
  const runningIsPlan = running.mode === 'plan'
  if (queuedIsPlan !== runningIsPlan) return false
  if (surface !== 'design') return true
  return sameSnapshot(message.designProfile, running.designProfile) &&
    sameSnapshot(message.designDocumentTarget, running.designDocumentTarget) &&
    sameSnapshot(message.designImagePlacementTarget, running.designImagePlacementTarget)
}

function normalizedAttachmentIds(values: readonly unknown[] | undefined): string[] | null {
  if (!values?.length) return []
  const ids = values.map((value) => typeof value === 'string' ? value.trim() : '')
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null
  return ids
}

function isImageAttachmentReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === undefined || kind === 'image'
}
