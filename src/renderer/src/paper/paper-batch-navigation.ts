import { getProvider } from '../agent/registry'
import { useChatStore } from '../store/chat-store'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { useWorkAssistantNavigation } from '../write/work-assistant-navigation'
import { captureFocusedDocument } from '../write/write-editor-layout'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { activeWriteThreadForWorkspace, readWriteThreadRegistry } from '../write/write-thread-registry'
import { paperModeView } from './paper-view'
import { usePaperBatchStore, type PaperBatch } from './paper-batch-store'

let navigationSequence = 0

/** Library-level batch conversations keep the pinned library view as their resource. */
export function focusPaperBatchLibrary(batch: PaperBatch): (targetThreadId?: string) => boolean {
  const workspace = useWriteWorkspaceStore.getState()
  if (workspace.workSurface !== 'papers' || normalizePath(workspace.workspaceRoot) !== normalizePath(batch.workspaceRoot)) {
    throw new Error('Return to the source paper library to open this batch conversation.')
  }
  const sequence = ++navigationSequence
  const chat = useChatStore.getState()
  const previousThreadId = chat.activeThreadId
  const libraryThreadId = activeWriteThreadForWorkspace(batch.workspaceRoot, chat.threads, readWriteThreadRegistry(), '')?.id
  // A virtual-tab focus neither closes nor saves the current document. Capture
  // its live projection so dirty edits and external-conflict state survive.
  useWriteWorkspaceStore.setState({ documentsByPath: captureFocusedDocument(workspace) })
  useWriteWorkspaceStore.getState().openPaperViewTab('library')
  useWriteWorkspaceStore.getState().setAssistantOpen(true)
  useWorkAssistantNavigation.getState().openAssistant()
  const layout = useWriteWorkspaceStore.getState().editorLayout
  return (targetThreadId) => {
    const current = useWriteWorkspaceStore.getState()
    return sequence === navigationSequence && usePaperBatchStore.getState().batch?.id === batch.id &&
      current.workSurface === 'papers' && normalizePath(current.workspaceRoot) === normalizePath(batch.workspaceRoot) &&
      current.editorLayout === layout && paperModeView(current) === 'library' &&
      useChatStore.getState().route === 'write' &&
      [previousThreadId, libraryThreadId, targetThreadId].includes(useChatStore.getState().activeThreadId ?? undefined)
  }
}

export async function selectPaperBatchConversation(batch: PaperBatch, activationGuard: (targetThreadId?: string) => boolean): Promise<void> {
  if (!batch.threadId || !activationGuard(batch.threadId)) return
  let recovered = useChatStore.getState().threads.find((thread) => thread.id === batch.threadId)
  if (!recovered) {
    const provider = getProvider()
    if (!provider.getThreadSummary) throw new Error('Refresh conversation history before opening this result.')
    recovered = await provider.getThreadSummary(batch.threadId)
    if (!activationGuard(batch.threadId)) return
    if (recovered.id !== batch.threadId || normalizePath(recovered.workspace ?? '') !== normalizePath(batch.workspaceRoot)) {
      throw new Error('The batch conversation no longer belongs to this paper library.')
    }
  }
  // Reuse the canonical registry. Guarded selectThread avoids a late response
  // forcing the user back after they open another paper, library or surface.
  const thread = recovered
  useChatStore.setState((state) => ({ threads: state.threads.some((row) => row.id === thread.id) ? state.threads : [thread, ...state.threads] }))
  await useChatStore.getState().selectWriteThread(batch.threadId, batch.workspaceRoot, '', { activationGuard: () => activationGuard(batch.threadId) })
}
