import { describe, expect, it } from 'vitest'
import {
  collapseWriteRightPanelState,
  normalizeWriteRightPanelState,
  openWriteRightPanelState,
  parseStoredWriteRightPanelState,
  serializeWriteRightPanelState,
  toggleWriteRightPanelState,
  writeAssistantOpenFor
} from './write-right-panel-state'

describe('write right panel state', () => {
  it('toggles: the visible tool collapses, any other tool opens', () => {
    const open = { expanded: true, activeId: 'assistant' as const }
    expect(toggleWriteRightPanelState(open, 'assistant')).toEqual({ expanded: false, activeId: 'assistant' })
    expect(toggleWriteRightPanelState(open, 'outline')).toEqual({ expanded: true, activeId: 'outline' })
    expect(toggleWriteRightPanelState({ expanded: false, activeId: 'outline' }, 'outline'))
      .toEqual({ expanded: true, activeId: 'outline' })
  })

  it('opens and collapses without losing the active tool', () => {
    const collapsed = collapseWriteRightPanelState({ expanded: true, activeId: 'review' })
    expect(collapsed).toEqual({ expanded: false, activeId: 'review' })
    expect(openWriteRightPanelState(collapsed, 'history')).toEqual({ expanded: true, activeId: 'history' })
  })

  it('projects the legacy assistantOpen flag', () => {
    expect(writeAssistantOpenFor({ expanded: true, activeId: 'assistant' })).toBe(true)
    expect(writeAssistantOpenFor({ expanded: true, activeId: 'outline' })).toBe(false)
    expect(writeAssistantOpenFor({ expanded: false, activeId: 'assistant' })).toBe(false)
  })

  it('round-trips the stored record and migrates the legacy flag', () => {
    const state = { expanded: false, activeId: 'references' as const }
    expect(parseStoredWriteRightPanelState(serializeWriteRightPanelState(state), '1')).toEqual(state)
    expect(parseStoredWriteRightPanelState(null, '0')).toEqual({ expanded: false, activeId: 'assistant' })
    expect(parseStoredWriteRightPanelState(null, null)).toEqual({ expanded: true, activeId: 'assistant' })
    expect(parseStoredWriteRightPanelState('{bad json', '0')).toEqual({ expanded: false, activeId: 'assistant' })
  })

  it('rejects unknown tools and malformed records', () => {
    expect(normalizeWriteRightPanelState({ expanded: true, activeId: 'terminal' })).toBeNull()
    expect(normalizeWriteRightPanelState({ expanded: 'yes', activeId: 'outline' })).toBeNull()
    expect(normalizeWriteRightPanelState(null)).toBeNull()
  })
})
