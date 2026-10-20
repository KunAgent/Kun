import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import { DEFAULT_KUN_MODEL, MODEL_REASONING_EFFORTS } from '@shared/app-settings'
import type {
  ChatState,
  SideConversation,
  SideConversationDraftOptions,
  SidePanelState
} from './chat-store-types'
import {
  accountIdForComposerSelection,
  providerIdForComposerModel
} from './chat-store-helpers'
import { upsertUserBlock } from './chat-store-runtime-helpers'
import { monotonicToolStatus } from './chat-projection-reducer'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import { serviceTierForComposerSelection } from '../components/chat/composer-fast-mode'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import {
  defaultSideModel,
  defaultSideProviderId,
  defaultSideTitle,
  patchSide,
  setSidePanel,
  sideReasoningEffortRequestValue,
  startSideSubscription,
  teardownSideSubscription,
  type SideContext
} from './chat-store-side-runtime'
import {
  cloneDesignDocumentForFork,
  removeClonedDesignDocument,
  type CloneDesignDocumentForForkInput,
  type PreparedDesignDocumentFork
} from '../design/design-document-fork'
import { resolvePreparedDesignCloneAfterError } from './chat-store-design-clone-recovery'

type SideActionDependencies = {
  cloneDesignDocument?: (
    input: CloneDesignDocumentForForkInput
  ) => Promise<PreparedDesignDocumentFork>
}

export function createSideActions(
  ctx: SideContext,
  dependencies: SideActionDependencies = {}
): Pick<
  ChatState,
  | 'spawnSideConversation'
  | 'openSideConversationDraft'
  | 'sendSideMessage'
  | 'interruptSide'
  | 'resolveSideUserInput'
  | 'setSideInput'
  | 'setSideModel'
  | 'setSideReasoningEffort'
  | 'setSideFastMode'
  | 'setSideAttachments'
  | 'selectSideConversation'
  | 'setSidePanelOpen'
  | 'closeSideConversation'
  | 'discardSideConversation'
  | 'promoteSideConversation'
