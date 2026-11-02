export type PetAnimationState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export type PetSource = 'kun-builtin' | 'kun-local' | 'codex-custom'

export type PetSpriteVersion = 1 | 2

export type PetSessionStatus = 'idle' | 'running' | 'waiting' | 'failed' | 'review'

export type PetManifest = {
  schemaVersion: 1
  id: string
  sourceId: string
  displayName: string
  description: string
  spriteVersionNumber: PetSpriteVersion
  spritesheetFile: 'spritesheet.png' | 'spritesheet.webp'
  source: PetSource
  sourcePath?: string
  sourceFingerprint?: string
  importedAt?: string
  sourceMissing?: boolean
}

export type PetSummary = {
  id: string
  sourceId: string
  displayName: string
  description: string
  source: PetSource
  spriteVersionNumber: PetSpriteVersion
  spritesheetUrl?: string
  available: boolean
  sourceMissing: boolean
  warning?: string
}

export type PetOverlayPlacement = {
  displayId: string
  workArea: { x: number; y: number; width: number; height: number }
  windowBounds: { x: number; y: number; width: number; height: number }
  mascotWidthPx: number
  updatedAt: string
}

export type PetSettings = {
  schemaVersion: 1
  selectedPetId: string | null
  overlayOpen: boolean
  mascotWidthPx: number
  importCodexPets: boolean
  welcomedPetIds: string[]
  dismissedNotificationKeys: string[]
  placementByDisplay: Record<string, PetOverlayPlacement>
}

export type PetSourceState = 'ok' | 'missing' | 'unreadable'

export type PetImportReport = {
  imported: PetManifest[]
  updated: PetManifest[]
  unchanged: PetManifest[]
  sourceMissing: PetManifest[]
  failed: Array<{ sourcePath: string; sourceId?: string; error: string }>
  conflicts: Array<{ sourcePath: string; sourceId: string; keptSourcePath: string }>
  sourceStates: { builtin: PetSourceState; local: PetSourceState; codex: PetSourceState }
  selectedPetIdUnchanged: string | null
}

export type PetActivityItem = {
  key: string
  generation: number
  status: Exclude<PetSessionStatus, 'idle'>
  threadId: string
  unitId: string
  ownerThreadId?: string
  roomId?: string
  turnId: string | null
  stateSince: string
  title: string
  subtitle?: string
  stalled: boolean
  navigable: boolean
  bubbleAllowed: boolean
  updatedAtMs: number
}

export type PetActivitySnapshot = {
  generation: number
  profileKey: string
  items: PetActivityItem[]
  emittedAtMs: number
}

export type PetActionRequest =
  | { type: 'stop'; threadId: string; turnId: string; unitId?: string }
  | { type: 'reply'; threadId: string; unitId?: string; roomId?: string }
  | { type: 'open'; threadId: string; unitId?: string; roomId?: string }

export type PetActionResult =
  | { ok: true }
  | { ok: false; code: 'conflict' | 'missing' | 'rejected'; message: string }

export type PetInteractionMode = 'passthrough' | 'bounded'

export type PetOverlayBootstrap = {
  petId: string | null
  displayName: string | null
  description: string | null
  spriteVersionNumber: PetSpriteVersion
  spritesheetUrl: string | null
  mascotWidthPx: number
  isOpen: boolean
  welcomedPetIds: string[]
  dismissedNotificationKeys: string[]
  interactionMode: PetInteractionMode
  interactionNote: string | null
}

export type PetOverlayBounds = { width: number; height: number; anchorX: number; anchorY: number }

export type ScreenPoint = { x: number; y: number }

export type PetDesktopBridge = {
  listPets: () => Promise<PetSummary[]>
  getPetSettings: () => Promise<PetSettings>
  selectPet: (petId: string | null) => Promise<PetSettings>
  setOverlayOpen: (open: boolean) => Promise<PetSettings>
  setImportPreferences: (input: { importCodexPets?: boolean }) => Promise<PetSettings>
  refreshPets: () => Promise<PetImportReport>
  openKunPetsDirectory: () => Promise<void>
  openCodexPetsDirectory: () => Promise<void>
  updatePetActivity: (snapshot: PetActivitySnapshot) => void
  onPetCatalogChanged: (handler: () => void) => () => void
  onPetNavigationRequested: (handler: (target: PetActionRequest) => void) => () => void
  takePendingNavigation: () => Promise<PetActionRequest | null>
  getPetInteraction: () => Promise<{ mode: PetInteractionMode; note: string | null }>
}

export type PetOverlayBridge = {
  getBootstrap: () => Promise<PetOverlayBootstrap>
  onBootstrapChanged: (handler: (value: PetOverlayBootstrap) => void) => () => void
  onActivityChanged: (handler: (value: PetActivitySnapshot) => void) => () => void
  onMainWindowFocused: (handler: () => void) => () => void
  beginDrag: (point: ScreenPoint) => void
  moveDrag: (point: ScreenPoint) => void
  endDrag: (point: ScreenPoint) => void
  cancelDrag: () => void
  setPointerInteractive: (interactive: boolean) => void
  resizeMascot: (width: number) => void
  finishResize: (width: number) => void
  reportBounds: (bounds: PetOverlayBounds) => void
  performAction: (input: PetActionRequest) => Promise<PetActionResult>
  dismissNotification: (input: { key: string }) => Promise<void>
  recordPetWelcomed: (petId: string) => Promise<void>
  openMainWindow: () => void
  closeOverlay: () => void
}

