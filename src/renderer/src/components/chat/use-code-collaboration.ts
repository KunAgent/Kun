import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { formatRuntimeError } from '../../lib/format-runtime-error'

/** Persists task-level collaboration without changing an accepted turn's tools. */
export function useCodeCollaboration({
  activeThreadId,
  activeThread,
  harnessId: _harnessId,
  busy
}: {
  activeThreadId: string | null
  activeThread: NormalizedThread | null
  harnessId: string
  busy: boolean
}) {
  const { t } = useTranslation('common')
  const collaborationAvailable = true
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
    if (busy || collaborationBusy) return
    if (!activeThreadId) {
      const state = useChatStore.getState()
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
