import { useMemo } from 'react'
import { useChatStore } from '../store/chat-store'

type WorkspaceThread = {
  id: string
  workspace?: string
}

/**
 * Extension discovery, trust, Views and commands must use the same workspace
 * as the active Agent thread. A selected project is only the fallback before
 * a thread exists.
 */
export function resolveActiveExtensionWorkspaceRoot(
  activeThreadId: string | null | undefined,
  threads: readonly WorkspaceThread[],
  fallbackWorkspaceRoot: string
): string {
  const threadWorkspace = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)?.workspace?.trim()
    : undefined
  return threadWorkspace || fallbackWorkspaceRoot.trim()
}

export function useActiveExtensionWorkspaceRoot(): string {
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const threads = useChatStore((state) => state.threads)
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  return useMemo(
    () => resolveActiveExtensionWorkspaceRoot(activeThreadId, threads, workspaceRoot),
    [activeThreadId, threads, workspaceRoot]
  )
}
