import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CODE_PANEL_PREFERRED, fitWorkbenchWidths, workbenchWidthConstraintsForRightPanel } from '../workbench-layout-storage'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { fitRoomWorkbenchWidth } from './useRoomWorkbenchLayout'
import { useRoomPresentationPreferences } from './room-presentation-preferences'

describe('room right workspace layout', () => {
  it('keeps recovery actions on a wrapping row above the composer beside the sidebar', () => {
    const css = readFileSync(new URL('./rooms-direct.css', import.meta.url), 'utf8')
    const actions = css.match(/\.direct-failed\s*>\s*\.direct-failed-actions\s*\{([^}]+)\}/)?.[1]
    expect(actions).toMatch(/flex:\s*1 1 100%/)
    expect(actions).toMatch(/flex-wrap:\s*wrap/)
    expect(actions).toMatch(/min-width:\s*0/)
  })
  it('uses Code width constraints inside the available conversation stage', () => {
    for (const available of [800, 1060, 1440, 1800]) {
      const code = fitWorkbenchWidths(available, 0, CODE_PANEL_PREFERRED,
        { leftPanelVisible: false, rightPanelVisible: true },
        workbenchWidthConstraintsForRightPanel('chat', BUILTIN_RIGHT_PANEL_IDS.files))
      expect(fitRoomWorkbenchWidth(available, CODE_PANEL_PREFERRED)).toBe(code.right)
    }
  })
  it('defaults to Code width without changing the legacy details drawer preference', () => {
    expect(useRoomPresentationPreferences.getState().workbenchWidth).toBe(CODE_PANEL_PREFERRED)
    expect(useRoomPresentationPreferences.getState().detailWidth).toBe(400)
  })
  it('can widen beyond the old details cap and stays in a very narrow stage', () => {
    expect(fitRoomWorkbenchWidth(1800, 1000)).toBe(1000)
    expect(fitRoomWorkbenchWidth(220, 560)).toBeLessThanOrEqual(220 - 48 - 9)
  })
})
