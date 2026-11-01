import type { UserTurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'

const PLACEHOLDERS = new Set(['Write Assistant', 'New Thread', 'New chat', '新会话', 'Untitled', '未命名'])
const WORK_CONTEXT = '[写作上下文]'
const MAX_TITLE_LENGTH = 48
// Match the maximum durable item size when a legacy prompt needs its full context removed.
const MAX_LEGACY_ITEM_BYTES = 16 * 1024 * 1024

type TitleDeps = {
  threadStore: ThreadStore
  sessionStore: Pick<SessionStore, 'loadItemPage'>
  events: Pick<RuntimeEventRecorder, 'record'>
}

function isWorkPlaceholder(thread: ThreadRecord): boolean {
  const title = thread.title.trim()
  return thread.titleAuto !== false && thread.status !== 'archived' && thread.status !== 'deleted' &&
    resolveThreadAgentSurface(thread) === 'write' &&
    (!title || PLACEHOLDERS.has(title) || title.startsWith(WORK_CONTEXT) ||
      (thread.id.length > 8 && title === thread.id.slice(0, 8)))
}

/** Prefer what the user saw, not Work's older host-authored context envelope. */
export function workUserTitleText(item: UserTurnItem): string {
  if (item.messageSource) return ''
  let text = item.displayText?.trim() || item.text.trim()
  if (text.startsWith(WORK_CONTEXT)) {
    const end = text.indexOf('\n\n')
    if (end < 0) return ''
    text = text.slice(end + 2).trimStart()
  }
  while (text.startsWith('[引用片段]')) {
    const end = text.indexOf('[/引用原文]')
    if (end < 0) return ''
    text = text.slice(end + '[/引用原文]'.length).trimStart()
  }
  for (const [start, end] of [
    ['[Office 文档上下文]', '[/Office 文档上下文]'],
    ['[相关文献上下文]', '[/相关文献上下文]']
  ]) {
    if (!text.startsWith(start)) continue
    const index = text.indexOf(end)
    if (index < 0) return ''
    text = text.slice(index + end.length).trimStart()
  }
  return text || item.fileReferences?.[0]?.name.trim() || ''
}

export function deriveWorkSessionTitle(item: UserTurnItem): string {
  const text = workUserTitleText(item)
  const line = text.split(/\r?\n/)
    .filter((value) => !/^\s*(```|~~~)/.test(value))
    .map((value) => value.replace(/^#{1,6}\s+|^>\s+|^[-*+]\s+|^\d+[.)]\s+/g, '')
      .replace(/`+/g, '').replace(/\[(.*?)\]\((.*?)\)/g, '$1').replace(/\s+/g, ' ').trim())
    .find(Boolean) ?? ''
  if (!line) return ''
  const sentenceBreak = line.search(/[。！？.!?]/)
  const core = sentenceBreak >= 8 ? line.slice(0, sentenceBreak) : line
  const chars = Array.from(core)
  const sliced = chars.slice(0, MAX_TITLE_LENGTH).join('')
  const lastSpace = sliced.lastIndexOf(' ')
  const shortened = chars.length > MAX_TITLE_LENGTH
    ? `${(lastSpace >= 18 ? sliced.slice(0, lastSpace) : sliced).trim()}...`
    : sliced
  return shortened.replace(/[\s,.;:!?，。；：！？、'"`()[\]{}]+$/g, '').trim()
}

/** Name only a still-untitled Work session, without changing its activity time. */
export async function recoverWorkSessionTitle(
  deps: TitleDeps,
  threadId: string,
  admittedItem?: UserTurnItem
): Promise<ThreadRecord | null> {
  let snapshot = deps.threadStore.getMetadata
    ? await deps.threadStore.getMetadata(threadId)
    : await deps.threadStore.get(threadId)
  if (snapshot && !isWorkPlaceholder(snapshot) && !snapshot.agentSurface && snapshot.titleAuto !== false &&
    (snapshot.title.trim() === 'Write Assistant' || snapshot.title.trim().startsWith(WORK_CONTEXT))) {
    // Pre-surface Work ownership may require inspecting the legacy turn envelope.
    snapshot = await deps.threadStore.get(threadId)
  }
  if (!snapshot || !isWorkPlaceholder(snapshot)) return null
  const firstTurn = snapshot.turns.find((turn) => !turn.messageSource)
  if (!firstTurn || (admittedItem && admittedItem.turnId !== firstTurn.id)) return null
  let item = admittedItem
  if (!item) {
    const page = await deps.sessionStore.loadItemPage?.(threadId, {
      turnId: firstTurn.id, anchorTurnId: firstTurn.id, maxItems: 2, maxBytes: 64 * 1024
    })
    item = page?.items.find((candidate): candidate is UserTurnItem =>
      candidate.kind === 'user_message' && !candidate.messageSource)
      ?? firstTurn.items.find((candidate): candidate is UserTurnItem =>
        candidate.kind === 'user_message' && !candidate.messageSource)
    if (!item && !deps.sessionStore.loadItemPage) {
      const full = await deps.threadStore.get(threadId)
      item = full?.turns.find((turn) => turn.id === firstTurn.id)?.items.find(
        (candidate): candidate is UserTurnItem => candidate.kind === 'user_message' && !candidate.messageSource)
    }
  }
  // Oversized timeline records may be replaced entirely with this marker.
  const minimalPreview = !admittedItem && item?.text === '[timeline item truncated]'
  let title = !minimalPreview && item ? deriveWorkSessionTitle(item) : ''
  if (!title && item && !item.displayText?.trim() && deps.sessionStore.loadItemPage) {
    // Timeline pages can truncate the hidden document context before its closing
    // marker. Re-read only the opening user item at the durable record limit.
    const page = await deps.sessionStore.loadItemPage(threadId, {
      turnId: firstTurn.id, anchorTurnId: firstTurn.id, maxItems: 1, maxBytes: MAX_LEGACY_ITEM_BYTES
    })
    const fullItem = page.items.find((candidate): candidate is UserTurnItem =>
      candidate.kind === 'user_message' && candidate.id === item?.id && !candidate.messageSource)
    title = fullItem && fullItem.text !== '[timeline item truncated]' ? deriveWorkSessionTitle(fullItem) : ''
  }
  if (!title) return null

  const result = await withThreadStoreMutation(deps.threadStore, threadId, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await deps.threadStore.get(threadId)
      if (!current || !isWorkPlaceholder(current) ||
        current.turns.find((turn) => !turn.messageSource)?.id !== firstTurn.id) return null
      // Legacy Work ownership can depend on the placeholder title itself.
      const next = { ...current, title, titleAuto: true, agentSurface: 'write' as const }
      let updated: ThreadRecord
      if (!deps.threadStore.upsertIfRevision) {
        updated = await deps.threadStore.upsert(next)
      } else {
        const result = await deps.threadStore.upsertIfRevision(next, current.revision ?? 0)
        if (!result.applied) continue
        updated = result.thread ?? { ...next, revision: result.revision }
      }
      // Queue publication before a later rename can queue its event, but do not
      // wait for event observers while holding the thread mutation queue.
      const notification = deps.events.record({
        kind: 'thread_updated', threadId, title: updated.title, titleAuto: true,
        agentSurface: 'write', status: updated.status
      }).catch((error) => {
        console.warn('[kun] Work session title event could not be recorded:', error instanceof Error ? error.message : String(error))
      })
      return { updated, notification }
    }
    return null
  })
  if (!result) return null
  await result.notification
  return result.updated
}
