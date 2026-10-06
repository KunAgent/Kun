import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkAssistantNavigation } from './work-assistant-navigation'

beforeEach(() => useWorkAssistantNavigation.setState({ surface: 'assistant', previous: null, docked: false }))
describe('Work assistant presentation navigation', () => {
  it('defaults inside Work without writing startup mode or persistence', () => {
    expect(useWorkAssistantNavigation.getState().surface).toBe('assistant')
    expect(useWorkAssistantNavigation.getState().previous).toBeNull()
  })
  it('docks and expands idempotently and restores the prior presentation', () => {
    const nav = useWorkAssistantNavigation.getState()
    nav.openWorkspace()
    nav.openWorkspace()
    expect(useWorkAssistantNavigation.getState()).toMatchObject({ surface: 'workspace', previous: 'assistant' })
    nav.openAssistant()
    nav.openAssistant()
    expect(useWorkAssistantNavigation.getState()).toMatchObject({ surface: 'assistant', previous: 'workspace' })
    nav.back()
    expect(useWorkAssistantNavigation.getState().surface).toBe('workspace')
    nav.back()
    expect(useWorkAssistantNavigation.getState().surface).toBe('assistant')
  })
  it('keeps an explicit research docking request until another navigation', () => {
    const nav = useWorkAssistantNavigation.getState()
    nav.dockAssistant()
    expect(useWorkAssistantNavigation.getState()).toMatchObject({ surface: 'workspace', docked: true })
    nav.openAssistant()
    expect(useWorkAssistantNavigation.getState()).toMatchObject({ surface: 'assistant', docked: false })
    nav.dockAssistant()
    nav.openWorkspace()
    expect(useWorkAssistantNavigation.getState()).toMatchObject({ surface: 'workspace', docked: false })
  })

})
