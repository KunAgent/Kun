import {
  MAX_COMPOSER_CONTEXT_ATTACHMENTS,
  type ComposerContextAttachment
} from '@kun/extension-api'
import { isWorkspaceOfficeViewPositionAttachment } from '../lib/workspace-office-view-context'
import { isWriteTurnReferenceAttachment } from '../write/write-turn-reference-context'
import type { ChatState } from './chat-store-types'

export function mergeTurnComposerContexts(
  primary: readonly ComposerContextAttachment[],
  pending: readonly ComposerContextAttachment[]
): ComposerContextAttachment[] {
  const merged: ComposerContextAttachment[] = []
  const seen = new Set<string>()
  for (const context of [...primary, ...pending]) {
    if (seen.has(context.attachmentId)) continue
    seen.add(context.attachmentId)
    merged.push(context)
    if (merged.length === MAX_COMPOSER_CONTEXT_ATTACHMENTS) break
  }
  return merged
}

export function routeComposerContexts(
  route: ChatState['route'],
  primary: readonly ComposerContextAttachment[],
  pending: readonly ComposerContextAttachment[]
): ComposerContextAttachment[] {
  if (route === 'chat') return mergeTurnComposerContexts(primary, pending)
  if (route === 'write') {
    const currentView = primary.find(isWorkspaceOfficeViewPositionAttachment)
    const references = primary.filter(isWriteTurnReferenceAttachment)
    const pptContexts = primary.filter((context) =>
      'source' in context.provenance &&
      context.provenance.source === 'dev-preview' &&
      (context.reference.kind === 'ppt-review' || context.reference.kind === 'ppt-direction'))
    return mergeTurnComposerContexts(
      [...references, ...(currentView ? [currentView] : []), ...pptContexts],
      []
    )
  }
  return []
}
