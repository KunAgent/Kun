import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment
} from '@kun/extension-api'
import { useShallow } from 'zustand/react/shallow'
import { COMPOSER_FOCUS_REQUEST_EVENT } from '../components/chat/floating-composer-commands'
import type { TrayTone } from '../components/chat/composer-tray/tray-kind'
import { useChatStore } from '../store/chat-store'
import { workspaceRootScopeKey } from './workspace-path'

export const TRAY_REFERENCE_KIND = 'tray-reference'

const VALID_TONES = new Set<TrayTone>(['default', 'running', 'waiting', 'error', 'done'])

export type TrayReferenceDraft =
  | {
      targetKind: 'worker'
      targetId: string
      title: string
      statusLabel: string
      tone: TrayTone
      seat: number
      color: string
      note?: string
    }
  | {
      targetKind: 'todo'
      targetId: string
      stepIndex: number
      totalSteps: number
      title: string
      statusLabel: string
      tone: TrayTone
      note?: string
      ownerLabel?: string
      sourceLabel?: string
    }

export type TrayReferenceDisplay = {
  targetKind: 'worker' | 'todo'
  targetId: string
  badge: string
  title: string
  statusLabel: string
  tone: TrayTone
  note?: string
  seat?: number
  color?: string
  stepIndex?: number
  totalSteps?: number
  ownerLabel?: string
  sourceLabel?: string
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function clipCodePoints(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : value
}

/**
 * ComposerContextReferenceSchema rejects strings that start like absolute
 * filesystem paths (`/…`, `file:…`, `C:\…`). Prefixing free text when needed
 * keeps arbitrary task titles or worker notes valid without losing content.
 */
export function safeReferenceString(raw: string | undefined, max = 600): string | undefined {
  const trimmed = raw?.replace(/\s+/g, ' ').trim() ?? ''
  if (!trimmed) return undefined
  const clipped = clipCodePoints(trimmed, max)
  return /^(?:file:|\/|\\\\|[A-Za-z]:[\\/])/i.test(clipped) ? `· ${clipped}` : clipped
}

function normalizeTone(value: unknown): TrayTone {
  return typeof value === 'string' && VALID_TONES.has(value as TrayTone)
    ? (value as TrayTone)
    : 'default'
}

export async function createTrayReferenceAttachment(input: {
  workspaceRoot: string
  threadId?: string | null
  draft: TrayReferenceDraft
  now?: number
}): Promise<ComposerContextAttachment> {
  const { draft } = input
  const workspaceId = await sha256Hex(input.workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(JSON.stringify({
    workspaceId,
    threadId: input.threadId ?? '',
    targetKind: draft.targetKind,
    targetId: draft.targetId
  }))
  const cleanTitle = draft.title.replace(/\s+/g, ' ').trim() || draft.targetId
  const badge = draft.targetKind === 'todo' ? `#${draft.stepIndex}` : '@'
  const displayTitle = draft.targetKind === 'todo'
    ? clipCodePoints(`${badge} ${cleanTitle}`, 120)
    : clipCodePoints(`@${cleanTitle}`, 120)
  const note = safeReferenceString(draft.note, 500)
  const statusLabel = safeReferenceString(draft.statusLabel, 80) ?? draft.targetKind
  const summaryParts = [draft.statusLabel.trim(), draft.note?.replace(/\s+/g, ' ').trim()].filter(Boolean)
  const summary = clipCodePoints(summaryParts.join(' · ') || cleanTitle, 800)

  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `tray-ref-${identity.slice(0, 24)}`,
    title: displayTitle,
    summary,
    reference: {
      kind: TRAY_REFERENCE_KIND,
      schemaVersion: 1,
      targetKind: draft.targetKind,
      targetKey: `id:${clipCodePoints(draft.targetId, 200)}`,
      badge,
      itemTitle: safeReferenceString(cleanTitle, 300) ?? draft.targetKind,
      statusLabel,
      tone: draft.tone,
      ...(note ? { note } : {}),
      ...(draft.targetKind === 'worker'
        ? {
            seat: Math.max(0, Math.floor(draft.seat)),
            ...(safeReferenceString(draft.color, 32) ? { color: safeReferenceString(draft.color, 32) } : {})
          }
        : {
            stepIndex: Math.max(1, Math.floor(draft.stepIndex)),
            totalSteps: Math.max(1, Math.floor(draft.totalSteps)),
            ...(safeReferenceString(draft.ownerLabel, 120) ? { ownerLabel: safeReferenceString(draft.ownerLabel, 120) } : {}),
            ...(safeReferenceString(draft.sourceLabel, 200) ? { sourceLabel: safeReferenceString(draft.sourceLabel, 200) } : {})
          })
    },
    revision: Math.max(0, Math.floor(input.now ?? Date.now())),
    generation: 0,
    attachmentId: `workspace-selection-context:${identity}`,
    provenance: { source: 'workspace-selection', workspaceId }
  })
}

