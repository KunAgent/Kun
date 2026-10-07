import { useEffect } from 'react'
import type { RoomContentReference, WorkbenchDirectory } from '@shared/rooms-api'
import i18n from '../../i18n'
import { readBrowserStorageItem, subscribeBrowserStorageMutations, writeBrowserStorageItem } from '../../lib/browser-storage'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'
import { workbenchClient } from './workbench-client'
import { showWorkbenchFlash } from './workbench-flash'
import { AGENT_CHAT_SELECTED_KEY, openAgentConversationRoom } from './agent-chat-navigation'

const tr = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'common', ...options })

/** Rooms prefers its current Agent DM; other surfaces prefer the Code Agent shortcut. */
export async function resolveBotRoomId(route = useChatStore.getState().route): Promise<string | null> {
  const roomsSelected = readBrowserStorageItem('kun.rooms.selected')
  const codeSelected = readBrowserStorageItem(AGENT_CHAT_SELECTED_KEY)
  const page = await roomsClient.list(false, undefined, undefined, '', { conversationKind: 'user_agent' })
  for (const selected of route === 'rooms' ? [roomsSelected, codeSelected] : [codeSelected, roomsSelected]) {
    if (selected && page.rooms.some((room) => room.id === selected)) return selected
  }
  if (page.rooms[0]) return page.rooms[0].id
  const entry = await roomsRequest<{ roomId?: string }>('/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: roomRequestId() })
  return entry.roomId ?? null
}

type StoredDraft = { body?: string; references?: RoomContentReference[]; [key: string]: unknown }
const referenceKey = (reference: RoomContentReference): string => JSON.stringify({ ...reference, titleSnapshot: undefined })

/**
 * Merge text and references into a private chat's stored draft and tell an
 * open composer to reload it. Nothing is sent; repeating the same text is a no-op.
 */
export function appendRoomDraft(roomId: string, input: { references?: RoomContentReference[]; body?: string }): void {
  const key = `kun.rooms.draft.${roomId}`
  let draft: StoredDraft = {}
  try { draft = JSON.parse(readBrowserStorageItem(key) ?? '{}') as StoredDraft } catch { draft = {} }
  const existing = Array.isArray(draft.references) ? draft.references : []
  const merged = [...existing, ...(input.references ?? []).filter((reference) => !existing.some((item) => referenceKey(item) === referenceKey(reference)))].slice(0, 20)
  const previous = draft.body?.trim() ?? '', added = input.body?.trim() ?? ''
  const body = added && previous.includes(added) ? previous : [previous, added].filter(Boolean).join('\n\n')
  writeBrowserStorageItem(key, JSON.stringify({ mentions: [], taskId: '', repositoryId: '', intent: 'auto', attachments: [], requestId: '', fingerprint: '',
    ...draft, body, references: merged }))
  window.dispatchEvent(new CustomEvent('kun-room-draft-updated', { detail: { roomId } }))
}

/**
 * Put content in front of the bot without sending anything: the references and
 * optional text land in the private chat's draft, and the user decides what to ask.
 */
export async function sendReferencesToBot(input: { references: RoomContentReference[]; body?: string }): Promise<void> {
  const route = useChatStore.getState().route
  const selectionKeys = ['kun.rooms.selected', AGENT_CHAT_SELECTED_KEY]
  const selections = selectionKeys.map(readBrowserStorageItem)
  let navigated = false
  const offRoute = useChatStore.subscribe((state, previous) => {
    if (state.route !== previous.route || state.activeThreadId !== previous.activeThreadId ||
      state.workspaceRoot !== previous.workspaceRoot) navigated = true
  })
  const offSelection = subscribeBrowserStorageMutations(({ key }) => {
    if (selectionKeys.includes(key)) navigated = true
  })
  try {
    const roomId = await resolveBotRoomId(route)
    if (!roomId) return showWorkbenchFlash(tr('roomsWorkbenchNoBot'), 'error')
    appendRoomDraft(roomId, input)
    if (navigated || useChatStore.getState().route !== route ||
      selectionKeys.some((key, index) => readBrowserStorageItem(key) !== selections[index])) return
    if (route === 'rooms') {
      writeBrowserStorageItem('kun.rooms.selected', roomId)
      window.dispatchEvent(new CustomEvent('kun-room-open', { detail: { roomId } }))
    } else openAgentConversationRoom(roomId)
  } catch (cause) {
    showWorkbenchFlash(cause instanceof Error ? cause.message : String(cause), 'error')
  } finally {
    offRoute(); offSelection()
  }
}

export const sendThreadToBot = (thread: { id: string; title: string }): Promise<void> =>
  sendReferencesToBot({ references: [{ kind: 'code_thread', threadId: thread.id, titleSnapshot: thread.title.slice(0, 300) }] })

export const sendWorkDocumentToBot = (input: { workspaceRoot: string; relativePath: string; excerpt?: string }): Promise<void> =>
  sendReferencesToBot({
    references: [{ kind: 'work_document', workspaceRoot: input.workspaceRoot, relativePath: input.relativePath,
      titleSnapshot: input.relativePath.split('/').at(-1) ?? input.relativePath }],
    ...(input.excerpt?.trim() ? { body: '> ' + input.excerpt.trim().slice(0, 4000).replace(/\n/g, '\n> ') } : {})
  })

/** A board card has no citation form a private chat can resolve, so it travels as plain text. */
export const sendBoardCardToBot = (card: { title: string; description: string; workspaceRoot: string; priority?: string | null }): Promise<void> =>
  sendReferencesToBot({ references: [], body: [
    `${tr('roomsWorkbenchBoardCardLead')} ${card.title}${card.priority ? ` (${card.priority})` : ''}`,
    card.description.trim(), `${tr('roomsWorkbenchProject')}: ${card.workspaceRoot}`].filter(Boolean).join('\n') })

/** Splits an absolute file path into the registered Work workspace that holds it and the path inside. */
export function workRelativePath(filePath: string, roots: readonly string[]): { root: string; relativePath: string } | null {
  const normalized = filePath.replace(/\\/g, '/')
  let best: { root: string; relativePath: string } | null = null
  for (const root of roots) {
    const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!base || !normalized.startsWith(base + '/')) continue
    if (!best || base.length > best.root.length) best = { root, relativePath: normalized.slice(base.length + 1) }
  }
  return best
}

