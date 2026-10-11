import type { NormalizedThread } from '../agent/types'
import type { DesignDocumentTarget, DesignTaskProfileInput } from '../agent/design-task-profile'
import { isDesignThreadId, readDesignThreadRegistry } from '../design/design-thread-registry'
import { effectiveHarnessId } from '../lib/ade-composer-harness'
import type { ChatState, SendMessageOverrides } from './chat-store-types'
import type { resolveDirectSendComposerSelection } from './chat-store-send-composer-selection'

/** Validate the submitted route, including old provider-based Agent selections. */
export function kunWorkflowSendBlocked(input: {
  state: ChatState
  selection: ReturnType<typeof resolveDirectSendComposerSelection>
  mode: string | undefined
  orchestration: 'direct' | 'graph'
  overrides: SendMessageOverrides | undefined
}): boolean {
  const { state, selection, overrides } = input
  const queued = overrides?.queued
  const intent = queued ?? overrides
  const thread = state.threads.find((candidate) => candidate.id === state.activeThreadId)
  const providerKind = (state.composerModelGroups ?? []).find((group) =>
    group.providerId === selection.composerProviderId)?.kind
  const harnessId = effectiveHarnessId(selection.composerHarnessId,
    queued ? undefined : thread?.harnessId, providerKind)
  if (harnessId === 'kun') return false
  return Boolean(
    intent?.agentSurface === 'design' || (!intent?.agentSurface && thread?.agentSurface === 'design') ||
    intent?.guiDesignMode || intent?.guiDesignCanvas || intent?.guiExcalidrawCanvas ||
    intent?.designProfile || intent?.designDocumentTarget || intent?.designImagePlacementTarget ||
    intent?.guiDesignArtifact || intent?.guiPlan || intent?.planBuild ||
    input.mode === 'plan' || input.mode === 'auto' || input.orchestration === 'graph'
  )
}

function sameDesignDocumentTarget(
  left: DesignDocumentTarget | undefined,
  right: DesignDocumentTarget | undefined
): boolean {
  return Boolean(
    left && right &&
    left.documentId === right.documentId &&
    left.boardArtifactId === right.boardArtifactId
  )
}

export function designSubmissionMatchesCodeThread(
  thread: NormalizedThread | null,
  profile: DesignTaskProfileInput | undefined,
  target: DesignDocumentTarget | undefined
): boolean {
  if (
    !thread ||
    thread.agentSurface === 'write' ||
    thread.agentSurface === 'design' ||
    isDesignThreadId(thread.id, readDesignThreadRegistry()) ||
    !profile ||
    !sameDesignDocumentTarget(profile.documentTarget, target)
  ) return false
  const locked = thread.designProfile
  if (!locked) return true
  return sameDesignDocumentTarget(locked.documentTarget, target) &&
    locked.outputMedium === profile.outputMedium &&
    locked.target === profile.target &&
    locked.preset === profile.preset &&
    locked.presetSource === profile.presetSource &&
    JSON.stringify(locked.styleSnapshot ?? null) === JSON.stringify(profile.styleSnapshot ?? null) &&
    JSON.stringify(locked.context) === JSON.stringify(profile.context)
}