> {
  const actions: Pick<
    ChatState,
    | 'spawnSideConversation'
    | 'openSideConversationDraft'
    | 'sendSideMessage'
    | 'interruptSide'
    | 'resolveSideUserInput'
    | 'setSideInput'
    | 'setSideModel'
    | 'setSideReasoningEffort'
    | 'setSideFastMode'
    | 'setSideAttachments'
    | 'selectSideConversation'
    | 'setSidePanelOpen'
    | 'closeSideConversation'
    | 'discardSideConversation'
    | 'promoteSideConversation'
  > = {
    spawnSideConversation: async (seedText, options?: SideConversationDraftOptions) => {
      const state = ctx.get()
      const parentId = state.activeThreadId
      if (!parentId) {
        ctx.set({ error: ctx.t('common:sideConversationNeedsActiveThread') })
        return null
      }
      if (state.runtimeConnection !== 'ready') {
        ctx.set({ error: ctx.t('common:runtimeActionNeedsConnection') })
        return null
      }
      const provider = ctx.getProvider()
      if (typeof provider.forkThread !== 'function') {
        ctx.set({ error: ctx.t('common:runtimeFeatureUnsupported') })
        return null
      }
      const parentThread = state.threads.find((thread) => thread.id === parentId)
      const title = defaultSideTitle(parentThread?.title ?? '', parentId)
      let forked
      let preparedDesignFork: PreparedDesignDocumentFork | null = null
      let forkCommitted = false
      try {
        if (parentThread?.designProfile) {
          preparedDesignFork = await (
            dependencies.cloneDesignDocument ?? cloneDesignDocumentForFork
          )({
            workspaceRoot: parentThread.workspace || state.workspaceRoot,
            sourceTarget: parentThread.designProfile.documentTarget,
            operation: { kind: 'fork', sourceId: parentId, relation: 'side' }
          })
        }
        await preparedDesignFork?.markRuntimeRequestStarted?.()
        forked = await provider.forkThread(parentId, {
          relation: 'side',
          title,
          ...(preparedDesignFork
            ? {
                designDocumentTarget: preparedDesignFork.designDocumentTarget,
                designCloneOperationId: preparedDesignFork.operationId
              }
            : {})
        })
        forkCommitted = true
        await preparedDesignFork?.commit?.()
      } catch (e) {
        if (!forkCommitted && preparedDesignFork) {
          const outcome = await resolvePreparedDesignCloneAfterError(
            provider, preparedDesignFork, e
          )
          if (outcome.kind === 'committed') {
            forked = outcome.thread
            forkCommitted = true
            await preparedDesignFork.commit?.()
          }
        }
        if (!forkCommitted) {
          ctx.set({
            error: ctx.formatRuntimeError(e),
            ...(ctx.shouldOpenSettingsForError(e)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return null
        }
      }
      if (!forked) return null
      const now = new Date().toISOString()
      const inheritedAt = new Date().toISOString()
      const draftModel = options?.model?.trim() || defaultSideModel(state, parentId)
      const draftProviderId =
        options && Object.prototype.hasOwnProperty.call(options, 'providerId')
          ? options.providerId?.trim() ?? ''
          : defaultSideProviderId(state, parentId, draftModel)
      const draftReasoningEffort =
        sideReasoningEffortRequestValue(options?.reasoningEffort ?? '') ?? 'max'
      const side: SideConversation = {
        threadId: forked.id,
        parentThreadId: parentId,
        ...(forked.designProfile ? { designProfile: forked.designProfile } : {}),
        ...(forked.designProfile
          ? { designWorkspaceRoot: parentThread?.workspace || state.workspaceRoot }
          : {}),
        title: forked.title ?? title,
        createdAt: now,
        inheritedAt,
        blocks: [],
        liveReasoning: '',
        liveAssistant: '',
        lastSeq: 0,
        input: '',
        model: draftModel,
        providerId: draftProviderId,
        reasoningEffort: draftReasoningEffort,
        fastMode: options?.fastMode ?? state.composerFastMode,
        attachments: [...(options?.attachments ?? [])],
        busy: false,
        turnId: null,
        userItemId: null,
        error: null
      }
      ctx.set((s) => ({
        sideConversations: { ...s.sideConversations, [forked.id]: side },
        sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: forked.id })
      }))
      // Start a dedicated SSE subscription for this side thread. The
      // main `activeThreadId` and main subscription are untouched.
      startSideSubscription(forked.id, 0, ctx)
      if (seedText?.trim() || side.attachments.length > 0) {
        // Call the side action directly through the closure we are
        // currently building so store-level `state.sendSideMessage`
        // shims (e.g. test harnesses) cannot swallow the seed send.
        const started = await actions.sendSideMessage(
          forked.id,
          seedText?.trim() ?? '',
          options?.composerContexts?.length ? { composerContexts: options.composerContexts } : undefined
        )
        if (!started) return forked.id
      }
      return forked.id
    },

    openSideConversationDraft: () => {
      ctx.set((s) => ({
        sidePanel: setSidePanel(s.sidePanel, { open: true, activeSideId: null })
      }))
    },

    sendSideMessage: async (sideId, text, sendOptions) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return false
      if (side.busy) return false
      const trimmed = text.trim()
      const attachmentIds = side.attachments
        .map((attachment) => attachment.id.trim())
        .filter(Boolean)
      if (!trimmed && attachmentIds.length === 0) return false
      const provider = ctx.getProvider()
      const reasoningEffort = sideReasoningEffortRequestValue(side.reasoningEffort)
      const providerId = side.providerId.trim()
      const accountId = accountIdForComposerSelection(
        state.composerModelGroups,
        providerId,
        side.model
      )
      const serviceTier = serviceTierForComposerSelection(
        side.fastMode,
        state.composerModelGroups,
        side.model,
        providerId
      )
      try {
        const { turnId } = await provider.sendUserMessage(sideId, trimmed, {
          model: side.model,
          ...(providerId ? { providerId } : {}),
          ...(accountId ? { accountId } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(serviceTier ? { serviceTier } : {}),
          // Side conversations do not mount the full Design pipeline/canvas.
          // Keep their next turn explicitly Code even when the fork retains a
          // Design profile for later promotion or recovery.
          agentSurface: 'code',
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(sendOptions?.composerContexts?.length
            ? { composerContexts: sendOptions.composerContexts }
            : {})
        })
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            input: '',
            attachments: cur.attachments.filter(
              (attachment) => !attachmentIds.includes(attachment.id.trim())
            ),
            busy: true,
            turnId,
            error: null
          }))
        )
        // Re-attach the subscription from the last seen seq so we don't
        // miss items emitted between the previous reconnect and the new
        // turn creation.
        startSideSubscription(sideId, side.lastSeq, ctx)
        return true
      } catch (e) {
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
        return false
      }
    },

    interruptSide: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side || !side.turnId) return
      const provider = ctx.getProvider()
      try {
        await provider.interruptTurn(sideId, side.turnId)
        ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, busy: false })))
      } catch (e) {
        ctx.set((s) =>
          patchSide(s, sideId, (cur) => ({
            ...cur,
            error: ctx.formatRuntimeError(e)
          }))
        )
      }
    },

    resolveSideUserInput: async (sideId, blockId, action) => {
      const side = ctx.get().sideConversations[sideId]
      const block = side?.blocks.find((candidate) => candidate.id === blockId)
      if (
        !side ||
        !block ||
        block.kind !== 'user_input' ||
        block.status !== 'pending' ||
        block.live !== true
      ) {
        return
      }

      const provider = ctx.getProvider()
      try {
        if (action.kind === 'submit') {
          if (typeof provider.submitUserInputResponse !== 'function') {
            throw new Error(ctx.t('common:runtimeUserInputUnsupported'))
          }
          await provider.submitUserInputResponse(block.requestId, action.answers)
          ctx.set((state) =>
            patchSide(state, sideId, (current) => ({
              ...current,
              blocks: current.blocks.map((candidate) =>
                candidate.id === blockId && candidate.kind === 'user_input'
                  ? {
                      ...candidate,
                      status: 'submitted',
                      answers: action.answers,
                      live: false,
                      errorMessage: undefined
                    }
                  : candidate
              )
            }))
          )
          return
        }

        if (typeof provider.cancelUserInput !== 'function') {
          throw new Error(ctx.t('common:runtimeUserInputUnsupported'))
        }
        await provider.cancelUserInput(block.requestId)
        ctx.set((state) =>
          patchSide(state, sideId, (current) => ({
            ...current,
            blocks: current.blocks.map((candidate) =>
              candidate.id === blockId && candidate.kind === 'user_input'
                ? {
                    ...candidate,
                    status: 'cancelled',
                    live: false,
                    errorMessage: undefined
                  }
                : candidate
            )
          }))
        )
      } catch (error) {
        const message = ctx.formatRuntimeError(error)
        void window.kunGui?.logError?.('side-user-input', 'Failed to resolve side user input', {
          message,
          sideId,
          blockId
        }).catch(() => undefined)
        ctx.set((state) =>
          patchSide(state, sideId, (current) => ({
            ...current,
            error: message,
            blocks: current.blocks.map((candidate) =>
              candidate.id === blockId && candidate.kind === 'user_input'
                ? {
                    ...candidate,
                    status: 'error',
                    live: false,
                    errorMessage: message,
                    ...(action.kind === 'submit' ? { answers: action.answers } : {})
                  }
                : candidate
            )
          }))
        )
      }
    },

    setSideInput: (sideId, text) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, input: text })))
    },

    setSideModel: (sideId, model, providerId) => {
      ctx.set((s) =>
        patchSide(s, sideId, (cur) => ({
          ...cur,
          model,
          providerId: providerId?.trim() ?? ''
        }))
      )
    },

    setSideReasoningEffort: (sideId, effort) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, reasoningEffort: effort })))
    },

    setSideFastMode: (sideId, enabled) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, fastMode: enabled })))
    },

    setSideAttachments: (sideId, attachments) => {
      ctx.set((s) => patchSide(s, sideId, (cur) => ({ ...cur, attachments: [...attachments] })))
    },

    selectSideConversation: (sideId) => {
      ctx.set((s) => {
        if (!s.sideConversations[sideId]) return {}
        return {
          sidePanel: setSidePanel(s.sidePanel, { activeSideId: sideId, open: true }),
          unreadThreadIds: clearUnreadCompletion(s.unreadThreadIds, sideId)
        }
      })
    },

    setSidePanelOpen: (open) => {
      ctx.set((s) => {
        const activeSideId = s.sidePanel.activeSideId
        return {
          sidePanel: setSidePanel(s.sidePanel, { open }),
          unreadThreadIds: open && activeSideId
            ? clearUnreadCompletion(s.unreadThreadIds, activeSideId)
            : s.unreadThreadIds
        }
      })
    },

    closeSideConversation: async (sideId) => {
      const state = ctx.get()
      const closingSide = state.sideConversations[sideId] ?? null
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && closingSide
            ? Object.values(next).find((side) => side.parentThreadId === closingSide.parentThreadId)?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        const unreadThreadIds = clearUnreadCompletion(s.unreadThreadIds, sideId)
        return { sideConversations: next, sidePanel: nextPanel, unreadThreadIds }
      })
    },

    discardSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      teardownSideSubscription(sideId)
      ctx.set((s) => {
        const next = { ...s.sideConversations }
        delete next[sideId]
        const nextActiveId =
          s.sidePanel.activeSideId === sideId && side
            ? Object.values(next).find((candidate) => candidate.parentThreadId === side.parentThreadId)?.threadId ?? null
            : s.sidePanel.activeSideId
        const nextPanel: SidePanelState = {
          open: nextActiveId ? s.sidePanel.open : false,
          activeSideId: nextActiveId
        }
        const unreadThreadIds = clearUnreadCompletion(s.unreadThreadIds, sideId)
        return { sideConversations: next, sidePanel: nextPanel, unreadThreadIds }
      })
      if (side) {
        const provider = ctx.getProvider()
        try {
          await provider.deleteThread(sideId)
          invalidateThreadSnapshot(sideId)
          if (side.designProfile && side.designWorkspaceRoot) {
            await removeClonedDesignDocument({
              workspaceRoot: side.designWorkspaceRoot,
              documentTarget: side.designProfile.documentTarget
            })
          }
        } catch (e) {
          ctx.set({
            error: ctx.formatRuntimeError(e),
            ...(ctx.shouldOpenSettingsForError(e)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
        }
      }
    },

    promoteSideConversation: async (sideId) => {
      const state = ctx.get()
      const side = state.sideConversations[sideId]
      if (!side) return
      // Use the provider's renameThread surface to clear the relation by
      // PATCHing the thread. The HTTP client encodes relation='primary'
      // as a generic runtimeRequest body — we use a direct request here
      // because the rename surface is title-only.
      try {
        const response = await window.kunGui.runtimeRequest(
          `/v1/threads/${encodeURIComponent(sideId)}`,
          'PATCH',
          JSON.stringify({ relation: 'primary' })
        )
        if (!response.ok) {
          ctx.set({ error: ctx.formatRuntimeError(new Error(response.body || 'promote failed')) })
          return
        }
      } catch (e) {
        ctx.set({ error: ctx.formatRuntimeError(e) })
        return
      }
      await ctx.get().refreshThreads()
      // Closing is a structural teardown; call directly so a stubbed
      // `state.closeSideConversation` (e.g. in tests) cannot swallow it.
      await actions.closeSideConversation(sideId)
    }
  }
  return actions
}

export { teardownAllSideSubscriptions } from './chat-store-side-runtime'
