import i18n from '../i18n'
import { useChatStore } from '../store/chat-store'
import { getProvider } from '../agent/registry'
import type { AttachmentReference } from '../agent/types'
import { writeJoinPath } from '../write/write-workspace-store-helpers'
import { workspaceRootScopeKey } from '../lib/workspace-path'
import { composerReasoningEffortRequestValue } from '../components/chat/floating-composer-model-picker-logic'
import { serviceTierForComposerSelection } from '../components/chat/composer-fast-mode'
import { paperSpaceItemKey, usePaperSpaceStore } from './paper-space-store'
import { paperAssistantSession, patchPaperAssistant, type PaperSpaceImage } from './paper-space-assistant-state'

export type { PaperSpaceImage } from './paper-space-assistant-state'
export type PaperSpaceAssistantInput = {
  workspaceRoot: string
  unitDir?: string
  title?: string
  prompt?: string
  images?: readonly PaperSpaceImage[]
  /** Only the composer send consumes its draft. Reading-purpose actions do not. */
  consumeDraft?: boolean
}

const creating = new Map<string, Promise<string>>()

function readerIsCurrent(key: string): boolean {
  return useChatStore.getState().route === 'papers' && usePaperSpaceStore.getState().readerKey === key
}

async function validatePaperThread(key: string, threadId: string): Promise<void> {
  const provider = getProvider()
  if (!provider.getThreadSummary) throw new Error('PDF assistant thread validation is unavailable.')
  const thread = await provider.getThreadSummary(threadId)
  const root = key.split('\0')[0]
  if (thread.id !== threadId || thread.archived || thread.status === 'archived' || thread.status === 'deleted') {
    throw new Error('This PDF assistant thread is deleted or archived. Restore it before continuing.')
  }
  if (workspaceRootScopeKey(thread.workspace) !== root || thread.agentSurface !== 'write') {
    throw new Error('This PDF assistant thread does not belong to this paper source.')
  }
}

/** Restore only this paper's projection; selection never changes the current route. */
export async function selectPaperSpaceAssistant(key: string): Promise<boolean> {
  const threadId = paperAssistantSession(key).threadId
  if (!threadId || !readerIsCurrent(key)) return false
  try {
    await validatePaperThread(key, threadId)
    patchPaperAssistant(key, { threadId })
    if (!readerIsCurrent(key)) return false
    if (useChatStore.getState().activeThreadId === threadId) return true
    await useChatStore.getState().selectThread(threadId, { selectionGuard: () => readerIsCurrent(key) })
    return readerIsCurrent(key) && useChatStore.getState().activeThreadId === threadId
  } catch (error) {
    patchPaperAssistant(key, { error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

async function ensurePaperAssistantThread(input: PaperSpaceAssistantInput, key: string): Promise<string> {
  const existing = paperAssistantSession(key).threadId
  if (existing) return existing
  const pending = creating.get(key)
  if (pending) return pending
  const promise = (async () => {
    const draft = paperAssistantSession(key)
    const model = draft.model
    const providerId = draft.providerId
    const thread = await getProvider().createThread({
      workspace: input.workspaceRoot,
      title: input.title || input.unitDir || 'PDF',
      mode: 'agent', agentSurface: 'write',
      ...(model ? { model } : {}),
      ...(providerId ? { providerId } : {})
    })
    patchPaperAssistant(key, { threadId: thread.id })
    useChatStore.setState((chat) => ({
      threads: chat.threads.some((item) => item.id === thread.id) ? chat.threads : [thread, ...chat.threads]
    }))
    return thread.id
  })()
  creating.set(key, promise)
  try { return await promise } finally { creating.delete(key) }
}

/** Paper requests stay in the PDF rail and use the paper's own trusted source root. */
export async function openPaperSpaceAssistant(input: PaperSpaceAssistantInput): Promise<string | null> {
  const root = workspaceRootScopeKey(input.workspaceRoot)
  const key = input.unitDir ? paperSpaceItemKey(root, input.unitDir) : null
  if (!root || !key || !readerIsCurrent(key)) return null
  const before = paperAssistantSession(key)
  const chat = useChatStore.getState()
  patchPaperAssistant(key, { layout: 'assistant', error: null })
  if (!input.prompt?.trim()) {
    return await selectPaperSpaceAssistant(key) ? paperAssistantSession(key).threadId : null
  }
  if (before.sending) return null
  if (useChatStore.getState().runtimeConnection !== 'ready') {
    patchPaperAssistant(key, { error: i18n.t('common:runtimeActionNeedsConnection') })
    return null
  }
  const ownsProjection = before.threadId !== null && chat.activeThreadId === before.threadId
  const model = ownsProjection ? chat.composerModel : before.model ?? ''
  const providerId = ownsProjection ? chat.composerProviderId : before.providerId ?? ''
  const reasoningEffort = composerReasoningEffortRequestValue(chat.composerReasoningEffort)
  const serviceTier = serviceTierForComposerSelection(chat.composerFastMode, chat.composerModelGroups, model, providerId)
  const selection = { model, providerId, reasoningEffort, serviceTier }
  const current = (): boolean => readerIsCurrent(key)
  patchPaperAssistant(key, { sending: true })
  try {
    const threadId = await ensurePaperAssistantThread({ ...input, workspaceRoot: root }, key)
    if (!current()) return null
    if (!await selectPaperSpaceAssistant(key)) return null
    const selected = (): boolean => current() && useChatStore.getState().activeThreadId === threadId
    if (!selected()) return null
    const attachments: AttachmentReference[] = []
    const provider = getProvider()
    for (const image of input.images ?? []) {
      if (!selected()) return null
      if (!provider.uploadAttachment) throw new Error('Image attachments are unavailable.')
      const uploaded = await provider.uploadAttachment({ ...image, mimeType: 'image/png', workspace: root, threadId })
      attachments.push({ ...uploaded, kind: 'image' })
    }
    if (!selected()) return null
    const unitDir = input.unitDir
    const fileReferences = unitDir ? [{ path: writeJoinPath(root, unitDir), relativePath: unitDir,
      name: input.title || unitDir, kind: 'directory' as const }] : []
    const sent = await useChatStore.getState().sendMessage(input.prompt.trim(), 'agent', {
      expectedThreadId: threadId, submissionGuard: selected, agentSurface: 'write', attachmentIds: attachments.map((item) => item.id),
      attachments, fileReferences, composerContexts: [],
      ...selection
    })
    if (!sent) {
      patchPaperAssistant(key, { error: useChatStore.getState().error || 'The message was not sent.' })
      return null
    }
    // A user may keep editing while upload/admission is pending. Never erase those edits.
    const latest = paperAssistantSession(key)
    if (input.consumeDraft) patchPaperAssistant(key, {
      ...(latest.input === before.input ? { input: '' } : {}),
      images: latest.images.filter((image) => !input.images?.includes(image))
    })
    return threadId
  } catch (error) {
    patchPaperAssistant(key, { error: error instanceof Error ? error.message : String(error) })
    return null
  } finally {
    patchPaperAssistant(key, { sending: false })
  }
}

export function submitPaperSpaceAssistantPrompt(workspaceRoot: string, prompt: string, unitDir?: string): Promise<string | null> {
  return openPaperSpaceAssistant({ workspaceRoot, unitDir, prompt })
}
