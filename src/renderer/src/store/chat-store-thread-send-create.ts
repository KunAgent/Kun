import type { AgentProvider } from '../agent/types'
import type { NormalizedThread } from '../agent/types'
import type { PreparedThreadSend } from './chat-store-thread-send-direct-types'
import { shouldAutoTitleThread } from '../lib/thread-title'
import { findReusableEmptyThreadId } from './chat-store-runtime-helpers'
import { isCodeThread } from './chat-store-runtime'
import { readDesignThreadRegistry } from '../design/design-thread-registry'

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
    workspaceIsolation: input.adeDraft?.isolation ?? 'local',
    title: input.generatedTitle,
    titleAuto: true,
    ...(input.composerModel ? { model: input.composerModel } : {}),
    ...(input.composerProviderId ? { providerId: input.composerProviderId } : {}),
    ...(input.composerAccountId ? { accountId: input.composerAccountId } : {}),
    ...(input.composerHarnessId ? { harnessId: input.composerHarnessId } : {}),
    ...(input.composerCredentialMode ? { credentialMode: input.composerCredentialMode } : {}),
    ...(adeSend ? { workspaceMode: 'code' as const } : {}),
    ...(input.composerCollaborationEnabled || input.composerCollaborationExplicit
      ? { collaboration: { enabled: input.composerCollaborationEnabled === true } } : {}),
    ...(input.codeProjectRoute ? {
      routeIntent: input.codeProjectRoute.routeIntent,
      projectDefaultsRevision: input.codeProjectRoute.projectDefaultsRevision
    } : {}),
    // Design is turn intent; workbench thread ownership stays Code.
    agentSurface: input.requestedAgentSurface === 'write' ? 'write' : 'code',
    mode: input.mode ?? 'agent'
  })
}

/** Explicit draft configuration owns a new task; plain Code can reuse an empty one. */
export async function reusableThreadForSend(input: PreparedThreadSend, workspaceRoot: string): Promise<string | null> {
  if (input.adeDraft || input.composerCollaborationEnabled || input.composerCollaborationExplicit || input.codeProjectRoute) return null
  const { get } = input.context
  return findReusableEmptyThreadId(get(), input.provider, workspaceRoot,
    (thread) => isCodeThread(thread, get().clawChannels, undefined, readDesignThreadRegistry()))
}
