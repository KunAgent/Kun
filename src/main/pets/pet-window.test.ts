import { describe, expect, it, vi } from 'vitest'
import { petStopConflict, validatePetStop } from './pet-actions'
import { clampPetBounds, dragBounds, petOverlayFrame, placementFromDip, restorePetBounds } from './pet-geometry'
import { applyPetPlatformPolicy, petPlatformPolicy } from './pet-platform'
import { PetWindowController, type PetWindowLike } from './pet-window'
import type { PetActivitySnapshot } from '../../shared/pets'

describe('pet window policy', () => {
  it('shows one inactive window, skips the taskbar, and keeps macOS workspace calls off other platforms', async () => {
    const windows: FakeWindow[] = []
    const controller = controllerFor('darwin', true, windows)
    await controller.open()
    await controller.open()
    expect(windows).toHaveLength(1)
    expect(windows[0].shownInactive).toBe(1)
    expect(windows[0].shown).toBe(0)
    expect(windows[0].skipTaskbar).toBe(true)
    expect(windows[0].workspace).toEqual([true, { visibleOnFullScreen: true, skipTransformProcessType: true }])
    controller.close()
    expect(windows[0].destroyed).toBe(true)
    const windowsHost = { setSkipTaskbar: () => undefined, setAlwaysOnTop: () => undefined, setVisibleOnAllWorkspaces: () => undefined }
    const spy = viCalls()
    applyPetPlatformPolicy({ ...windowsHost, setSkipTaskbar: spy.skip, setAlwaysOnTop: spy.top, setVisibleOnAllWorkspaces: spy.space }, 'win32')
    expect(spy.space.calls).toEqual([])
  })

  it('uses a bounded Linux window when pointer forwarding is unavailable', () => {
    expect(petPlatformPolicy({ platform: 'linux', forwardMouseEvents: false })).toMatchObject({ mode: 'bounded', note: expect.stringContaining('bounded') })
    expect(petPlatformPolicy({ platform: 'linux', forwardMouseEvents: true }).mode).toBe('passthrough')
    expect(petPlatformPolicy({ platform: 'darwin', forwardMouseEvents: true }).callMacWorkspaceApi).toBe(true)
  })

  it('keeps DIP coordinates inside negative and mixed-scale work areas', () => {
    const saved = placementFromDip({
      display: { id: 'secondary', scaleFactor: 2, workArea: { x: -1600, y: 20, width: 1400, height: 900 } },
      bounds: { x: -1500, y: 40, width: 220, height: 260 },
      mascotWidthPx: 112,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(saved.windowBounds.x).toBe(-1500)
    const restored = restorePetBounds({
      saved: { displayId: 'gone', windowBounds: saved.windowBounds },
      displays: [{ id: 'primary', scaleFactor: 1, workArea: { x: 0, y: 0, width: 800, height: 600 } }],
      fallbackSize: { width: 220, height: 260 }
    })
    expect(restored.display.id).toBe('primary')
    expect(restored.bounds.x).toBeGreaterThanOrEqual(0)
    const visible = { x: -1900, y: 0, width: 180, height: 80 }
    const raw = { x: -2000, y: -20, width: 400, height: 500 }
    const workArea = { x: -100, y: 0, width: 500, height: 400 }
    const clamped = clampPetBounds(raw, workArea, visible)
    const visibleTop = clamped.y + (visible.y - raw.y)
    const visibleLeft = clamped.x + (visible.x - raw.x)
    expect(visibleLeft).toBeGreaterThanOrEqual(workArea.x)
    expect(visibleTop).toBeGreaterThanOrEqual(workArea.y)
    expect(visibleLeft + visible.width).toBeLessThanOrEqual(workArea.x + workArea.width)
  })

  it('authorizes the overlay before loading and destroys it when loading fails', async () => {
    const windows: FakeWindow[] = []
    let senderDuringLoad: number | null = null
    let controller: PetWindowController
    controller = controllerFor('darwin', true, windows, async () => { senderDuringLoad = controller.senderId() })
    await controller.open()
    expect(senderDuringLoad).toBe(7)
    expect(windows[0].shownInactive).toBe(1)
    const failed: FakeWindow[] = []
    const broken = controllerFor('darwin', true, failed, async () => { throw new Error('load failed') })
    await expect(broken.open()).rejects.toThrow('load failed')
    expect(broken.senderId()).toBeNull()
    expect(failed[0].destroyed).toBe(true)
    expect(failed[0].shownInactive).toBe(0)
  })

  it('waits for the shared load and ignores a closed window after reopening', async () => {
    const windows: FakeWindow[] = []
    let finishLoad!: () => void
    const loaded = new Promise<void>((resolve) => { finishLoad = resolve })
    let loads = 0
    const controller = controllerFor('darwin', true, windows, () => ++loads === 1 ? loaded : Promise.resolve())
    const first = controller.openAtSaved(null)
    let secondFinished = false
    const concurrent = controller.open().then(() => { secondFinished = true })
    await Promise.resolve()
    expect(secondFinished).toBe(false)
    expect(windows).toHaveLength(1)
    controller.close()
    await controller.openAtSaved(null)
    const replacementBounds = { ...windows[1].bounds }
    finishLoad()
    await Promise.all([first, concurrent])
    expect(windows[0].shownInactive).toBe(0)
    expect(windows[1].shownInactive).toBe(1)
    expect(windows[1].bounds).toEqual(replacementBounds)
    expect(controller.senderId()).toBe(7)
  })

  it('does not close a replacement when the old window load fails', async () => {
    const windows: FakeWindow[] = []
    let failLoad!: (error: Error) => void
    const loaded = new Promise<void>((_resolve, reject) => { failLoad = reject })
    let loads = 0
    const controller = controllerFor('darwin', true, windows, () => ++loads === 1 ? loaded : Promise.resolve())
    const first = controller.open()
    const rejected = expect(first).rejects.toThrow('old load failed')
    controller.close()
    await controller.open()
    failLoad(new Error('old load failed'))
    await rejected
    expect(windows[1].destroyed).toBe(false)
    expect(controller.isOpen()).toBe(true)
  })

  it('keeps a dragged pet inside the target display', () => {
    const workArea = { x: 0, y: 0, width: 1200, height: 800 }
    const origin = { x: 900, y: 100, width: 220, height: 260 }
    const visible = { x: 960, y: 140, width: 140, height: 160 }
    const dragged = dragBounds(origin, 3000, 0, workArea, visible)
    expect(dragged.x).toBe(1000)
    const visibleLeft = dragged.x + (visible.x - origin.x)
    expect(visibleLeft).toBeGreaterThanOrEqual(workArea.x)
    expect(visibleLeft + visible.width).toBeLessThanOrEqual(workArea.x + workArea.width)
  })

  it('reserves a canvas around the pet while keeping that canvas inside the work area', () => {
    const area = { x: -1200, y: 20, width: 1200, height: 800 }
    const fitted = petOverlayFrame({ x: -100, y: 100 }, area)
    expect(fitted).toEqual({ x: -420, y: 20, width: 420, height: 640 })
  })

  it('follows the display under the pointer without letting panel bounds move the pet', async () => {
    const windows: FakeWindow[] = []
    const controller = new PetWindowController({
      platform: 'darwin',
      forwardMouseEvents: true,
      createWindow: () => {
        const window = new FakeWindow()
        windows.push(window)
        return window
      },
      displays: () => [
        { id: 'primary', scaleFactor: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } },
        { id: 'secondary', scaleFactor: 1, workArea: { x: 1200, y: 0, width: 1200, height: 800 } }
      ],
      cursor: () => ({ x: 0, y: 0 }),
      load: async () => undefined,
      onDisplayChange: () => () => undefined
    }, async () => undefined)
    await controller.open()
    const before = { ...windows[0].bounds }
    const anchor = controller.layout()
    controller.reportBounds({ width: 300, height: 400, anchorX: 0, anchorY: 0 })
    expect(windows[0].bounds).toEqual(before)
    expect(controller.layout()).toEqual(anchor)
    controller.beginDrag({ x: 1000, y: 600 })
    controller.moveDrag({ x: 1700, y: 600 })
    expect(windows[0].bounds.x).toBeGreaterThanOrEqual(1200)
    expect(windows[0].bounds.x + windows[0].bounds.width).toBeLessThanOrEqual(2400)
  })

  it('keeps the sprite width when a drag saves the window position', async () => {
    const windows: FakeWindow[] = []
    let savedWidth = 0
    const controller = new PetWindowController({
      platform: 'darwin',
      forwardMouseEvents: true,
      createWindow: () => {
        const window = new FakeWindow()
        windows.push(window)
        return window
      },
      displays: () => [{ id: 'primary', scaleFactor: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } }],
      cursor: () => ({ x: 0, y: 0 }),
      load: async () => undefined,
      onDisplayChange: () => () => undefined
    }, async (placement) => { savedWidth = placement.mascotWidthPx })
    controller.setSpriteWidth(112)
    await controller.open()
    controller.beginDrag({ x: 10, y: 10 })
    controller.moveDrag({ x: 40, y: 10 })
    controller.endDrag({ x: 40, y: 10 })
    await Promise.resolve()
    expect(windows[0].bounds.width).toBe(420)
    expect(savedWidth).toBe(112)
  })

  it('persists the pet center independently of panels and restores that exact anchor', async () => {
    const windows: FakeWindow[] = []
    let saved: ReturnType<typeof placementFromDip> | null = null
    const controller = new PetWindowController({
      platform: 'darwin', forwardMouseEvents: true,
      createWindow: () => { const window = new FakeWindow(); windows.push(window); return window },
      displays: () => [{ id: 'primary', scaleFactor: 2, workArea: { x: 0, y: 0, width: 1200, height: 800 } }],
      cursor: () => ({ x: 0, y: 0 }), load: async () => undefined, onDisplayChange: () => () => undefined
    }, async (placement) => { saved = placement })
    await controller.openAtSaved({ displayId: 'primary', windowBounds: { x: 0, y: 0, width: 146, height: 159 }, petCenter: { x: 400, y: 300 } })
    const world = () => ({ x: windows.at(-1)!.bounds.x + controller.layout().anchorX,
      y: windows.at(-1)!.bounds.y + controller.layout().anchorY })
    expect(world()).toEqual({ x: 400, y: 300 })
    controller.reportBounds({ width: 400, height: 600, anchorX: 0, anchorY: 0 })
    await controller.openAtSaved({ displayId: 'primary', windowBounds: { x: 900, y: 600, width: 200, height: 180 } })
    expect(world()).toEqual({ x: 400, y: 300 })
    await controller.finishResize(128)
    expect(world()).toEqual({ x: 400, y: 300 })
    expect(saved).toMatchObject({ petCenter: { x: 400, y: 300 }, mascotWidthPx: 128 })
    controller.close()
    await controller.openAtSaved(saved)
    expect(world()).toEqual({ x: 400, y: 300 })
  })

  it('clamps the pet on a negative-coordinate display instead of jumping to the primary display', async () => {
    const windows: FakeWindow[] = []
    const changed = vi.fn()
    const controller = new PetWindowController({
      platform: 'darwin', forwardMouseEvents: true,
      createWindow: () => { const window = new FakeWindow(); windows.push(window); return window },
      displays: () => [
        { id: 'primary', scaleFactor: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } },
        { id: 'left', scaleFactor: 2, workArea: { x: -1400, y: 0, width: 1400, height: 900 } }
      ],
      cursor: () => ({ x: -700, y: 300 }), load: async () => undefined,
      layoutChanged: changed, onDisplayChange: () => () => undefined
    }, async () => undefined)
    await controller.openAtSaved({ displayId: 'left', windowBounds: { x: -900, y: 200, width: 200, height: 200 },
      petCenter: { x: -700, y: 300 } })
    controller.beginDrag({ x: -700, y: 300 })
    controller.endDrag({ x: -3000, y: -1000 })
    const layout = controller.layout()
    expect(windows[0].bounds.x + layout.anchorX).toBe(-1400 + 8 + 56)
    expect(windows[0].bounds.y + layout.anchorY).toBe(8 + 121 / 2)
    expect(changed).toHaveBeenCalled()
  })

  it('rejects a stale stop without interrupting the replacement turn', () => {
    const snapshot: PetActivitySnapshot = {
      generation: 1,
      profileKey: 'profile',
      emittedAtMs: 1,
      items: [{
        key: 'k', generation: 1, status: 'running', threadId: 'thr', unitId: 'unit', turnId: 'turn-1',
        stateSince: '2026-01-01T00:00:00.000Z', title: 'Run', stalled: false, navigable: true,
        bubbleAllowed: true, updatedAtMs: 1
      }]
    }
    const stale = validatePetStop({ request: { type: 'stop', threadId: 'thr', turnId: 'turn-0' }, snapshot })
    expect(stale?.ok).toBe(false)
    if (stale && !stale.ok) expect(stale.code).toBe('conflict')
    expect(validatePetStop({ request: { type: 'stop', threadId: 'thr', turnId: 'turn-1' }, snapshot })).toBeNull()
    const conflict = petStopConflict(409)
    if (!conflict || conflict.ok) throw new Error('expected conflict')
    expect(conflict.code).toBe('conflict')
    expect(petStopConflict(200)).toBeNull()
  })
})