export const PET_ROWS: Record<PetAnimationState, { row: number; frames: number; frameDurationsMs: number[] }> = {
  idle: { row: 0, frames: 6, frameDurationsMs: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, frames: 8, frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, frames: 8, frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, frames: 4, frameDurationsMs: [140, 140, 140, 280] },
  jumping: { row: 4, frames: 5, frameDurationsMs: [140, 140, 140, 140, 280] },
  failed: { row: 5, frames: 8, frameDurationsMs: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, frames: 6, frameDurationsMs: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, frames: 6, frameDurationsMs: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frames: 6, frameDurationsMs: [150, 150, 150, 150, 150, 280] }
}

export const PET_SHEET_WIDTH = 1536
export const PET_SHEET_HEIGHT_V1 = 1872
export const PET_SHEET_HEIGHT_V2 = 2288
export const PET_SHEET_COLUMNS = 8
export const PET_SHEET_ROWS_V1 = 9
export const PET_SHEET_ROWS_V2 = 11
export const PET_CELL_WIDTH = 192
export const PET_CELL_HEIGHT = 208
export const PET_MASCOT_MIN_WIDTH_PX = 80
export const PET_MASCOT_DEFAULT_WIDTH_PX = 112
export const PET_MASCOT_MAX_WIDTH_PX = 224
export const PET_FIRST_AWAKE_TTL_MS = 8_000
export const PET_DRAG_THRESHOLD_PX = 4
export const PET_DISMISSED_KEY_LIMIT = 500
export const PET_MANIFEST_MAX_BYTES = 64 * 1024
export const PET_SPRITESHEET_MAX_BYTES = 16 * 1024 * 1024

export const PET_NOTIFICATION_TTL_MS: Record<Exclude<PetSessionStatus, 'idle'>, number> = {
  running: 3 * 60 * 1000,
  failed: 15 * 1000,
  waiting: 30 * 60 * 1000,
  review: 15 * 1000
}

export const PET_SOURCE_PREFIX: Record<PetSource, string> = {
  'kun-builtin': 'kun',
  'kun-local': 'kun-local',
  'codex-custom': 'codex-custom'
}

export const PET_IPC = {
  listPets: 'kun:pets:list',
  getSettings: 'kun:pets:settings:get',
  selectPet: 'kun:pets:select',
  setOverlayOpen: 'kun:pets:overlay',
  setImportPreferences: 'kun:pets:import-preferences',
  refreshPets: 'kun:pets:refresh',
  openKunDirectory: 'kun:pets:open-kun-dir',
  openCodexDirectory: 'kun:pets:open-codex-dir',
  updateActivity: 'kun:pets:activity',
  catalogChanged: 'kun:pets:catalog-changed',
  navigationRequested: 'kun:pets:navigation-requested',
  navigationPending: 'kun:pets:navigation-pending',
  interaction: 'kun:pets:interaction',
  overlayBootstrap: 'kun:pets:overlay:bootstrap',
  overlayBootstrapChanged: 'kun:pets:overlay:bootstrap-changed',
  overlayActivity: 'kun:pets:overlay:activity',
  overlayFocused: 'kun:pets:overlay:main-focused',
  overlayDragStart: 'kun:pets:overlay:drag-start',
  overlayDragMove: 'kun:pets:overlay:drag-move',
  overlayDragEnd: 'kun:pets:overlay:drag-end',
  overlayDragCancel: 'kun:pets:overlay:drag-cancel',
  overlayPointer: 'kun:pets:overlay:pointer',
  overlayResize: 'kun:pets:overlay:resize',
  overlayResizeEnd: 'kun:pets:overlay:resize-end',
  overlayBounds: 'kun:pets:overlay:bounds',
  overlayAction: 'kun:pets:overlay:action',
  overlayDismiss: 'kun:pets:overlay:dismiss',
  overlayWelcomed: 'kun:pets:overlay:welcomed',
  overlayOpenMain: 'kun:pets:overlay:open-main',
  overlayClose: 'kun:pets:overlay:close'
} as const

export const PET_ASSET_SCHEME = 'kun-pet'
export const PET_ASSET_HOST = 'asset'

export function petSheetRowsForVersion(version: PetSpriteVersion): number {
  return version === 2 ? PET_SHEET_ROWS_V2 : PET_SHEET_ROWS_V1
}

export function petSheetHeightForVersion(version: PetSpriteVersion): number {
  return version === 2 ? PET_SHEET_HEIGHT_V2 : PET_SHEET_HEIGHT_V1
}

export function petIdForSource(source: PetSource, sourceId: string): string {
  return `${PET_SOURCE_PREFIX[source]}:${sourceId}`
}

export function petAssetUrl(petId: string, version?: string): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : ''
  return `${PET_ASSET_SCHEME}://${PET_ASSET_HOST}/${encodeURIComponent(petId)}/spritesheet${query}`
}

export function defaultPetSettings(): PetSettings {
  return {
    schemaVersion: 1,
    selectedPetId: null,
    overlayOpen: false,
    mascotWidthPx: PET_MASCOT_DEFAULT_WIDTH_PX,
    importCodexPets: true,
    welcomedPetIds: [],
    dismissedNotificationKeys: [],
    placementByDisplay: {}
  }
}

export function clampMascotWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value) ? value : PET_MASCOT_DEFAULT_WIDTH_PX
  return Math.round(Math.max(PET_MASCOT_MIN_WIDTH_PX, Math.min(PET_MASCOT_MAX_WIDTH_PX, width)))
}
