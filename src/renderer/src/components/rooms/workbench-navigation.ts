import type { WorkbenchLinkEntry } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { openRoomContentTarget } from './room-content-navigation'

type ThreadOpener = (threadId: string, turnId?: string) => void | Promise<void>
let threadOpener: ThreadOpener | null = null

/**
 * The Rooms view owns the Workbench's "open this Code session" navigation.
 * Cards deep inside the timeline reach it through this registration instead of
 * threading a callback through every row.
 */
export function registerRoomThreadOpener(opener: ThreadOpener | null): () => void {
  threadOpener = opener
  return () => { if (threadOpener === opener) threadOpener = null }
}
export const canOpenRoomThread = (): boolean => threadOpener !== null

/** A phone controls the desktop's runtime; Code, Work and the board only open on the desktop itself. */
const onMobileSurface = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.remoteSurface === 'mobile'

/** Where a link's outcome lives, so the card can offer the right "open" action. */
export function workbenchOpenTarget(link: Pick<WorkbenchLinkEntry, 'kind' | 'threadId' | 'result' | 'request'>): 'code' | 'work' | 'board' | null {
  if (onMobileSurface()) return null
  if (link.kind === 'board_card') return link.result?.cardId && link.request.workspaceRoot ? 'board' : null
  if (link.kind === 'work_document' || link.kind === 'work_edit') return link.request.workspaceRoot && link.request.relativePath ? 'work' : null
  if (link.kind === 'work_task') return link.request.workspaceRoot ? 'work' : null
  return link.threadId && canOpenRoomThread() ? 'code' : null
}

export async function openWorkbenchLinkTarget(link: WorkbenchLinkEntry): Promise<void> {
  const root = link.request.workspaceRoot ?? ''
  if (link.kind === 'board_card' && root && link.result?.cardId) {
    return openRoomContentTarget({ kind: 'board', workspaceRoot: root, cardId: link.result.cardId }, async () => undefined, link.roomId)
  }
  if ((link.kind === 'work_document' || link.kind === 'work_edit') && root && link.request.relativePath) {
    return openRoomContentTarget({ kind: 'work_file', workspaceRoot: root, relativePath: link.request.relativePath }, async () => undefined, link.roomId)
  }
  if (link.kind === 'work_task' && root) {
    await useWriteWorkspaceStore.getState().selectWriteWorkspace(root)
    useChatStore.getState().setRoute('write')
    return
  }
  if (link.threadId && threadOpener) await threadOpener(link.threadId)
}
