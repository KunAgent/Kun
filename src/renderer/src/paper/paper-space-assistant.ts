import { useChatStore } from '../store/chat-store'
import { getProvider } from '../agent/registry'
import type { AttachmentReference } from '../agent/types'
import { writeJoinPath } from '../write/write-workspace-store-helpers'
import { usePaperSpaceStore } from './paper-space-store'

export type PaperSpaceImage = { dataBase64: string; name: string }
export type PaperSpaceAssistantInput = {
  workspaceRoot: string
  unitDir?: string
  title?: string
  prompt?: string
  images?: readonly PaperSpaceImage[]
}

/** Never route a paper request through Work's composer, attachments, or workspace selection. */
export async function openPaperSpaceAssistant(input: PaperSpaceAssistantInput): Promise<string | null> {
  const root = input.workspaceRoot.trim()
  if (!root) return null
  const store = useChatStore.getState()
  const route = store.route
  const readerKey = usePaperSpaceStore.getState().readerKey
  const current = (): boolean => useChatStore.getState().route === route && usePaperSpaceStore.getState().readerKey === readerKey
  const threadId = await store.createThread({ workspaceRoot: root, forceNew: true, useWorktreePool: false, activationGuard: current })
  if (!threadId || !current() || useChatStore.getState().activeThreadId !== threadId) return null
  const attachments: AttachmentReference[] = []
  const provider = getProvider()
  for (const image of input.images ?? []) {
    if (!current() || useChatStore.getState().activeThreadId !== threadId) return null
    if (!provider.uploadAttachment) throw new Error('Image attachments are unavailable.')
    const uploaded = await provider.uploadAttachment({ ...image, mimeType: 'image/png', workspace: root, threadId })
    attachments.push({ ...uploaded, kind: 'image' })
  }
  if (!current() || useChatStore.getState().activeThreadId !== threadId) return null
  const unitDir = input.unitDir
  const fileReferences = unitDir ? [{ path: writeJoinPath(root, unitDir), relativePath: unitDir,
    name: input.title || unitDir, kind: 'directory' as const }] : []
  useChatStore.setState({ route: 'chat' })
  if (input.prompt?.trim()) {
    const sent = await useChatStore.getState().sendMessage(input.prompt.trim(), 'agent', {
      expectedThreadId: threadId, agentSurface: 'code', attachmentIds: attachments.map((item) => item.id),
      attachments, fileReferences, composerContexts: []
    })
    if (!sent) return null
  }
  return threadId
}

export function submitPaperSpaceAssistantPrompt(workspaceRoot: string, prompt: string, unitDir?: string): Promise<string | null> {
  return openPaperSpaceAssistant({ workspaceRoot, unitDir, prompt })
}
