import { app, BrowserWindow, ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PET_IPC, petAssetUrl, type PetActionRequest, type PetActionResult, type PetActivitySnapshot, type PetOverlayBootstrap } from '../../shared/pets'
import { developmentRendererUrl, mainState } from '../main-app-context'
import { resolveNamedPreloadPath } from '../main-paths'
import { runtimeRequest } from '../main-runtime-settings'
import { petStopConflict, validatePetStop } from './pet-actions'
import { askPetFollowUp, settlePetFollowUp } from './pet-follow-up'
import { detectCodexHome, localPetsRoot, refreshPetLibraries, resolveBuiltinPetsRoot } from './pet-importer'
import { petEventAllowed, petIpcHandlers, type PetIpcEvent } from './pet-ipc'
import { bindPetAssetReader } from './pet-protocol'
import { PetStore } from './pet-store'
import { petRendererTarget } from './pet-renderer-target'
import { PetWindowController, type PetWindowLike } from './pet-window'

let active: DesktopPets | null = null

export type DesktopPets = {
  shutdown(): Promise<void>
  noteMainWindow(window: BrowserWindow | null): void
}

export async function startDesktopPets(): Promise<DesktopPets> {
  if (active) return active
  const store = new PetStore(path.join(app.getPath('userData'), 'pets'))
  await store.initialize()
  const pets = new DesktopPetRuntime(store)
  await pets.start()
  active = pets
  pets.noteMainWindow(mainState.mainWindow)
  return pets
}

export function attachDesktopPetWindow(window: BrowserWindow | null): void {
  active?.noteMainWindow(window)
}

export async function shutdownDesktopPets(): Promise<void> {
  const current = active
  active = null
  await current?.shutdown()
}

class DesktopPetRuntime implements DesktopPets {
  private mainWindow: BrowserWindow | null = null
  private detachMain: (() => void) | null = null
  private pendingNavigation: PetActionRequest | null = null
  private snapshot: PetActivitySnapshot | null = null
  private readonly allowed = new Set<number>()
  private controller: PetWindowController | null = null

  constructor(private readonly store: PetStore) {}

  noteMainWindow(window: BrowserWindow | null): void {
    this.detachMain?.()
    this.detachMain = null
    this.mainWindow = window
    this.allowed.clear()
    const overlayId = this.controller?.senderId()
    if (overlayId !== null && overlayId !== undefined) this.allowed.add(overlayId)
    if (!window || window.isDestroyed()) return
    this.allowed.add(window.webContents.id)
    const onLoad = (): void => {
      if (this.pendingNavigation && !window.isDestroyed()) window.webContents.send(PET_IPC.navigationRequested, this.pendingNavigation)
    }
    const onFocus = (): void => { this.controller?.send(PET_IPC.overlayFocused, {}) }
    const onClosed = (): void => {
      this.mainWindow = null
      this.detachMain = null
      this.controller?.close()
    }
    window.webContents.on('did-finish-load', onLoad)
    window.on('focus', onFocus)
    window.on('closed', onClosed)
    this.detachMain = () => {
      if (window.isDestroyed()) return
      window.webContents.removeListener('did-finish-load', onLoad)
      window.removeListener('focus', onFocus)
      window.removeListener('closed', onClosed)
    }
  }

  async start(): Promise<void> {
    bindPetAssetReader({ lookup: (id) => this.store.assetPath(id), libraryRoot: this.store.libraryRoot() })
    this.controller = new PetWindowController({
      platform: process.platform,
      forwardMouseEvents: process.platform !== 'linux' || process.env.KUN_PET_FORWARD_MOUSE === '1',
      createWindow: () => this.createWindow(),
      displays: () => screen.getAllDisplays().map((display) => ({
        id: String(display.id),
        workArea: display.workArea,
        scaleFactor: display.scaleFactor
      })),
      cursor: () => screen.getCursorScreenPoint(),
      load: (window) => this.loadOverlay(window),
      onDisplayChange: (handler) => {
        screen.on('display-added', handler)
        screen.on('display-removed', handler)
        screen.on('display-metrics-changed', handler)
        return () => {
          screen.off('display-added', handler)
          screen.off('display-removed', handler)
          screen.off('display-metrics-changed', handler)
        }
      }
    }, async (placement) => { await this.store.setPlacement(placement) })
    this.controller.setSpriteWidth(this.store.getSettings().mascotWidthPx)
    const api = this.api()
    for (const [channel, handler] of Object.entries(petIpcHandlers(api))) {
      if (channel === PET_IPC.updateActivity || channel === PET_IPC.followUpResult || channel.startsWith('kun:pets:overlay:drag') || channel === PET_IPC.overlayPointer || channel === PET_IPC.overlayResize || channel === PET_IPC.overlayBounds || channel === PET_IPC.overlayOpenMain || channel === PET_IPC.overlayDragCancel) {
        ipcMain.on(channel, (event, ...args) => { void handler(toEvent(event, this.classify(event.sender.id)), ...args) })
      } else {
        ipcMain.handle(channel, (event, ...args) => handler(toEvent(event, this.classify(event.sender.id)), ...args))
      }
    }
    await this.refresh()
    if (this.store.getSettings().overlayOpen) await this.controller.openAtSaved(savedPlacement(this.store))
  }

