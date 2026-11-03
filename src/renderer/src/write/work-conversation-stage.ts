import { createContext } from 'react'
import { useRemoteMobileLayout } from '../lib/remote-mobile'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { useWorkSlotsStore } from './work-slots-store'
import type { WriteWorkspaceState } from './write-workspace-store-types'

type StageInput = Pick<WriteWorkspaceState, 'workspaceRoot' | 'activeWhiteboardId' | 'editorLayout'>

/**
 * With nothing open the Work assistant takes the center, the way a Code
 * conversation does; opening a document, whiteboard or paper page docks it
 * back into the right panel.
 */
export function selectWorkConversationStage(state: StageInput): boolean {
  return state.workspaceRoot.trim().length > 0 &&
    !state.activeWhiteboardId &&
    state.editorLayout.groups.every((group) => group.tabs.length === 0)
}

/** True when nothing is open and the assistant fills the center by itself. */
export function useWorkAssistantAlone(): boolean {
  const remoteMobile = useRemoteMobileLayout()
  const stage = useWriteWorkspaceStore(selectWorkConversationStage)
  return stage && !remoteMobile
}

/** Files are open but the session was moved to the main slot; they dock to the side. */
export function useWorkAssistantSwapped(): boolean {
  const remoteMobile = useRemoteMobileLayout()
  const alone = useWriteWorkspaceStore(selectWorkConversationStage)
  const assistantMain = useWorkSlotsStore((state) => state.assistantMain)
  const hasWorkspace = useWriteWorkspaceStore((state) => state.workspaceRoot.trim().length > 0)
  return hasWorkspace && assistantMain && !alone && !remoteMobile
}

/**
 * The assistant owns the main slot: alone with nothing open, or swapped
 * with the open files docked beside it. Phone layouts keep the overlay
 * assistant; only desktop moves it to the center.
 */
export function useWorkConversationStage(): boolean {
  const alone = useWorkAssistantAlone()
  const swapped = useWorkAssistantSwapped()
  return alone || swapped
}

/** Left-sidebar control for the centered assistant, which has no tab bar. */
export type WorkStageChrome = { leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void }
export const WorkStageChromeContext = createContext<WorkStageChrome | null>(null)
