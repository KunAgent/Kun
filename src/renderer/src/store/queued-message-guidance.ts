import type { QueuedUserMessage } from './chat-store-types'
import type { RuntimeDisclosureMetadata } from '../agent/types'
import { parseWritePromptForDisplay } from '../write/quoted-selection'

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
  paperContext?: unknown
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
  // Work sends carry the open document as context; the running turn already
  // holds it, so only the user's own words (and @files) need to steer.
  const workSteer = Boolean(message.writeContext) && !message.paperContext && !message.composerContexts?.length
  if (
    !message.text.trim() ||
    attachmentIds === null ||
    (hasAttachmentReferences && attachmentIds.length === 0) ||
    message.attachments?.some((attachment) => !isImageAttachmentReference(attachment)) ||
    (!workSteer && (message.fileReferences?.length || message.writeContext)) ||
    message.composerContexts?.length ||
    message.guiDesignArtifact ||
    message.paperContext
  ) {
    return null
  }

  if (workSteer) {
    const userInput = message.displayText?.trim() || parseWritePromptForDisplay(message.text)?.userInput.trim() || ''
    if (!userInput) return null
    const refs = (message.fileReferences ?? []).map(fileReferenceLabel).filter(Boolean)
    const text = refs.length ? `${userInput}\n\n${refs.map((ref) => `@${ref}`).join('\n')}` : userInput
    return { text, displayText: userInput, ...(attachmentIds.length ? { attachmentIds } : {}) }
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

function fileReferenceLabel(value: unknown): string {
  const ref = (value && typeof value === 'object' ? value : {}) as { relativePath?: unknown; path?: unknown }
  const label = ref.relativePath || ref.path
  return typeof label === 'string' ? label : ''
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