export function trayReferenceFromComposerContext(
  attachment: ComposerContextAttachment
): TrayReferenceDisplay | null {
  const ref = attachment.reference as Record<string, unknown>
  if (ref.kind !== TRAY_REFERENCE_KIND) return null
  const targetKind = ref.targetKind === 'worker' || ref.targetKind === 'todo' ? ref.targetKind : null
  const targetKey = typeof ref.targetKey === 'string' ? ref.targetKey : ''
  const targetId = targetKey.startsWith('id:') ? targetKey.slice(3) : ''
  if (!targetKind || !targetId) return null
  const itemTitle = typeof ref.itemTitle === 'string' && ref.itemTitle.trim()
    ? ref.itemTitle.replace(/^· /, '')
    : attachment.title
  const badge = typeof ref.badge === 'string' && ref.badge.trim()
    ? ref.badge
    : targetKind === 'todo' ? '#' : '@'
  const statusLabel = typeof ref.statusLabel === 'string' ? ref.statusLabel.replace(/^· /, '') : ''
  const note = typeof ref.note === 'string' && ref.note.trim() ? ref.note.replace(/^· /, '') : undefined
  return {
    targetKind,
    targetId,
    badge,
    title: itemTitle,
    statusLabel,
    tone: normalizeTone(ref.tone),
    ...(note ? { note } : {}),
    ...(typeof ref.seat === 'number' ? { seat: ref.seat } : {}),
    ...(typeof ref.color === 'string' ? { color: ref.color } : {}),
    ...(typeof ref.stepIndex === 'number' ? { stepIndex: ref.stepIndex } : {}),
    ...(typeof ref.totalSteps === 'number' ? { totalSteps: ref.totalSteps } : {}),
    ...(typeof ref.ownerLabel === 'string' ? { ownerLabel: ref.ownerLabel.replace(/^· /, '') } : {}),
    ...(typeof ref.sourceLabel === 'string' ? { sourceLabel: ref.sourceLabel.replace(/^· /, '') } : {})
  }
}

function activeComposerWorkspaceRoot(state = useChatStore.getState()): string {
  const threadWorkspace = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
    : undefined
  return threadWorkspace?.trim() || state.workspaceRoot?.trim() || ''
}

function composerRouteSupportsTrayReference(route: string): boolean {
  return route === 'chat' || route === 'ade'
}

function focusPrimaryComposer(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_REQUEST_EVENT))
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(
      '[data-primary-floating-composer] .ds-composer-textarea, .ds-floating-composer .ds-composer-textarea'
    )?.focus()
  })
}

export type ToggleTrayReferenceResult = 'attached' | 'removed' | 'unavailable'

/**
 * Toggles a Worker or Todo reference chip in the active conversation composer.
 * Clicking an unreferenced row attaches it and focuses the composer while
 * keeping the tray sheet open so several items can be referenced together.
 */
export async function toggleTrayReference(draft: TrayReferenceDraft): Promise<ToggleTrayReferenceResult> {
  const initial = useChatStore.getState()
  if (!composerRouteSupportsTrayReference(initial.route)) return 'unavailable'
  const workspaceRoot = activeComposerWorkspaceRoot(initial)
  const scopeKey = workspaceRootScopeKey(workspaceRoot)
  const threadId = initial.activeThreadId ?? undefined

  const existing = initial.extensionComposerContexts.find((event) => {
    if (workspaceRootScopeKey(event.workspaceRoot) !== scopeKey) return false
    if (event.threadId && event.threadId !== initial.activeThreadId) return false
    const parsed = trayReferenceFromComposerContext(event.attachment)
    return parsed?.targetKind === draft.targetKind && parsed.targetId === draft.targetId
  })
  if (existing) {
    initial.removeComposerContext(existing.attachment.attachmentId)
    focusPrimaryComposer()
    return 'removed'
  }

  const attachment = await createTrayReferenceAttachment({ workspaceRoot, threadId, draft })
  const current = useChatStore.getState()
  if (!composerRouteSupportsTrayReference(current.route) || current.activeThreadId !== (threadId ?? null)) {
    return 'unavailable'
  }
  current.attachComposerContext({
    workspaceRoot,
    ...(threadId ? { threadId } : {}),
    attachment
  })
  const attached = useChatStore.getState().extensionComposerContexts.some(
    (event) => event.attachment.attachmentId === attachment.attachmentId
  )
  if (attached) focusPrimaryComposer()
  return attached ? 'attached' : 'unavailable'
}

export function useCanReferenceInComposer(compact: boolean): boolean {
  return useChatStore((state) => !compact && composerRouteSupportsTrayReference(state.route))
}

export function useReferencedTrayTargetIds(targetKind: 'worker' | 'todo'): readonly string[] {
  return useChatStore(useShallow((state) => {
    if (!composerRouteSupportsTrayReference(state.route)) return []
    const scopeKey = workspaceRootScopeKey(activeComposerWorkspaceRoot(state))
    const ids: string[] = []
    for (const event of state.extensionComposerContexts) {
      if (workspaceRootScopeKey(event.workspaceRoot) !== scopeKey) continue
      if (event.threadId && event.threadId !== state.activeThreadId) continue
      const parsed = trayReferenceFromComposerContext(event.attachment)
      if (parsed?.targetKind === targetKind) ids.push(parsed.targetId)
    }
    return ids
  }))
}
