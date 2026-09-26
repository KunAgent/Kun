import i18n from '../i18n'
import { getProvider } from '../agent/registry'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { deriveThreadTitleFromPrompt } from '../lib/thread-title'
import { clearedThreadSelection } from './chat-store-runtime-helpers'
import {
  syncTurnCompletionPoll,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { rememberThreadComposerSelection } from './chat-store-helpers'
import { prepareAdeThreadWorktree } from './chat-store-thread-send-worktree'
import { snapshotThreadProjection } from './thread-snapshot-cache'
import { watchPlanBuildReview } from './plan-build-watch'
import {
  createClientTurnRequestId,
  type StoreActionContext,
  type ThreadActionRuntime
} from './chat-store-thread-actions-support'
import type {
  ChatState,
  ExternalPlanBuildRequest,
  QueuedUserMessage
} from './chat-store-types'

/**
 * External-harness plan builds (07 §10, p2 §P2-11): instead of injecting the
 * native Kun prompt-managed worktree protocol into the prompt, the build runs
 * as a one-to-one turn on a fresh ADE thread bound to a host-managed task
 * worktree. The queued turn carries `planBuild` so Kun admission enforces the
 * isolated-workspace rule (`plan-build` usage) for harnesses without their own
 * sandbox. The queued row parks until the workspace reports `ready`, then the
 * normal queue drain sends it. On settle the review watcher opens the Review
 * panel so the user chooses the integration mode.
 */

export function createPlanBuildActions(
  context: StoreActionContext,
  runtime: ThreadActionRuntime
): Pick<ChatState, 'dispatchExternalPlanBuild'> {
  const { set, get, sseAbortRef } = context
  return {
    dispatchExternalPlanBuild: async (input) => {
      const provider = getProvider()
      if (!provider.createTaskWorkspace) {
        set({ error: i18n.t('common:planBuildExternalUnsupported') })
        return false
      }
      try {
        const harnessId = input.harnessId.trim()
        const thread = await provider.createThread({
          workspace: input.workspaceRoot,
          title: input.title?.trim() || deriveThreadTitleFromPrompt(input.displayText),
          titleAuto: true,
          mode: 'agent',
          agentSurface: 'code',
          workspaceMode: 'ade',
          ...(harnessId ? { harnessId } : {}),
          ...(input.credentialMode?.trim() ? { credentialMode: input.credentialMode.trim() } : {}),
          ...(input.model?.trim() ? { model: input.model.trim() } : {}),
          ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
          ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {})
        })
        if (input.model?.trim()) {
          rememberThreadComposerSelection(
            thread.id,
            input.model.trim(),
            input.providerId?.trim() ?? '',
            'user',
            harnessId
              ? { harnessId, credentialMode: input.credentialMode?.trim() ?? '' }
              : undefined
          )
        }
        const clientRequestId = createClientTurnRequestId()
        const submission: QueuedUserMessage = {
          id: `q-${clientRequestId}`,
          text: input.prompt,
          clientRequestId,
          displayText: input.displayText,
          mode: 'agent',
          expectedThreadId: thread.id,
          planBuild: true,
          ...(harnessId ? { harnessId } : {}),
          ...(input.credentialMode?.trim()
            ? { credentialMode: input.credentialMode.trim() }
            : {}),
          ...(input.model?.trim() ? { model: input.model.trim() } : {}),
          ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
          ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {})
        }
        // Same activation semantics as a fresh selectThread: park the outgoing
        // projection, drop the old SSE subscription, and clear the view before
        // the worktree-prep subscription takes over. A busy planning thread
        // keeps its completion-notification watch, like openAde.
        const previous = get()
        if (previous.activeThreadId && previous.activeThreadId !== thread.id) {
          runtime.fenceThreadMutation(previous.activeThreadId)
          snapshotThreadProjection(previous)
        }
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        const nextWatch = { ...previous.watchTurnCompletion }
        if (previous.activeThreadId && previous.busy) {
          nextWatch[previous.activeThreadId] = true
          watchTurnCompletionNotification(
            previous.activeThreadId,
            Date.now(),
            turnCompleteNotificationSource(previous.activeThreadId, previous)
          )
        }
        set((s) => ({
          ...clearedThreadSelection(),
          route: 'ade',
          activeThreadId: thread.id,
          lastAdeThreadId: thread.id,
          watchTurnCompletion: nextWatch,
          adeThreads: (s.adeThreads ?? []).some((row) => row.id === thread.id)
            ? s.adeThreads
            : [thread, ...(s.adeThreads ?? [])],
          error: null
        }))
        syncTurnCompletionPoll(set, get)
        void get().refreshAdeThreads()
        const record = await prepareAdeThreadWorktree({
          provider,
          threadId: thread.id,
          workspaceRoot: input.workspaceRoot,
          context,
          submittedMessageForQueue: submission,
          persistActiveQueuedMessages: runtime.persistActiveQueuedMessages,
          // Plan builds always branch from the checkout's current HEAD, never
          // the composer's default-branch preference (07 §10).
          startFrom: { kind: 'current-head' },
          label: input.title?.trim() || input.displayText
        })
        if (record) watchPlanBuildReview(record.workspaceId, thread.id)
        return true
      } catch (error) {
        set({ error: formatRuntimeError(error) })
        return false
      }
    }
  }
}
