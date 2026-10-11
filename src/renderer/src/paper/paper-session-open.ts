import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'
import { openLibraryEntry } from './paper-library-actions'

/**
 * Open a paper together with one of its sessions (a reading or a batch
 * interpretation): the session becomes current and the paper's reader opens
 * next to it, in the space the paper belongs to.
 */
export async function openPaperSession(workspaceRoot: string, threadId: string, unitDir: string): Promise<void> {
  const root = normalizePath(workspaceRoot)
  if (normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== root) {
    await useWriteWorkspaceStore.getState().selectWriteWorkspace(root)
    if (normalizePath(useWriteWorkspaceStore.getState().workspaceRoot) !== root) return
  }
  await useChatStore.getState().selectWriteThread(threadId, root)
  const entry = usePaperModeStore.getState().entries.find((candidate) => candidate.unitDir === unitDir)
  if (entry) await openLibraryEntry(entry, root)
  useWriteWorkspaceStore.getState().setAssistantOpen(true)
}
