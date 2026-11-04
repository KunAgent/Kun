import { describe, expect, it } from 'vitest'
import { petSurfaceLayout } from './pet-layout'

const input = {
  anchor: { anchorX: 210, anchorY: 320, viewportWidth: 420, viewportHeight: 640 },
  petWidth: 112, controls: { width: 140, height: 44 }, notification: { width: 330, height: 80 }, menu: { width: 136, height: 74 }
}

describe('surfaces around the pet anchor', () => {
  it('keeps the pet fixed when the composer replaces the toolbar or notifications expand', () => {
    const baseline = petSurfaceLayout(input)
    const composing = petSurfaceLayout({ ...input, controls: { width: 330, height: 90 } })
    const expanded = petSurfaceLayout({ ...input, notification: { width: 330, height: 248 }, menu: { width: 208, height: 74 } })
    expect(composing.pet).toEqual(baseline.pet)
    expect(expanded.pet).toEqual(baseline.pet)
    expect(baseline.controlsSide).toBe('below')
    expect(baseline.notificationSide).toBe('above')
  })

  it.each([80, 112, 224])('places all panels below a %ipx pet near the top and above it near the bottom', (petWidth) => {
    const height = Math.round(petWidth * 208 / 192)
    const top = petSurfaceLayout({ ...input, petWidth, anchor: { ...input.anchor, anchorY: 8 + height / 2 } })
    expect(top.controlsSide).toBe('below')
    expect(top.notificationSide).toBe('below')
    expect(top.controls.top).toBeGreaterThanOrEqual(top.pet.top + top.pet.height)
    expect(top.notification.top).toBeGreaterThanOrEqual(top.controls.top + top.controls.height)
    const bottom = petSurfaceLayout({ ...input, petWidth, anchor: { ...input.anchor, anchorY: 640 - 8 - height / 2 } })
    expect(bottom.controlsSide).toBe('above')
    expect(bottom.notificationSide).toBe('above')
    expect(bottom.controls.top + bottom.controls.height).toBeLessThanOrEqual(bottom.pet.top)
    expect(bottom.notification.top + bottom.notification.height).toBeLessThanOrEqual(bottom.controls.top)
  })

  it.each([64, 356])('keeps wide input, notifications and menus on screen beside horizontal edge %i', (anchorX) => {
    const layout = petSurfaceLayout({ ...input, controls: { width: 330, height: 90 }, anchor: { ...input.anchor, anchorX } })
    for (const rect of [layout.controls, layout.notification, layout.menu]) {
      expect(rect.left).toBeGreaterThanOrEqual(8)
      expect(rect.top).toBeGreaterThanOrEqual(8)
      expect(rect.left + rect.width).toBeLessThanOrEqual(412)
      expect(rect.top + rect.height).toBeLessThanOrEqual(632)
    }
  })
})
