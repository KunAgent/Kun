import { useWriteWorkspaceStore } from './write-workspace-store'
import { useWorkAssistantNavigation } from './work-assistant-navigation'
import { paperResearchStageActive } from '../paper/paper-view'

/** The research draft is a form, never a bindable conversation resource. */
export function ensureWorkAssistantScope(): boolean {
  const state = useWriteWorkspaceStore.getState()
  if (!paperResearchStageActive(state) || state.paperResearch.sessionId) return false
  state.openPaperViewTab('library')
  return true
}

export function revealWorkAssistant(): void {
  ensureWorkAssistantScope()
  useWorkAssistantNavigation.getState().openAssistant()
}
