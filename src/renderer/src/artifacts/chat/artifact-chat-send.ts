import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import i18n from '../../i18n'
import { buildComposerFileContextPrompt, type ComposerFileReference } from '../../lib/composer-file-references'
import { composerReasoningEffortRequestValue } from '../../components/chat/floating-composer-model-picker-logic'
import { serviceTierForComposerSelection } from '../../components/chat/composer-fast-mode'
import { readWorkbenchComposerFileContextEntries } from '../../components/workbench/workbench-composer-file-context'
import { composerReferencesToUserFileReferences } from '../../components/workbench/workbench-composer-prompts'
import { useChatStore } from '../../store/chat-store'
import { workAssistantThreadRoute, workAssistantUsesExternalAgent } from '../../write/work-assistant-agent'
import type { LibraryArtifact } from '../artifact-types'
import { useArtifactChatBinding } from './artifact-chat-binding'
import { artifactTurnContexts, artifactTurnPrompt, type ArtifactChatView } from './artifact-chat-context'
import { beginArtifactTurn, cancelArtifactTurn } from './artifact-chat-session'

export type ArtifactChatSendInput = {
  artifact: LibraryArtifact
  /** Thread the panel shows; null starts a new conversation about this file. */
  threadId: string | null
  request: string
  view: ArtifactChatView
  /** The file as the viewer shows it; the turn's undo snapshot. */
  preview: WorkspaceOfficePreviewSuccess | null
  fileReferences: ComposerFileReference[]
  mode?: 'plan' | 'agent' | 'auto'
}

/**
 * Sends one panel message to the artifact's conversation. The thread becomes
 * the active one (as Work does), the message carries the file, the slide or
 * selection and @-referenced files, and the file's current bytes are kept so
 * the turn can be undone or compared.
 */
export async function sendArtifactChatTurn(input: ArtifactChatSendInput): Promise<{ sent: boolean; threadId: string | null }> {
  const request = input.request.trim()
  if (!request) return { sent: false, threadId: input.threadId }
  const store = useChatStore.getState()
  let threadId = input.threadId
  if (!threadId) {
    // A new conversation starts on the composer's Agent and model, as a new Work session does.
    const route = workAssistantThreadRoute(store)
    const credentialMode = route.credentialMode === 'native-login' || route.credentialMode === 'provider' ||
      route.credentialMode === 'kun-gateway' ? route.credentialMode : undefined
    threadId = await store.createThread({
      workspaceRoot: input.artifact.workspaceRoot, forceNew: true, agentSurface: 'code',
      ...(route.harnessId ? { harnessId: route.harnessId } : {}),
      ...(credentialMode ? { credentialMode } : {}),
      ...(route.gatewayBinding ? { gatewayBinding: route.gatewayBinding } : {}),
      ...(route.model ? { model: route.model } : {}),
      ...(route.providerId ? { providerId: route.providerId } : {})
    })
    if (!threadId) return { sent: false, threadId: null }
    useArtifactChatBinding.getState().bind(input.artifact.id, threadId)
  } else if (store.activeThreadId !== threadId) {
    await store.selectThread(threadId)
  }
  if (useChatStore.getState().activeThreadId !== threadId) return { sent: false, threadId }

  const composerContexts = await artifactTurnContexts({ artifact: input.artifact, view: input.view, query: request })
  let promptText = artifactTurnPrompt(request, input.artifact, input.view)
  if (input.fileReferences.length > 0) {
    const t = (key: string, options?: Record<string, unknown>): string => String(i18n.t(key, options))
    promptText = buildComposerFileContextPrompt(promptText,
      await readWorkbenchComposerFileContextEntries(input.fileReferences, input.artifact.workspaceRoot, t))
  }
  const state = useChatStore.getState()
  const reasoningEffort = composerReasoningEffortRequestValue(state.composerReasoningEffort)
  const serviceTier = serviceTierForComposerSelection(
    state.composerFastMode, state.composerModelGroups, state.composerModel, state.composerProviderId
  )
  // Plan mode is Kun's; a third-party Agent always runs the turn as an agent turn.
  const externalAgent = workAssistantUsesExternalAgent(state)
  if (input.preview) beginArtifactTurn(input.artifact, input.preview, threadId, request, state.busy)
  const sent = await state.sendMessage(promptText, input.mode === 'plan' && !externalAgent ? 'plan' : 'agent', {
    expectedThreadId: threadId,
    useComposerAgent: true,
    displayText: request,
    ...(composerContexts.length ? { composerContexts } : {}),
    ...(input.fileReferences.length ? { fileReferences: composerReferencesToUserFileReferences(input.fileReferences) } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {})
  })
  if (!sent) cancelArtifactTurn(input.artifact.id)
  return { sent, threadId }
}
