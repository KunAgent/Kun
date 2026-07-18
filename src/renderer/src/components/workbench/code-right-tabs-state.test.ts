import { describe, expect, it } from 'vitest'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  activateCodeRightTab,
  closeCodeRightTab,
  collapseCodeRightTabs,
  emptyCodeRightTabsState,
  expandCodeRightTabs,
  migrateLegacyRightPanelMode,
  normalizeCodeRightTabsState,
  normalizeStoredCodeRightTabsRegistry,
  openCodeRightTab,
  retainCodeRightTabs
} from './code-right-tabs-state'

describe('code right tab state', () => {
  it('opens singleton tools and activates an existing tab without duplication', () => {
    const withFiles = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.files)
    const withSubagents = openCodeRightTab(withFiles, BUILTIN_RIGHT_PANEL_IDS.subagents)
    const reopenedFiles = openCodeRightTab(withSubagents, BUILTIN_RIGHT_PANEL_IDS.files)

    expect(reopenedFiles.tabs).toEqual([
      BUILTIN_RIGHT_PANEL_IDS.files,
      BUILTIN_RIGHT_PANEL_IDS.subagents
    ])
    expect(reopenedFiles.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.files)
    expect(reopenedFiles.expanded).toBe(true)
  })

  it('selects the right neighbor, then left neighbor, when closing tabs', () => {
    let state = emptyCodeRightTabsState()
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.files)
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.browser)
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.subagents)
    state = activateCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.browser)

    state = closeCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.browser)
    expect(state.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.subagents)
    state = closeCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.subagents)
    expect(state.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.files)
    state = closeCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.files)
    expect(state).toEqual(emptyCodeRightTabsState())
  })

  it('collapses without discarding tabs and expands the retained selection', () => {
    const opened = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.browser)
    const collapsed = collapseCodeRightTabs(opened)
    expect(collapsed.tabs).toEqual([BUILTIN_RIGHT_PANEL_IDS.browser])
    expect(collapsed.expanded).toBe(false)
    expect(expandCodeRightTabs(collapsed)).toEqual(opened)
  })

  it('expands an empty workspace without selecting a default tool', () => {
    const expanded = expandCodeRightTabs(emptyCodeRightTabsState())

    expect(expanded).toEqual({
      version: 1,
      tabs: [],
      activeId: null,
      expanded: true
    })
    expect(normalizeCodeRightTabsState(expanded)).toEqual(expanded)
  })

  it('migrates legacy short and fully qualified modes', () => {
    expect(migrateLegacyRightPanelMode('browser')).toMatchObject({
      tabs: [BUILTIN_RIGHT_PANEL_IDS.browser],
      activeId: BUILTIN_RIGHT_PANEL_IDS.browser,
      expanded: true
    })
    expect(migrateLegacyRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.files).tabs).toEqual([
      BUILTIN_RIGHT_PANEL_IDS.files
    ])
    expect(migrateLegacyRightPanelMode('removed-mode')).toEqual(emptyCodeRightTabsState())
    expect(migrateLegacyRightPanelMode('sdd-ai')).toEqual(emptyCodeRightTabsState())
    expect(migrateLegacyRightPanelMode('terminal')).toEqual(emptyCodeRightTabsState())
  })

  it('normalizes duplicates and fails closed for invalid persisted values', () => {
    const state = normalizeCodeRightTabsState({
      version: 1,
      tabs: [
        BUILTIN_RIGHT_PANEL_IDS.files,
        'bad',
        BUILTIN_RIGHT_PANEL_IDS.terminal,
        BUILTIN_RIGHT_PANEL_IDS.files
      ],
      activeId: 'bad',
      expanded: true
    })
    expect(state).toEqual({
      version: 1,
      tabs: [BUILTIN_RIGHT_PANEL_IDS.files],
      activeId: BUILTIN_RIGHT_PANEL_IDS.files,
      expanded: true
    })
    expect(normalizeStoredCodeRightTabsRegistry({ version: 9 })).toEqual({
      version: 1,
      workspaces: {}
    })
    expect(openCodeRightTab(
      emptyCodeRightTabsState(),
      BUILTIN_RIGHT_PANEL_IDS.terminal
    )).toEqual(emptyCodeRightTabsState())
  })

  it('removes unavailable contributions without disturbing retained order', () => {
    let state = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.files)
    state = openCodeRightTab(state, 'extension:acme.tools/issues')
    state = openCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.subagents)
    const retained = retainCodeRightTabs(
      state,
      new Set([BUILTIN_RIGHT_PANEL_IDS.files, BUILTIN_RIGHT_PANEL_IDS.subagents])
    )
    expect(retained.tabs).toEqual([
      BUILTIN_RIGHT_PANEL_IDS.files,
      BUILTIN_RIGHT_PANEL_IDS.subagents
    ])
    expect(retained.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.subagents)
  })
})
