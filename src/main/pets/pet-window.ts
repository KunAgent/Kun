import { PET_DRAG_THRESHOLD_PX, clampMascotWidth, type PetOverlayBounds, type ScreenPoint } from '../../shared/pets'
import { clampPetBounds, dragBounds, fitPetOverlayWindow, PET_OVERLAY_CONTENT_MARGIN, placementFromDip, restorePetBounds, type PetDisplay, type Rect } from './pet-geometry'
import { applyPetPlatformPolicy, petPlatformPolicy, type PetInteractionMode } from './pet-platform'

export type PetWindowLike = {
  id: number
  isDestroyed(): boolean
  getBounds(): Rect
  setBounds(bounds: Rect): void
  showInactive(): void
  show(): void
  destroy(): void
  hide(): void
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void
  setSkipTaskbar(skip: boolean): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  setVisibleOnAllWorkspaces?(visible: boolean, options?: { visibleOnFullScreen?: boolean; skipTransformProcessType?: boolean }): void
  webContents: {
    id: number
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
    on(event: 'will-navigate' | 'did-finish-load', handler: (event?: { preventDefault(): void; url?: string }) => void): void
    send(channel: string, payload: unknown): void
    isLoading(): boolean
  }
  loadURL(url: string): Promise<void>
  loadFile(file: string): Promise<void>
}

export type PetWindowHost = {
  platform: NodeJS.Platform
  forwardMouseEvents: boolean
  createWindow(): PetWindowLike
  displays(): PetDisplay[]
  cursor(): ScreenPoint
  load(window: PetWindowLike): Promise<void>
  onDisplayChange(handler: () => void): () => void
}

type DragSession = { origin: Rect; cursor: ScreenPoint; moved: boolean; visible: Rect }

export class PetWindowController {
  private window: PetWindowLike | null = null
  private loading: Promise<void> | null = null
  private drag: DragSession | null = null
  private spriteWidth = 112
  private visible: Rect = { x: 0, y: 0, width: 160, height: 180 }
  private unsubscribe: (() => void) | null = null
  readonly policy: ReturnType<typeof petPlatformPolicy>
  navigationDenied: string[] = []

  constructor(private readonly host: PetWindowHost, private readonly persist: (placement: ReturnType<typeof placementFromDip>) => Promise<void>) {
    this.policy = petPlatformPolicy({ platform: host.platform, forwardMouseEvents: host.forwardMouseEvents })
  }

  isOpen(): boolean {
    return Boolean(this.window && !this.window.isDestroyed())
  }

  setSpriteWidth(width: number): void {
    this.spriteWidth = clampMascotWidth(width)
  }

  senderId(): number | null {
    return this.isOpen() ? this.window!.webContents.id : null
  }

  mode(): PetInteractionMode {
    return this.policy.mode
  }

  async open(): Promise<PetWindowLike> {
    if (this.isOpen()) {
      const window = this.window!
      await this.loading
      return window
    }
    const window = this.host.createWindow()
    this.window = window
    try {
      applyPetPlatformPolicy(window, this.host.platform)
      window.webContents.setWindowOpenHandler((details) => {
        this.navigationDenied.push(details.url)
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event) => {
        event?.preventDefault()
        if (event?.url) this.navigationDenied.push(event.url)
      })
      if (this.policy.mode === 'passthrough') window.setIgnoreMouseEvents(true, { forward: this.host.forwardMouseEvents })
      const restored = restorePetBounds({
        saved: null,
        displays: this.host.displays(),
        fallbackSize: { width: 220, height: 260 }
      })
      window.setBounds(restored.bounds)
      this.visible = { ...restored.bounds }
      this.loading = this.host.load(window)
      await this.loading
    } catch (error) {
      if (this.window === window) this.close()
      throw error
    }
    if (this.window !== window || window.isDestroyed()) return window
    window.showInactive()
    this.unsubscribe = this.host.onDisplayChange(() => this.reclamp())
    return window
  }

  async openAtSaved(saved: { displayId: string; windowBounds: Rect } | null): Promise<void> {
    const window = await this.open()
    if (this.window !== window || window.isDestroyed()) return
    const previous = window.getBounds()
    const restored = restorePetBounds({
      saved,
      displays: this.host.displays(),
      fallbackSize: { width: previous.width, height: previous.height }
    })
    window.setBounds(restored.bounds)
    this.shiftVisible(restored.bounds.x - previous.x, restored.bounds.y - previous.y)
  }

  close(): void {
    this.drag = null
    this.unsubscribe?.()
    this.unsubscribe = null
    const window = this.window
    this.window = null
    this.loading = null
    if (window && !window.isDestroyed()) window.destroy()
  }

  setPointerInteractive(interactive: boolean): void {
    if (!this.isOpen() || this.policy.mode === 'bounded') return
    this.window!.setIgnoreMouseEvents(!interactive, { forward: this.host.forwardMouseEvents })
  }

