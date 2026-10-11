import { getProvider } from '../agent/registry'
import type { DesignDocumentTarget } from '../agent/design-task-profile'
import {
  cloneDesignDocumentForFork,
  type CloneDesignDocumentForForkInput,
  type PreparedDesignDocumentFork
} from '../design/design-document-fork'
import i18n from '../i18n'
import { formatRuntimeError } from '../lib/format-runtime-error'
import {
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  forkedMessageCount,
  forkedTurnCount,
  shouldOpenSettingsForError
} from './chat-store-runtime'
import { resolvePreparedDesignCloneAfterError } from './chat-store-design-clone-recovery'

export type CloneDesignDocumentForFork = (
  input: CloneDesignDocumentForForkInput
) => Promise<PreparedDesignDocumentFork>

export const DESIGN_HISTORICAL_FORK_UNAVAILABLE =
  'Design tasks cannot be forked from a historical turn because historical whiteboard snapshots are unavailable. Fork the current Design task instead.'

type ForkActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
}

type ForkProviderOptions = {
  turnId?: string
  designDocumentTarget?: DesignDocumentTarget
  designCloneOperationId?: string
}

export function createForkActiveThreadWithOptions(
  { set, get }: ForkActionContext,
  cloneDesignDocument: CloneDesignDocumentForFork = cloneDesignDocumentForFork
): (options?: { turnId?: string }) => Promise<void> {
  return async (options = {}) => {
    const { activeThreadId, busy, blocks } = get()
    if (!activeThreadId) return
    if (busy) {
      set({ error: i18n.t('common:threadActionBusy') })
      return
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const provider = getProvider()
    if (typeof provider.forkThread !== 'function') {
      set({ error: i18n.t('common:runtimeFeatureUnsupported') })
      return
    }

    const turnId = options.turnId?.trim()
    let preparedDesignFork: PreparedDesignDocumentFork | null = null
    let forkCommitted = false
    const parentRecord = get().threads.find((thread) => thread.id === activeThreadId) ??
      (get().adeThreads ?? []).find((thread) => thread.id === activeThreadId)
    const isAdeParent = parentRecord?.workspaceMode === 'ade'
    const parentThread = parentRecord ?? {
      id: activeThreadId,
      title: activeThreadId.slice(0, 8)
    }
    const finishFork = async (forked: Awaited<ReturnType<NonNullable<typeof provider.forkThread>>>): Promise<void> => {
      forkCommitted = true
      await preparedDesignFork?.commit?.()
      saveThreadForkRegistry(
        markThreadFork(
          forked.id,
          parentThread,
          {
            createdAt: forked.forkedAt ?? new Date().toISOString(),
            forkedFromMessageCount: forked.forkedFromMessageCount ?? forkedMessageCount(blocks),
            forkedFromTurnCount: forked.forkedFromTurnCount ?? forkedTurnCount(blocks)
          },
          readThreadForkRegistry()
        )
      )
      // ADE forks refresh the ADE inventory; the Code list never sees them.
      await (isAdeParent ? get().refreshAdeThreads() : get().refreshThreads())
      await get().selectThread(forked.id)
    }
    try {
      if (turnId && parentRecord?.designProfile) {
        set({ error: DESIGN_HISTORICAL_FORK_UNAVAILABLE })
        return
      }
      if (parentRecord?.designProfile) {
        preparedDesignFork = await cloneDesignDocument({
          workspaceRoot: parentRecord.workspace ?? get().workspaceRoot,
          sourceTarget: parentRecord.designProfile.documentTarget,
          operation: { kind: 'fork', sourceId: activeThreadId, relation: 'fork' }
        })
      }
      const providerOptions: ForkProviderOptions = {
        ...(turnId ? { turnId } : {}),
        ...(preparedDesignFork
          ? {
              designDocumentTarget: preparedDesignFork.designDocumentTarget,
              designCloneOperationId: preparedDesignFork.operationId
            }
          : {})
      }
      await preparedDesignFork?.markRuntimeRequestStarted?.()
      const forked = await provider.forkThread(
        activeThreadId,
        Object.keys(providerOptions).length > 0 ? providerOptions : undefined
      )
      await finishFork(forked)
    } catch (error) {
      if (!forkCommitted && preparedDesignFork) {
        const outcome = await resolvePreparedDesignCloneAfterError(
          provider, preparedDesignFork, error
        )
        if (outcome.kind === 'committed') {
          await finishFork(outcome.thread)
          return
        }
      }
      set({
        error: formatRuntimeError(error),
        ...(shouldOpenSettingsForError(error)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  }
}
