import type { AgentProvider } from '../agent/types'
import type { NormalizedThread } from '../agent/types'
import type { PreparedThreadSend } from './chat-store-thread-send-direct-types'
import { shouldAutoTitleThread } from '../lib/thread-title'

export function shouldRenameReusedSendThread(
  threads: readonly NormalizedThread[],
  threadId: string | null,
  enabled: boolean
): boolean {
  if (!enabled || !threadId) return false
  return shouldAutoTitleThread(threads.find((thread) => thread.id === threadId) ?? null)
}

/** Build a new thread from the submitted composer choice, not later store state. */
export function createNewSendThread(
  provider: AgentProvider,
  input: PreparedThreadSend,
  workspaceRoot: string,
  adeSend: boolean
): ReturnType<AgentProvider['createThread']> {
  return provider.createThread({
    workspace: workspaceRoot,
    title: input.generatedTitle,
    titleAuto: true,
    ...(input.composerModel ? { model: input.composerModel } : {}),
    ...(input.composerProviderId ? { providerId: input.composerProviderId } : {}),
    ...(input.composerAccountId ? { accountId: input.composerAccountId } : {}),
    ...(input.composerHarnessId ? { harnessId: input.composerHarnessId } : {}),
    ...(input.composerCredentialMode ? { credentialMode: input.composerCredentialMode } : {}),
    ...(adeSend ? { workspaceMode: 'ade' as const } : {}),
    // Design is turn intent; workbench thread ownership stays Code.
    agentSurface: input.requestedAgentSurface === 'write' ? 'write' : 'code',
    mode: input.mode ?? 'agent'
  })
}