  beginDrag(point: ScreenPoint): void {
    if (!this.isOpen()) return
    this.drag = { origin: this.window!.getBounds(), cursor: point, moved: false, visible: { ...this.visible } }
  }

  moveDrag(point: ScreenPoint): void {
    if (!this.drag || !this.isOpen()) return
    const dx = point.x - this.drag.cursor.x
    const dy = point.y - this.drag.cursor.y
    if (Math.hypot(dx, dy) >= PET_DRAG_THRESHOLD_PX) this.drag.moved = true
    if (!this.drag.moved) return
    const proposed = { ...this.drag.origin, x: this.drag.origin.x + dx, y: this.drag.origin.y + dy }
    const display = this.displayFor(proposed, point)
    const next = dragBounds(this.drag.origin, dx, dy, display.workArea, this.drag.visible)
    this.window!.setBounds(next)
    this.visible = {
      ...this.drag.visible,
      x: this.drag.visible.x + next.x - this.drag.origin.x,
      y: this.drag.visible.y + next.y - this.drag.origin.y
    }
  }

  endDrag(point: ScreenPoint): 'click' | 'drag' | 'cancel' {
    if (!this.drag) return 'cancel'
    this.moveDrag(point)
    const kind = this.drag.moved ? 'drag' : 'click'
    const bounds = this.window?.getBounds()
    this.drag = null
    if (kind === 'drag' && bounds) void this.flush(bounds, this.spriteWidth)
    return kind
  }

  cancelDrag(): void {
    if (!this.drag || !this.isOpen()) {
      this.drag = null
      return
    }
    this.window!.setBounds(this.drag.origin)
    this.visible = { ...this.drag.visible }
    this.drag = null
  }

  resize(width: number): void {
    if (!this.isOpen()) return
    const bounds = this.window!.getBounds()
    const nextWidth = clampMascotWidth(width)
    const height = Math.round(nextWidth * (208 / 192))
    const display = this.displayFor(bounds)
    const next = clampPetBounds({ ...bounds, width: nextWidth + 48, height: height + 80 }, display.workArea)
    this.shiftVisible(next.x - bounds.x, next.y - bounds.y)
    this.window!.setBounds(next)
  }

  async finishResize(width: number): Promise<void> {
    this.setSpriteWidth(width)
    this.resize(width)
    if (this.window) await this.flush(this.window.getBounds(), this.spriteWidth)
  }

  reportBounds(bounds: PetOverlayBounds): void {
    if (!this.isOpen() || this.drag || bounds.width <= 0 || bounds.height <= 0) return
    const current = this.window!.getBounds()
    const fitted = fitPetOverlayWindow(current, bounds)
    const visible = {
      x: fitted.x + PET_OVERLAY_CONTENT_MARGIN,
      y: fitted.y + PET_OVERLAY_CONTENT_MARGIN,
      width: Math.max(1, Math.min(bounds.width, fitted.width - PET_OVERLAY_CONTENT_MARGIN)),
      height: Math.max(1, Math.min(bounds.height, fitted.height - PET_OVERLAY_CONTENT_MARGIN))
    }
    const display = this.displayFor(fitted)
    const next = clampPetBounds(fitted, display.workArea, visible)
    this.visible = { ...visible, x: visible.x + next.x - fitted.x, y: visible.y + next.y - fitted.y }
    if (sameRect(current, next)) return
    this.window!.setBounds(next)
    void this.flush(next, this.spriteWidth)
  }

  send(channel: string, payload: unknown): void {
    if (this.isOpen()) this.window!.webContents.send(channel, payload)
  }

  private reclamp(): void {
    if (!this.isOpen() || this.drag) return
    const bounds = this.window!.getBounds()
    const display = this.displayFor(bounds)
    const next = clampPetBounds(bounds, display.workArea, this.visible.width ? this.visible : bounds)
    this.shiftVisible(next.x - bounds.x, next.y - bounds.y)
    this.window!.setBounds(next)
  }

  private shiftVisible(dx: number, dy: number): void {
    this.visible = { ...this.visible, x: this.visible.x + dx, y: this.visible.y + dy }
  }

  private async flush(bounds: Rect, mascotWidthPx = this.spriteWidth): Promise<void> {
    const display = this.displayFor(bounds)
    await this.persist(placementFromDip({
      display,
      bounds,
      mascotWidthPx: clampMascotWidth(mascotWidthPx),
      updatedAt: new Date().toISOString()
    }))
  }

  private displayFor(bounds: Rect, point?: ScreenPoint): PetDisplay {
    const displays = this.host.displays()
    return displays.find((display) => contains(display.workArea, bounds))
      ?? (point ? displays.find((display) => containsPoint(display.workArea, point)) : undefined)
      ?? displays[0]
      ?? { id: 'primary', workArea: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 }
  }
}

function contains(area: Rect, bounds: Rect): boolean {
  return containsPoint(area, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
}

function containsPoint(area: Rect, point: ScreenPoint): boolean {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}
