/**
 * The reuse half of "New session": find an untouched thread of the same
 * project, surface and configuration, then show it again as a fresh landing
 * page. Extracted from the creation action so the create path stays readable
 * and within the file-size gate.
 */
import type { AgentProvider } from '../agent/types'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { findReusableEmptyThreadId } from './chat-store-runtime-helpers'
import { isCodeThread } from './chat-store-runtime'
import { readDesignThreadRegistry, isDesignThreadId } from '../design/design-thread-registry'
import {
  composerReasoningEffortForSelection,
  readThreadComposerSelection,
  rememberThreadComposerSelection
} from './chat-store-helpers'
import {
  preparedWorktreeThreadForNewTask,
  reuseTargetStillEmpty,
  threadMatchesCreationIntent
} from './thread-creation-intent'
import {
  noteEmptyThreadActivated,
  requestSidebarThreadPromotion
} from '../lib/empty-thread-activation'

export type NewSessionReuseInput = {
  get: () => ChatState
  set: ChatStoreSet
  provider: AgentProvider
  workspaceRoot: string
  /** Explicitly isolated task, or a configured persona: still reusable, by intent. */
  isAdeThread: boolean
  requestedAgentSurface: 'code' | 'design'
  worktreeIntent: boolean
  forceNew: boolean
  conversation?: boolean
  agentId?: string
  harnessId?: string
  personaProfileId?: string
  initialModel: string
  initialProviderId: string
  explicitSelection: boolean
  activationAllowed: () => boolean
  step: (name: string) => void
}

/**
 * Returns the reused thread id, or null when this request must create a thread.
 * A thread that started a turn or gained a queue while the lookup awaited is
 * never reused: the caller then falls through to a real creation.
 */
export async function reuseEmptySessionForNewTask(
  input: NewSessionReuseInput
): Promise<string | null> {
  const { get, set } = input
  const personaCompatible = (thread: ChatState['threads'][number]): boolean =>
    threadMatchesCreationIntent({
      thread,
      agentId: input.personaProfileId ?? input.agentId,
      harnessId: input.harnessId
    })
  const reusableThreadId = input.isAdeThread || input.forceNew || input.worktreeIntent
    ? null
    : await findReusableEmptyThreadId(
        get(),
        input.provider,
        input.workspaceRoot,
        (thread) =>
          isCodeThread(thread, get().clawChannels) &&
          !isDesignThreadId(thread.id, readDesignThreadRegistry()) &&
          (thread.agentSurface ?? 'code') === input.requestedAgentSurface &&
          personaCompatible(thread)
      )
  // A worktree task never reuses a main-checkout thread, but re-clicking New
  // must not allocate a second pool slot for the same project either.
  const preparedWorktreeThreadId = !input.isAdeThread && !input.forceNew && input.worktreeIntent
    ? preparedWorktreeThreadForNewTask(get(), input.workspaceRoot)
    : null
  const reuseTargetId = reusableThreadId ?? preparedWorktreeThreadId
  input.step('reuse-lookup')
  if (!reuseTargetId) return null
  if (!input.activationAllowed()) return null
  if (!reuseTargetStillEmpty(get(), reuseTargetId)) return null
  // An explicit pin, or a model the user picked for this thread, wins;
  // otherwise a reused landing page takes the configured default as before.
  const userPickedModel = readThreadComposerSelection(reuseTargetId)?.source === 'user'
  const applySelection = Boolean(input.initialModel) &&
    (input.explicitSelection || !userPickedModel)
  if (applySelection) {
    rememberThreadComposerSelection(
      reuseTargetId,
      input.initialModel,
      input.initialProviderId,
      input.explicitSelection ? 'user' : 'default'
    )
  }
  if (get().activeThreadId !== reuseTargetId) {
    await get().selectThread(reuseTargetId)
    input.step('select')
  } else {
    set({
      error: null,
      // The thread is already in view, so carry the same decision to the
      // composer without reloading the thread or touching its draft.
      ...(applySelection
        ? {
            composerModel: input.initialModel,
            composerProviderId: input.initialProviderId,
            composerReasoningEffort: composerReasoningEffortForSelection(
              get().composerModelGroups,
              input.initialModel,
              input.initialProviderId
            )
          }
        : {})
    })
  }
  if (!input.forceNew && !input.conversation && !input.isAdeThread) {
    noteEmptyThreadActivated(reuseTargetId)
    requestSidebarThreadPromotion(reuseTargetId)
  }
  return reuseTargetId
}
