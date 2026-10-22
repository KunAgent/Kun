import { describe, expect, it } from 'vitest'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isRightPanelContributionId,
  legacyRightPanelId,
  normalizeStoredRightPanelId,
  workerIdFromSessionTab,
  workerSessionTabId
} from './contribution-ids'

describe('right panel contribution identity migration', () => {
  it('migrates supported legacy modes and drops the retired perspective panel', () => {
    expect(normalizeStoredRightPanelId('changes')).toBe(BUILTIN_RIGHT_PANEL_IDS.changes)
    expect(normalizeStoredRightPanelId('browser')).toBe(BUILTIN_RIGHT_PANEL_IDS.browser)
    expect(normalizeStoredRightPanelId('terminal')).toBe(BUILTIN_RIGHT_PANEL_IDS.terminal)
    expect(normalizeStoredRightPanelId('files')).toBe(BUILTIN_RIGHT_PANEL_IDS.files)
    expect(normalizeStoredRightPanelId('side-conversations')).toBe(
      BUILTIN_RIGHT_PANEL_IDS.sideConversations
    )
    expect(normalizeStoredRightPanelId('sdd-ai')).toBe(BUILTIN_RIGHT_PANEL_IDS.sddAi)
    expect(normalizeStoredRightPanelId('canvas')).toBe(BUILTIN_RIGHT_PANEL_IDS.canvas)
    expect(normalizeStoredRightPanelId('agent-perspective')).toBeNull()
  })

  it('preserves valid extension IDs and ignores stale or malformed layout values', () => {
    const extensionId = 'extension:acme.issues/issues'
    expect(normalizeStoredRightPanelId(extensionId)).toBe(extensionId)
    expect(isRightPanelContributionId(extensionId)).toBe(true)
    expect(normalizeStoredRightPanelId('extension:../escape/view')).toBeNull()
    expect(normalizeStoredRightPanelId('todo')).toBeNull()
    expect(normalizeStoredRightPanelId('builtin:right-panel-todo')).toBeNull()
    expect(normalizeStoredRightPanelId('removed-panel')).toBeNull()
  })

  it('addresses one tab per worker conversation and rejects malformed worker ids', () => {
    const id = workerSessionTabId('thr_worker-1')
    expect(isRightPanelContributionId(id)).toBe(true)
    expect(workerIdFromSessionTab(id)).toBe('thr_worker-1')
    expect(legacyRightPanelId(id)).toBeNull()
    expect(isRightPanelContributionId('builtin:right-panel-worker:')).toBe(false)
    expect(isRightPanelContributionId('builtin:right-panel-worker:../escape')).toBe(false)
    expect(workerIdFromSessionTab(BUILTIN_RIGHT_PANEL_IDS.workers)).toBeNull()
  })
})