  async shutdown(): Promise<void> {
    this.detachMain?.()
    this.detachMain = null
    this.controller?.close()
    this.controller = null
    for (const channel of Object.values(PET_IPC)) {
      ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(channel)
    }
    bindPetAssetReader(null)
  }

  private api() {
    return {
      listPets: () => Promise.resolve(this.store.listPets()),
      getSettings: () => Promise.resolve(this.store.getSettings()),
      selectPet: async (petId: string | null) => {
        const settings = await this.store.selectPet(petId)
        await this.syncOverlay()
        return settings
      },
      setOverlayOpen: async (open: boolean) => {
        const settings = await this.store.setOverlayOpen(open)
        await this.syncOverlay()
        return settings
      },
      setImportPreferences: (input: { importCodexPets?: boolean }) => this.store.setImportPreferences(input),
      refresh: () => this.refresh(),
      openKunDirectory: async () => { await this.openDirectory(localPetsRoot(this.store.libraryRoot())) },
      openCodexDirectory: async () => { await this.openDirectory(path.join(detectCodexHome(), 'pets')) },
      interaction: async () => ({ mode: this.controller?.mode() ?? 'passthrough', note: this.controller?.policy.note ?? null }),
      updateActivity: (snapshot: PetActivitySnapshot) => {
        this.snapshot = snapshot
        this.controller?.send(PET_IPC.overlayActivity, snapshot)
      },
      bootstrap: () => Promise.resolve(this.bootstrap()),
      beginDrag: (point: { x: number; y: number }) => this.controller?.beginDrag(point),
      moveDrag: (point: { x: number; y: number }) => this.controller?.moveDrag(point),
      endDrag: (point: { x: number; y: number }) => this.controller?.endDrag(point),
      cancelDrag: () => this.controller?.cancelDrag(),
      setPointerInteractive: (interactive: boolean) => this.controller?.setPointerInteractive(interactive),
      resize: (width: number) => this.controller?.resize(width),
      finishResize: (width: number) => this.controller?.finishResize(width) ?? Promise.resolve(),
      reportBounds: (bounds: { width: number; height: number; anchorX: number; anchorY: number }) => this.controller?.reportBounds(bounds),
      performAction: (request: PetActionRequest) => this.perform(request),
      completeFollowUp: (requestId: string, result: PetActionResult) => settlePetFollowUp(requestId, result),
      dismiss: async (key: string) => {
        await this.store.dismissNotification(key)
        this.controller?.send(PET_IPC.overlayBootstrapChanged, this.bootstrap())
      },
      recordWelcomed: (petId: string) => this.store.recordWelcomed(petId),
      takePendingNavigation: () => {
        const pending = this.pendingNavigation
        this.pendingNavigation = null
        return Promise.resolve(pending)
      },
      openMainWindow: () => this.reveal(),
      closeOverlay: async () => { await this.store.setOverlayOpen(false); this.controller?.close() },
      allows: (event: PetIpcEvent, kinds: Array<'main' | 'overlay'>) =>
        (event.senderKind === 'main' || event.senderKind === 'overlay') &&
        kinds.includes(event.senderKind) &&
        petEventAllowed(event, this.allowed)
    }
  }

  private async perform(request: PetActionRequest) {
    if (request.type === 'follow-up') return this.deliverFollowUp(request)
    if (request.type === 'stop') {
      const stale = validatePetStop({ request, snapshot: this.snapshot })
      if (stale) return stale
      const current = await mainState.store.load()
      const result = await runtimeRequest(
        current,
        `/v1/threads/${encodeURIComponent(request.threadId)}/turns/${encodeURIComponent(request.turnId)}/interrupt`,
        { method: 'POST', body: JSON.stringify({ discard: false }) }
      )
      const conflict = petStopConflict(result.status)
      if (conflict) return conflict
      return { ok: true as const }
    }
    this.pendingNavigation = request
    this.reveal()
    this.mainWindow?.webContents.send(PET_IPC.navigationRequested, request)
    return { ok: true as const }
  }

