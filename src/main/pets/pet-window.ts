import { PET_DRAG_THRESHOLD_PX, clampMascotWidth, type PetOverlayBounds, type PetOverlayLayout, type PetOverlayPlacement, type ScreenPoint } from '../../shared/pets'
import { clampPetCenter, petOverlayFrame, placementFromDip, type PetDisplay, type Rect } from './pet-geometry'
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
  layoutChanged?(layout: PetOverlayLayout): void
}

type SavedPetPlacement = Pick<PetOverlayPlacement, 'displayId' | 'windowBounds' | 'petCenter'>
type DragSession = { origin: Rect; cursor: ScreenPoint; moved: boolean; petCenter: ScreenPoint }

export class PetWindowController {
  private window: PetWindowLike | null = null
  private loading: Promise<void> | null = null
  private drag: DragSession | null = null
  private spriteWidth = 112
  private petCenter: ScreenPoint = { x: 0, y: 0 }
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

  async open(saved: SavedPetPlacement | null = null): Promise<PetWindowLike> {
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
      const displays = this.host.displays()
      const display = displays.find((item) => item.id === saved?.displayId) ?? displays[0]
      if (!display) throw new Error('no display is available')
      const area = display.workArea
      const height = Math.round(this.spriteWidth * 208 / 192)
      const stored = saved?.petCenter
      // Older versions stored the full popup window, with the pet near its lower-right corner.
      const fallback = saved ? {
        x: saved.windowBounds.x + saved.windowBounds.width - 16 - this.spriteWidth / 2,
        y: saved.windowBounds.y + saved.windowBounds.height - 60 - height / 2
      } : { x: area.x + area.width - 24 - this.spriteWidth / 2, y: area.y + area.height - 24 - height / 2 }
      this.petCenter = clampPetCenter(stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : fallback,
        this.spriteWidth, area)
      window.setBounds(petOverlayFrame(this.petCenter, area))
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

  async openAtSaved(saved: SavedPetPlacement | null): Promise<void> {
    // Refreshes, notification changes, and pet selection must never restore an old panel rectangle.
    await this.open(saved)
  }

  layout(): PetOverlayLayout {
    const frame = this.window?.getBounds() ?? { x: 0, y: 0, width: 420, height: 640 }
    return { anchorX: this.petCenter.x - frame.x, anchorY: this.petCenter.y - frame.y,
      viewportWidth: frame.width, viewportHeight: frame.height }
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
    this.drag = { origin: this.window!.getBounds(), cursor: point, moved: false, petCenter: { ...this.petCenter } }
  }

  moveDrag(point: ScreenPoint): void {
    if (!this.drag || !this.isOpen()) return
    const dx = point.x - this.drag.cursor.x
    const dy = point.y - this.drag.cursor.y
    if (Math.hypot(dx, dy) >= PET_DRAG_THRESHOLD_PX) this.drag.moved = true
    if (!this.drag.moved) return
    const proposed = { x: this.drag.petCenter.x + dx, y: this.drag.petCenter.y + dy }
    const display = this.displayFor(proposed, point)
    this.petCenter = clampPetCenter(proposed, this.spriteWidth, display.workArea)
    this.applyFrame(display)
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
    this.petCenter = { ...this.drag.petCenter }
    this.host.layoutChanged?.(this.layout())
    this.drag = null
  }

  resize(width: number): void {
    this.setSpriteWidth(width)
    if (!this.isOpen()) return
    const display = this.displayFor(this.petCenter)
    this.petCenter = clampPetCenter(this.petCenter, this.spriteWidth, display.workArea)
    this.applyFrame(display)
  }

  async finishResize(width: number): Promise<void> {
    this.resize(width)
    if (this.window) await this.flush(this.window.getBounds(), this.spriteWidth)
  }

  reportBounds(_bounds: PetOverlayBounds): void {
    // Kept for preload compatibility. Content size no longer controls the pet's native position.
  }

  send(channel: string, payload: unknown): void {
    if (this.isOpen()) this.window!.webContents.send(channel, payload)
  }

  private reclamp(): void {
    if (!this.isOpen() || this.drag) return
    const display = this.displayFor(this.petCenter)
    this.petCenter = clampPetCenter(this.petCenter, this.spriteWidth, display.workArea)
    this.applyFrame(display)
  }

  private applyFrame(display: PetDisplay): void {
    if (!this.isOpen()) return
    const next = petOverlayFrame(this.petCenter, display.workArea)
    if (!sameRect(this.window!.getBounds(), next)) this.window!.setBounds(next)
    this.host.layoutChanged?.(this.layout())
  }

  private async flush(bounds: Rect, mascotWidthPx = this.spriteWidth): Promise<void> {
    const display = this.displayFor(this.petCenter)
    await this.persist(placementFromDip({
      display,
      bounds,
      petCenter: this.petCenter,
      mascotWidthPx: clampMascotWidth(mascotWidthPx),
      updatedAt: new Date().toISOString()
    }))
  }

  private displayFor(center: ScreenPoint, cursor?: ScreenPoint): PetDisplay {
    const displays = this.host.displays()
    return displays.find((display) => containsPoint(display.workArea, center))
      ?? (cursor ? displays.find((display) => containsPoint(display.workArea, cursor)) : undefined)
      ?? [...displays].sort((left, right) => distanceToArea(center, left.workArea) - distanceToArea(center, right.workArea))[0]
      ?? { id: 'primary', workArea: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 }
  }
}

function containsPoint(area: Rect, point: ScreenPoint): boolean {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
}

function distanceToArea(point: ScreenPoint, area: Rect): number {
  const dx = Math.max(area.x - point.x, 0, point.x - area.x - area.width)
  const dy = Math.max(area.y - point.y, 0, point.y - area.y - area.height)
  return dx * dx + dy * dy
}

function sameRect(left: Rect, right: Rect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}
