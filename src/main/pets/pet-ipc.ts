import {
  PET_IPC,
  type PetActionRequest,
  type PetActivitySnapshot,
  type PetImportReport,
  type PetOverlayBootstrap,
  type PetSettings,
  type PetSummary
} from '../../shared/pets'
import {
  parsePetActionRequest,
  parsePetActivitySnapshot,
  parsePetDismissPayload,
  parsePetImportPreferences,
  parsePetMascotWidth,
  parsePetOverlayOpenPayload,
  parsePetSelectPayload
} from '../../shared/pets-payload'
import { petSenderAllowed } from './pet-protocol'

export type PetIpcEvent = { senderId: number; isMainFrame: boolean; senderKind: 'main' | 'overlay' | 'other' }

export type PetIpcApi = {
  listPets(): Promise<PetSummary[]>
  getSettings(): Promise<PetSettings>
  selectPet(petId: string | null): Promise<PetSettings>
  setOverlayOpen(open: boolean): Promise<PetSettings>
  setImportPreferences(input: { importCodexPets?: boolean }): Promise<PetSettings>
  refresh(): Promise<PetImportReport>
  openKunDirectory(): Promise<void>
  openCodexDirectory(): Promise<void>
  interaction(): Promise<{ mode: 'passthrough' | 'bounded'; note: string | null }>
  updateActivity(snapshot: PetActivitySnapshot): void
  bootstrap(): Promise<PetOverlayBootstrap>
  beginDrag(point: { x: number; y: number }): void
  moveDrag(point: { x: number; y: number }): void
  endDrag(point: { x: number; y: number }): void
  cancelDrag(): void
  setPointerInteractive(interactive: boolean): void
  resize(width: number): void
  finishResize(width: number): Promise<void>
  reportBounds(bounds: { width: number; height: number; anchorX: number; anchorY: number }): void
  performAction(request: PetActionRequest): Promise<{ ok: true } | { ok: false; code: string; message: string }>
  dismiss(key: string): Promise<void>
  recordWelcomed(petId: string): Promise<void>
  takePendingNavigation(): Promise<PetActionRequest | null>
  openMainWindow(): void
  closeOverlay(): void
  allows(event: PetIpcEvent, kinds: Array<'main' | 'overlay'>): boolean
}

type Handler = (event: PetIpcEvent, ...args: unknown[]) => unknown

export function petIpcHandlers(api: PetIpcApi): Record<string, Handler> {
  const main = (event: PetIpcEvent) => {
    if (!api.allows(event, ['main'])) throw new Error('pet ipc is limited to the desktop workbench')
  }
  const overlay = (event: PetIpcEvent) => {
    if (!api.allows(event, ['overlay'])) throw new Error('pet overlay ipc is limited to the pet window')
  }
  return {
    [PET_IPC.listPets]: async (event) => { main(event); return api.listPets() },
    [PET_IPC.getSettings]: async (event) => { main(event); return api.getSettings() },
    [PET_IPC.selectPet]: async (event, petId) => {
      main(event)
      const parsed = parsePetSelectPayload(petId)
      if (!parsed.ok) throw new Error(parsed.error)
      return api.selectPet(parsed.value)
    },
    [PET_IPC.setOverlayOpen]: async (event, open) => {
      main(event)
      const parsed = parsePetOverlayOpenPayload(open)
      if (!parsed.ok) throw new Error(parsed.error)
      return api.setOverlayOpen(parsed.value)
    },
    [PET_IPC.setImportPreferences]: async (event, input) => {
      main(event)
      const parsed = parsePetImportPreferences(input)
      if (!parsed.ok) throw new Error(parsed.error)
      return api.setImportPreferences(parsed.value)
    },
    [PET_IPC.refreshPets]: async (event) => { main(event); return api.refresh() },
    [PET_IPC.openKunDirectory]: async (event) => { main(event); await api.openKunDirectory() },
    [PET_IPC.openCodexDirectory]: async (event) => { main(event); await api.openCodexDirectory() },
    [PET_IPC.interaction]: async (event) => { main(event); return api.interaction() },
    [PET_IPC.updateActivity]: (event, snapshot) => {
      main(event)
      const parsed = parsePetActivitySnapshot(snapshot)
      if (!parsed.ok) return
      api.updateActivity(parsed.value)
    },
    [PET_IPC.overlayBootstrap]: async (event) => { overlay(event); return api.bootstrap() },
    [PET_IPC.overlayDragStart]: (event, point) => { overlay(event); if (isPoint(point)) api.beginDrag(point) },
    [PET_IPC.overlayDragMove]: (event, point) => { overlay(event); if (isPoint(point)) api.moveDrag(point) },
    [PET_IPC.overlayDragEnd]: (event, point) => { overlay(event); if (isPoint(point)) api.endDrag(point) },
    [PET_IPC.overlayDragCancel]: (event) => { overlay(event); api.cancelDrag() },
    [PET_IPC.overlayPointer]: (event, interactive) => {
      overlay(event)
      if (typeof interactive === 'boolean') api.setPointerInteractive(interactive)
    },
    [PET_IPC.overlayResize]: (event, width) => {
      overlay(event)
      const parsed = parsePetMascotWidth(width)
      if (parsed.ok) api.resize(parsed.value)
    },
    [PET_IPC.overlayResizeEnd]: async (event, width) => {
      overlay(event)
      const parsed = parsePetMascotWidth(width)
      if (parsed.ok) await api.finishResize(parsed.value)
    },
    [PET_IPC.overlayBounds]: (event, bounds) => {
      overlay(event)
      if (isBounds(bounds)) api.reportBounds(bounds)
    },
    [PET_IPC.overlayAction]: async (event, request) => {
      overlay(event)
      const parsed = parsePetActionRequest(request)
      if (!parsed.ok) return { ok: false, code: 'rejected', message: parsed.error }
      return api.performAction(parsed.value)
    },
    [PET_IPC.overlayDismiss]: async (event, input) => {
      overlay(event)
      const parsed = parsePetDismissPayload(input)
      if (!parsed.ok) throw new Error(parsed.error)
      await api.dismiss(parsed.value.key)
    },
    [PET_IPC.overlayWelcomed]: async (event, petId) => {
      overlay(event)
      if (typeof petId === 'string' && petId.trim()) await api.recordWelcomed(petId)
    },
    [PET_IPC.navigationPending]: async (event) => { main(event); return api.takePendingNavigation() },
    [PET_IPC.overlayOpenMain]: (event) => { overlay(event); api.openMainWindow() },
    [PET_IPC.overlayClose]: async (event) => { overlay(event); api.closeOverlay() }
  }
}

export function petEventAllowed(event: PetIpcEvent, allowedIds: ReadonlySet<number>): boolean {
  return petSenderAllowed({ senderId: event.senderId, allowedSenderIds: allowedIds, isMainFrame: event.isMainFrame })
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function isBounds(value: unknown): value is { width: number; height: number; anchorX: number; anchorY: number } {
  if (!value || typeof value !== 'object') return false
  const bounds = value as Record<string, unknown>
  return ['width', 'height', 'anchorX', 'anchorY'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))
}