  private deliverFollowUp(request: Extract<PetActionRequest, { type: 'follow-up' }>) {
    const prompt = request.prompt.trim()
    const known = this.snapshot?.items.some((item) => item.threadId === request.threadId)
    if (!known || !prompt || prompt.length > 16_000 || !this.mainWindow || this.mainWindow.isDestroyed()) {
      return Promise.resolve({ ok: false as const, code: 'rejected' as const, message: '无法发送跟进消息' })
    }
    return askPetFollowUp(this.mainWindow, request)
  }

  private reveal(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
  }

  private async refresh() {
    const settings = this.store.getSettings()
    const report = await refreshPetLibraries({
      store: this.store,
      builtinRoot: resolveBuiltinPetsRoot({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
      localRoot: localPetsRoot(this.store.libraryRoot()),
      codexHome: detectCodexHome(),
      importCodexPets: settings.importCodexPets
    })
    this.mainWindow?.webContents.send(PET_IPC.catalogChanged, {})
    await this.syncOverlay()
    return report
  }

  private async syncOverlay(): Promise<void> {
    const settings = this.store.getSettings()
    if (!settings.overlayOpen) {
      this.controller?.close()
      return
    }
    const saved = savedPlacement(this.store)
    await this.controller?.openAtSaved(saved)
    const overlayId = this.controller?.senderId()
    if (overlayId !== null && overlayId !== undefined) this.allowed.add(overlayId)
    this.controller?.send(PET_IPC.overlayBootstrapChanged, this.bootstrap())
    if (this.snapshot) this.controller?.send(PET_IPC.overlayActivity, this.snapshot)
  }

  private bootstrap(): PetOverlayBootstrap {
    const settings = this.store.getSettings()
    const manifest = settings.selectedPetId ? this.store.getManifest(settings.selectedPetId) : null
    return {
      petId: manifest?.id ?? null,
      displayName: manifest?.displayName ?? null,
      description: manifest?.description ?? null,
      spriteVersionNumber: manifest?.spriteVersionNumber ?? 1,
      spritesheetUrl: manifest ? petAssetUrl(manifest.id, manifest.sourceFingerprint) : null,
      mascotWidthPx: settings.mascotWidthPx,
      isOpen: Boolean(settings.overlayOpen && this.controller?.isOpen()),
      welcomedPetIds: settings.welcomedPetIds,
      dismissedNotificationKeys: settings.dismissedNotificationKeys,
      interactionMode: this.controller?.mode() ?? 'passthrough',
      interactionNote: this.controller?.policy.note ?? null
    }
  }

  private createWindow(): PetWindowLike {
    const window = new BrowserWindow({
      width: 220,
      height: 260,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: resolveNamedPreloadPath(app.getAppPath(), 'pet-overlay'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    const contentsId = window.webContents.id
    this.allowed.add(contentsId)
    window.on('closed', () => { this.allowed.delete(contentsId) })
    return window as unknown as PetWindowLike
  }

  private loadOverlay(window: PetWindowLike): Promise<void> {
    const target = petRendererTarget({ appPath: app.getAppPath(), developmentUrl: developmentRendererUrl() })
    return target.kind === 'file' ? window.loadFile(target.path) : window.loadURL(target.url)
  }

  private async openDirectory(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  }

  private classify(senderId: number): 'main' | 'overlay' | 'other' {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents.id === senderId) return 'main'
    if (this.controller?.senderId() === senderId) return 'overlay'
    return 'other'
  }
}

function savedPlacement(store: PetStore): { displayId: string; windowBounds: { x: number; y: number; width: number; height: number } } | null {
  const settings = store.getSettings()
  const placement = Object.values(settings.placementByDisplay)[0]
  return placement ? { displayId: placement.displayId, windowBounds: placement.windowBounds } : null
}

function toEvent(event: IpcMainInvokeEvent | IpcMainEvent, senderKind: 'main' | 'overlay' | 'other'): PetIpcEvent {
  return {
    senderId: event.sender.id,
    isMainFrame: event.senderFrame === event.sender.mainFrame,
    senderKind
  }
}
