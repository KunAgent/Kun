import { beforeEach, describe, expect, it } from 'vitest'
import { activePaperViewId } from './write-editor-layout'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { ensureWorkAssistantScope, revealWorkAssistant } from './work-assistant-scope'
import { useWorkAssistantNavigation } from './work-assistant-navigation'

beforeEach(() => {
  useWriteWorkspaceStore.setState({ workspaceRoot: '/papers', workSurface: 'papers', paperResearch: { agentTab: true, sessionId: null } })
  useWriteWorkspaceStore.getState().openPaperViewTab('discover:search')
  useWorkAssistantNavigation.setState({ surface: 'workspace', previous: null, docked: false })
})
describe('Work assistant scope admission', () => {
  it('moves only an unbound research draft to the library before generic conversation entry', () => {
    revealWorkAssistant()
    expect(activePaperViewId(useWriteWorkspaceStore.getState().editorLayout)).toBe('library')
    expect(useWorkAssistantNavigation.getState().surface).toBe('assistant')
  })
  it('preserves the existing real research session and its resource', () => {
    useWriteWorkspaceStore.setState({ paperResearch: { agentTab: true, sessionId: 'rs-existing' } })
    expect(ensureWorkAssistantScope()).toBe(false)
    expect(activePaperViewId(useWriteWorkspaceStore.getState().editorLayout)).toBe('discover:search')
  })
  it('does not change a normal document scope', () => {
    useWriteWorkspaceStore.setState({ workSurface: 'docs', activeFilePath: '/docs/report.md' })
    expect(ensureWorkAssistantScope()).toBe(false)
    expect(useWriteWorkspaceStore.getState().activeFilePath).toBe('/docs/report.md')
  })
})
