import { describe, expect, it } from 'vitest'
import {
  captureResizePointer,
  fitWorkbenchWidths,
  initialCodeRightTabsForLaunch,
  normalizeStoredCodeRightWidthsRegistry,
  RAIL_WIDTH,
  WORKBENCH_RESIZE_CLASS,
  workbenchWidthConstraintsForRightPanel
} from './workbench-layout'
import { BUILTIN_RIGHT_PANEL_IDS } from '../extensions/contribution-ids'

describe('fitWorkbenchWidths', () => {
  it('lets ordinary Code tabs use the available workspace width', () => {
    const next = fitWorkbenchWidths(
      1800,
      304,
      1400,
      { leftPanelVisible: true, rightPanelVisible: true },
      workbenchWidthConstraintsForRightPanel('chat', BUILTIN_RIGHT_PANEL_IDS.browser)
    )

    expect(next.left).toBe(304)
    expect(next.right).toBe(878)
  })

  it('uses the same wide workspace constraints for the code canvas', () => {
    const next = fitWorkbenchWidths(
      1800,
      304,
      1400,
      { leftPanelVisible: true, rightPanelVisible: true },
      workbenchWidthConstraintsForRightPanel('chat', BUILTIN_RIGHT_PANEL_IDS.canvas)
    )

    expect(next.left).toBe(304)
    expect(next.right).toBeGreaterThan(760)
    expect(next.right).toBe(878)
  })

  it.each([1280, 1440, 2048])(
    'keeps at least 560px for chat at a %dpx workbench width',
    (containerWidth) => {
      const next = fitWorkbenchWidths(
        containerWidth,
        304,
        560,
        { leftPanelVisible: true, rightPanelVisible: true },
        workbenchWidthConstraintsForRightPanel('chat', BUILTIN_RIGHT_PANEL_IDS.files)
      )
      const handleWidth = 10
      expect(containerWidth - handleWidth - RAIL_WIDTH - next.left - next.right).toBeGreaterThanOrEqual(560)
      expect(next.right).toBeGreaterThanOrEqual(280)
    }
  )
})

describe('code right workspace widths', () => {
  it('normalizes isolated workspace widths and ignores invalid entries', () => {
    expect(normalizeStoredCodeRightWidthsRegistry({
      version: 1,
      workspaces: { alpha: 640.4, beta: 'wide', gamma: 120 }
    })).toEqual({
      version: 1,
      workspaces: { alpha: 640, gamma: 280 }
    })
    expect(normalizeStoredCodeRightWidthsRegistry({ version: 2 })).toEqual({
      version: 1,
      workspaces: {}
    })
  })
})

describe('code right workspace startup', () => {
  it('keeps restored tabs but starts with the sidebar collapsed', () => {
    const restored = initialCodeRightTabsForLaunch({
      version: 1,
      tabs: [BUILTIN_RIGHT_PANEL_IDS.browser],
      activeId: BUILTIN_RIGHT_PANEL_IDS.browser,
      expanded: true
    }, null)

    expect(restored).toEqual({
      version: 1,
      tabs: [BUILTIN_RIGHT_PANEL_IDS.browser],
      activeId: BUILTIN_RIGHT_PANEL_IDS.browser,
      expanded: false
    })
  })

  it('does not expand a migrated legacy panel on launch', () => {
    expect(initialCodeRightTabsForLaunch(undefined, BUILTIN_RIGHT_PANEL_IDS.files)).toEqual({
      version: 1,
      tabs: [BUILTIN_RIGHT_PANEL_IDS.files],
      activeId: BUILTIN_RIGHT_PANEL_IDS.files,
      expanded: false
    })
  })
})

describe('captureResizePointer', () => {
  it('keeps a divider drag in the Host while the pointer crosses an embedded Webview', () => {
    let capturedPointer: number | null = null
    const target = {
      setPointerCapture(pointerId: number) {
        capturedPointer = pointerId
      },
      hasPointerCapture(pointerId: number) {
        return capturedPointer === pointerId
      },
      releasePointerCapture(pointerId: number) {
        if (capturedPointer === pointerId) capturedPointer = null
      }
    }

    const release = captureResizePointer(target, 17)
    expect(capturedPointer).toBe(17)

    release()
    expect(capturedPointer).toBeNull()
    expect(WORKBENCH_RESIZE_CLASS).toBe('ds-workbench-resizing')
  })
})