function controllerFor(platform: NodeJS.Platform, forward: boolean, windows: FakeWindow[], load: () => Promise<void> = async () => undefined): PetWindowController {
  return new PetWindowController({
    platform,
    forwardMouseEvents: forward,
    createWindow: () => {
      const window = new FakeWindow()
      windows.push(window)
      return window
    },
    displays: () => [{ id: 'primary', scaleFactor: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } }],
    cursor: () => ({ x: 0, y: 0 }),
    load,
    onDisplayChange: () => () => undefined
  }, async () => undefined)
}

class FakeWindow implements PetWindowLike {
  id = 1
  destroyed = false
  shownInactive = 0
  shown = 0
  skipTaskbar = false
  workspace: unknown[] | null = null
  bounds = { x: 0, y: 0, width: 220, height: 260 }
  webContents = {
    id: 7,
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
    send: () => undefined,
    isLoading: () => false
  }
  isDestroyed(): boolean { return this.destroyed }
  getBounds() { return this.bounds }
  setBounds(bounds: FakeWindow['bounds']): void { this.bounds = bounds }
  showInactive(): void { this.shownInactive += 1 }
  show(): void { this.shown += 1 }
  destroy(): void { this.destroyed = true }
  hide(): void { this.shown = 0 }
  setIgnoreMouseEvents(): void { undefined }
  setSkipTaskbar(skip: boolean): void { this.skipTaskbar = skip }
  setAlwaysOnTop(): void { undefined }
  setVisibleOnAllWorkspaces(visible: boolean, options?: unknown): void { this.workspace = [visible, options] }
  loadURL(): Promise<void> { return Promise.resolve() }
  loadFile(): Promise<void> { return Promise.resolve() }
}

function viCalls(): { skip: (value: boolean) => void; top: () => void; space: ((...args: unknown[]) => void) & { calls: unknown[][] } } {
  const space = ((...args: unknown[]) => { space.calls.push(args) }) as ((...args: unknown[]) => void) & { calls: unknown[][] }
  space.calls = []
  return { skip: () => undefined, top: () => undefined, space }
}
