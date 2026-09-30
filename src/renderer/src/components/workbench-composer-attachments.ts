import type { AttachmentReference } from '../agent/types'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../extensions/contribution-ids'

export const COMPOSER_ATTACHMENT_SCOPES = ['chat', 'ade', 'write', 'design', 'sdd', 'inactive'] as const

export type ComposerAttachmentScope = (typeof COMPOSER_ATTACHMENT_SCOPES)[number]
export type ComposerAttachmentsByScope = Record<ComposerAttachmentScope, AttachmentReference[]>
export type ComposerAttachmentUpdater =
  | AttachmentReference[]
  | ((current: AttachmentReference[]) => AttachmentReference[])

export function createEmptyComposerAttachmentsByScope(): ComposerAttachmentsByScope {
  return {
    chat: [],
    ade: [],
    write: [],
    design: [],
    sdd: [],
    inactive: []
  }
}

export function composerAttachmentScopeForSurface(
  route: string,
  rightPanelMode: RightPanelMode | null
): ComposerAttachmentScope {
  if (route === 'ade') return 'ade'
  if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) return 'sdd'
  if (route === 'design') return 'design'
  if (route === 'write') return 'write'
  if (route === 'chat') return 'chat'
  return 'inactive'
}

export function updateComposerAttachmentsByScope(
  current: ComposerAttachmentsByScope,
  scope: ComposerAttachmentScope,
  updater: ComposerAttachmentUpdater
): ComposerAttachmentsByScope {
  const previous = current[scope]
  const next = typeof updater === 'function' ? updater(previous) : updater
  if (next === previous) return current
  return {
    ...current,
    [scope]: next
  }
}

export function removeComposerAttachmentsById(
  current: AttachmentReference[],
  ids: readonly string[]
): AttachmentReference[] {
  if (ids.length === 0) return current
  const capturedIds = new Set(ids)
  return current.filter((attachment) => !capturedIds.has(attachment.id))
}
