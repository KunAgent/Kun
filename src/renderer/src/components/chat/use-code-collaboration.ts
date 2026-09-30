import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { formatRuntimeError } from '../../lib/format-runtime-error'
import { useAdeEnabled } from '../ade/use-ade-enabled'
import { enableKunCollaboration } from './enable-kun-collaboration'

/** Persists task-level collaboration without changing an accepted turn's tools. */
export function useCodeCollaboration({
  activeThreadId,
  activeThread,
  harnessId,
  busy
}: {
  activeThreadId: string | null
  activeThread: NormalizedThread | null
  harnessId: string
  busy: boolean
}) {
  const { t } = useTranslation('common')
  const { enabled: collaborationAvailable } = useAdeEnabled()
  const draftEnabled = useChatStore((state) => state.composerCollaborationEnabled)
  const collaborationEnabled = activeThreadId
    ? activeThread?.collaboration?.enabled ?? (activeThread?.workspaceMode === 'ade')
    : draftEnabled === true
  const [collaborationBusy, setCollaborationBusy] = useState(false)
  const [collaborationError, setCollaborationError] = useState<string | null>(null)
  const operation = useRef(0)

  useEffect(() => {
    operation.current += 1
    setCollaborationBusy(false)
    setCollaborationError(null)
    return () => { operation.current += 1 }
  }, [activeThreadId])

  const toggleCollaboration = async (): Promise<void> => {
    if (!collaborationAvailable) {
      useChatStore.getState().openSettings('agentsCollaboration')
      return
    }
    if (harnessId !== 'kun' && !collaborationEnabled) {
      setCollaborationError(t('codeCollaborationRequiresKun'))
      return
    }
    if (busy || collaborationBusy) return
    if (!activeThreadId) {
      const state = useChatStore.getState()
      if (!collaborationEnabled) state.setComposerHarness('kun', '')
      useChatStore.setState({
        composerCollaborationEnabled: !collaborationEnabled,
        composerProjectCollaborationExplicitWorkspaceRoot: normalizeWorkspaceRoot(state.workspaceRoot)
      })
      return
    }
    const request = ++operation.current
    setCollaborationBusy(true)
    setCollaborationError(null)
    try {
      const threadId = activeThreadId
      const provider = getProvider()
      const selection = useChatStore.getState()
      if (!collaborationEnabled && selection.composerHarnessId === 'kun') {
        const result = await enableKunCollaboration(threadId, {
          model: selection.composerModel, providerId: selection.composerProviderId
        })
        useChatStore.setState((current) => ({ threads: current.threads.map((item) => item.id === threadId ? {
          ...item, collaboration: { enabled: result.current.collaborationEnabled, everEnabled: true },
          ...(result.current.route.harnessId ? { harnessId: result.current.route.harnessId } : {})
        } : item) }))
        void useChatStore.getState().refreshThreads()
        return
      }
      if (!provider.updateThreadCollaboration) {
        throw new Error(t('codeCollaborationUnavailable'))
      }
      const updated = await provider.updateThreadCollaboration(threadId, !collaborationEnabled)
      useChatStore.setState((current) => ({
        threads: current.threads.map((item) => item.id === threadId
          ? { ...item, collaboration: updated.collaboration } : item),
        adeThreads: current.adeThreads.map((item) => item.id === threadId
          ? { ...item, collaboration: updated.collaboration } : item)
      }))
    } catch (error) {
      if (operation.current === request) {
        setCollaborationError(formatRuntimeError(error))
      }
    } finally {
      if (operation.current === request) setCollaborationBusy(false)
    }
  }

  return {
    collaborationAvailable,
    collaborationEnabled,
    collaborationBusy,
    collaborationError,
    dismissCollaborationError: () => setCollaborationError(null),
    toggleCollaboration
  }
}
