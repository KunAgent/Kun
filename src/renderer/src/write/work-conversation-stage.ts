import { createContext } from 'react'
import { useRemoteMobileLayout } from '../lib/remote-mobile'
import { useWriteWorkspaceStore } from './write-workspace-store'
import type { WriteWorkspaceState } from './write-workspace-store-types'

type StageInput = Pick<
  WriteWorkspaceState,
  'workSurface' | 'workspaceRoot' | 'activeWhiteboardId' | 'editorLayout'
>

/**
 * With nothing open on the documents surface the Work assistant takes the
 * center, the way a Code conversation does; opening a document docks it back
 * into the right panel.
 */
export function selectWorkConversationStage(state: StageInput): boolean {
  return state.workSurface === 'docs' &&
    state.workspaceRoot.trim().length > 0 &&
    !state.activeWhiteboardId &&
    state.editorLayout.groups.every((group) => group.tabs.length === 0)
}

/** Phone layouts keep the overlay assistant; only desktop moves it to the center. */
export function useWorkConversationStage(): boolean {
  const remoteMobile = useRemoteMobileLayout()
  const stage = useWriteWorkspaceStore(selectWorkConversationStage)
  return stage && !remoteMobile
}

/** Left-sidebar control for the centered assistant, which has no tab bar. */
export type WorkStageChrome = { leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void }
export const WorkStageChromeContext = createContext<WorkStageChrome | null>(null)