/** Hand the open Work document to the bot as a citation in its chat draft. */
export async function sendWorkFileToBot(filePath: string, excerpt?: string): Promise<void> {
  const located = workRelativePath(filePath, useWriteWorkspaceStore.getState().workspaceRoots)
  if (!located) return showWorkbenchFlash(tr('roomsWorkbenchNoWorkspace'), 'error')
  return sendWorkDocumentToBot({ workspaceRoot: located.root, relativePath: located.relativePath, ...(excerpt ? { excerpt } : {}) })
}

/** "Tell me when this session finishes": the bot posts a card when the running turn ends. */
export async function watchThreadWithBot(thread: { id: string; title: string }): Promise<void> {
  try {
    const roomId = await resolveBotRoomId()
    if (!roomId) return showWorkbenchFlash(tr('roomsWorkbenchNoBot'), 'error')
    await workbenchClient.watch(roomId, thread.id, thread.title)
    showWorkbenchFlash(tr('roomsWorkbenchWatchStarted'))
  } catch (cause) {
    showWorkbenchFlash(cause instanceof Error ? cause.message : String(cause), 'error')
  }
}

const sameDirectory = (a: WorkbenchDirectory | null, b: WorkbenchDirectory) => a !== null && JSON.stringify(a) === JSON.stringify(b)

/**
 * Kun cannot discover Work workspaces or the user's Code projects on its own,
 * so the desktop shell pushes them whenever they change. The snapshot survives a
 * runtime restart, so a failed push only delays a bot's access, never loses it.
 */
export function useWorkbenchDirectorySync(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: WorkbenchDirectory | null = null
    let attempts = 0
    let stopped = false
    const push = async () => {
      const work = useWriteWorkspaceStore.getState()
      const directory: WorkbenchDirectory = {
        workRoots: [...new Set(work.workspaceRoots.filter(Boolean))].slice(0, 50),
        ...(work.defaultWorkspaceRoot ? { defaultWorkRoot: work.defaultWorkspaceRoot } : {}),
        codeProjects: [...new Set(useChatStore.getState().codeWorkspaceRoots.filter(Boolean))].slice(0, 200)
      }
      if (sameDirectory(last, directory)) return
      try {
        await workbenchClient.setDirectory(directory)
        last = directory
        attempts = 0
      } catch {
        if (!stopped && attempts++ < 6) timer = setTimeout(() => void push(), 5000 * attempts)
      }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void push(), 800) }
    schedule()
    const offWork = useWriteWorkspaceStore.subscribe((state, previous) => {
      if (state.workspaceRoots !== previous.workspaceRoots || state.defaultWorkspaceRoot !== previous.defaultWorkspaceRoot) schedule()
    })
    const offCode = useChatStore.subscribe((state, previous) => { if (state.codeWorkspaceRoots !== previous.codeWorkspaceRoots) schedule() })
    return () => { stopped = true; clearTimeout(timer); offWork(); offCode() }
  }, [enabled])
}
