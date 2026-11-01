import type { NormalizedThread } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import { useCodeCanvasDesignSurface } from '../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../lib/code-canvas-panel-event'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import type { LibraryArtifact, LibraryArtifactKind } from './artifact-types'
import { COMPOSER_PREFILL_EVENT, type ComposerPrefillDetail } from './composer-prefill'

/** Conversation that produced the artifact: recorded by the source, or the thread bound to a design draft. */
export function sourceThreadFor(
  artifact: LibraryArtifact,
  threads: readonly NormalizedThread[]
): NormalizedThread | null {
  if (artifact.sourceThreadId) {
    const recorded = threads.find((thread) => thread.id === artifact.sourceThreadId)
    if (recorded) return recorded
  }
  if (artifact.designDocumentId) {
    const root = normalizeWorkspaceRoot(artifact.workspaceRoot)
    return threads.find((thread) =>
      thread.designProfile?.documentTarget.documentId === artifact.designDocumentId &&
      normalizeWorkspaceRoot(thread.workspace) === root
    ) ?? null
  }
  return null
}

async function ensureConversation(artifact: LibraryArtifact): Promise<string | null> {
  const store = useChatStore.getState()
  const source = sourceThreadFor(artifact, store.threads)
  if (source) {
    store.setRoute('chat')
    await store.selectThread(source.id)
    return source.id
  }
  store.setRoute('chat')
  return store.createThread({ workspaceRoot: artifact.workspaceRoot, forceNew: true, agentSurface: 'code' })
}

export async function openSourceConversation(artifact: LibraryArtifact): Promise<void> {
  const store = useChatStore.getState()
  const source = sourceThreadFor(artifact, store.threads)
  if (!source) return
  store.setRoute('chat')
  await store.selectThread(source.id)
}

/** The revision runs in the source conversation, so the agent keeps the history that produced the file. */
export function revisionPrompt(artifact: LibraryArtifact, request: string, focus?: string): string {
  const location = artifact.kind === 'design'
    ? `the design draft "${artifact.title}" (${artifact.path})`
    : `\`${artifact.path}\``
  return [
    request.trim(),
    '',
    `Apply this to ${location} in ${artifact.workspaceRoot}${focus ? `, focusing on ${focus}` : ''}.`
  ].join('\n')
}

export async function askKunToRevise(artifact: LibraryArtifact, request: string, focus?: string): Promise<boolean> {
  if (!request.trim()) return false
  const threadId = await ensureConversation(artifact)
  if (!threadId) return false
  return useChatStore.getState().sendMessage(revisionPrompt(artifact, request, focus), 'agent', {
    expectedThreadId: threadId
  })
}

export async function openDesignCanvas(artifact: LibraryArtifact): Promise<void> {
  if (!artifact.designDocumentId) return
  const store = useChatStore.getState()
  const source = sourceThreadFor(artifact, store.threads)
  const threadId = await ensureConversation(artifact)
  if (!threadId) return
  const boardArtifactId = source?.designProfile?.documentTarget.boardArtifactId
  useCodeCanvasDesignSurface.getState().showDesignDocument(
    threadId,
    artifact.workspaceRoot,
    artifact.designDocumentId,
    boardArtifactId ? { boardArtifactId } : undefined
  )
  requestCodeCanvasPanelOpen()
}

export async function openWhiteboard(artifact: LibraryArtifact): Promise<void> {
  if (!artifact.whiteboardId) return
  const write = useWriteWorkspaceStore.getState()
  if (normalizeWorkspaceRoot(write.workspaceRoot) !== normalizeWorkspaceRoot(artifact.workspaceRoot)) {
    await write.selectWriteWorkspace(artifact.workspaceRoot)
  }
  const store = useWriteWorkspaceStore.getState()
  // The library lists boards from the index, but the editor needs the board in
  // memory; load it here rather than when Work starts up.
  if (!(await store.ensureWhiteboards(artifact.workspaceRoot))) return
  if (!useWriteWorkspaceStore.getState().whiteboards[artifact.whiteboardId]) return
  useWriteWorkspaceStore.getState().openWhiteboard(artifact.whiteboardId)
  useChatStore.getState().setRoute('write')
}

export async function revealArtifact(artifact: LibraryArtifact): Promise<void> {
  await window.kunGui?.revealWorkspaceFileInFolder?.({ workspaceRoot: artifact.workspaceRoot, path: artifact.path })
}

/** Starts a fresh Code task with a starter prompt in the composer; nothing is sent until the user does. */
export function startNewArtifact(prompt: string): void {
  const store = useChatStore.getState()
  store.clearActiveThreadSelection()
  store.setRoute('chat')
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<ComposerPrefillDetail>(COMPOSER_PREFILL_EVENT, { detail: { text: prompt } }))
  }, 0)
}

export const NEW_ARTIFACT_KINDS: readonly LibraryArtifactKind[] = ['design', 'doc', 'slides', 'report', 'board']
