import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import { createDefaultShape, type Rect, type ViewBox } from './canvas-types'
import { currentCanvasOccupiedRects } from './canvas-occupied-regions'
import { placeRectInViewportAvoiding } from './canvas-placement'
import { useCanvasViewportStore } from './canvas-viewport-store'

const FALLBACK_IMAGE_WIDTH = 320
const FALLBACK_IMAGE_HEIGHT = 220
const MAX_IMAGE_VIEWPORT_RATIO = 0.52
const MAX_IMAGE_WIDTH = 560
const MAX_IMAGE_HEIGHT = 420
const MIN_IMAGE_SIZE = 40

export type ImportedImageDimensions = {
  width?: number
  height?: number
}

export type CanvasImageImportResult =
  | { ok: true; shapeId: string }
  | { ok: false; canceled?: boolean; reason?: 'no-image' | 'document-changed'; message?: string }

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundCanvasValue(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeImportedImagePlacement(
  vbox: ViewBox,
  dimensions: ImportedImageDimensions = {},
  occupied: readonly Rect[] = []
): Rect {
  const sourceWidth = finitePositive(dimensions.width) ? dimensions.width : FALLBACK_IMAGE_WIDTH
  const sourceHeight = finitePositive(dimensions.height) ? dimensions.height : FALLBACK_IMAGE_HEIGHT
  const maxWidth = Math.max(MIN_IMAGE_SIZE, Math.min(MAX_IMAGE_WIDTH, vbox.width * MAX_IMAGE_VIEWPORT_RATIO))
  const maxHeight = Math.max(MIN_IMAGE_SIZE, Math.min(MAX_IMAGE_HEIGHT, vbox.height * MAX_IMAGE_VIEWPORT_RATIO))
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  const width = Math.max(MIN_IMAGE_SIZE, roundCanvasValue(sourceWidth * scale))
  const height = Math.max(MIN_IMAGE_SIZE, roundCanvasValue(sourceHeight * scale))

  if (occupied.length === 0) {
    return {
      x: roundCanvasValue(vbox.x + vbox.width / 2 - width / 2),
      y: roundCanvasValue(vbox.y + vbox.height / 2 - height / 2),
      width,
      height
    }
  }
  return placeRectInViewportAvoiding({ width, height }, vbox, occupied)
}

/**
 * Best-effort compute of a workspace-relative path from an absolute one without
 * pulling node `path` into the renderer. Used as a fallback when the IPC
 * response does not carry an explicit `workspaceRelativePath` field.
 */
function workspaceRelativeFromAbsolute(absolutePath: string, workspaceRoot: string): string | null {
  if (!absolutePath || !workspaceRoot) return null
  const normRoot = workspaceRoot.replace(/[\\/]+$/, '')
  const normAbs = absolutePath.replace(/\\/g, '/')
  const rootForward = normRoot.replace(/\\/g, '/')
  if (normAbs.startsWith(rootForward + '/')) {
    return normAbs.slice(rootForward.length + 1)
  }
  return null
}

export async function pasteClipboardImageToCanvas(options: {
  vbox: ViewBox
  /**
   * When provided, the pasted bytes are persisted to `.kun/images/` and
   * the shape.imageUrl is the workspace-relative path. Without a workspace root
   * we fall back to a data: URL (rendering-only). The snapshot layer is the
   * second line of defense and will not emit a data: URL into the AI prompt.
   */
  workspaceRoot?: string
  imageDirectory?: string
  /** Captured when paste starts; prevents a late clipboard read from mutating another board. */
  expectedDocumentKey?: string | null
}): Promise<CanvasImageImportResult> {
  const expectedDocumentKey = options.expectedDocumentKey !== undefined
    ? options.expectedDocumentKey
    : useCanvasShapeStore.getState().documentKey
  if (typeof window.kunGui?.readClipboardImage !== 'function') {
    return { ok: false, reason: 'no-image', message: 'Clipboard image reading is unavailable.' }
  }

  const image = await window.kunGui.readClipboardImage()
  if (!image.ok) {
    return { ok: false, reason: 'no-image', message: image.message }
  }

  // Prefer persisting to disk so shape.imageUrl is a workspace-relative path
  // (parity with the file-picker flow). This is critical: the canvas snapshot
  // emits imageUrl into the AI prompt, and a multi-MB data: URL would context-
  // bomb the model or be passed verbatim into reference_image_paths.
  let persistedRelativePath: string | null = null
  const workspaceRoot = options.workspaceRoot?.trim()
  if (workspaceRoot && typeof window.kunGui?.saveWorkspaceClipboardImage === 'function') {
    try {
      // saveWorkspaceClipboardImage needs a currentFilePath to anchor its
      // markdownPath. We pass workspaceRoot itself; dirname(workspaceRoot) is
      // the workspace's PARENT, so saved.markdownPath would resolve outside
      // the workspace. Only use the workspace-anchored path derived from
      // saved.path — if that fails, leave persistedRelativePath null so we
      // fall back to the data: URL (the snapshot safety-net drops it before
      // it reaches the AI).
      const saved = await window.kunGui.saveWorkspaceClipboardImage({
        workspaceRoot,
        currentFilePath: workspaceRoot,
        ...(options.imageDirectory ? { imageDirectory: options.imageDirectory } : {})
      })
      if (saved.ok && typeof saved.path === 'string') {
        persistedRelativePath = workspaceRelativeFromAbsolute(saved.path, workspaceRoot)
      }
    } catch {
      // fall through to data URL — snapshot safety-net will drop it before it reaches the AI
    }
  }

  const dataUrl = `data:${image.mimeType};base64,${image.dataBase64}`
  if (useCanvasShapeStore.getState().documentKey !== expectedDocumentKey) {
    return { ok: false, reason: 'document-changed' }
  }

  const bounds = computeImportedImagePlacement(options.vbox, {
    width: image.width,
    height: image.height
  }, currentCanvasOccupiedRects())

  const shape = createDefaultShape('image', bounds.x, bounds.y)
  shape.name = image.name || 'Pasted Image'
  shape.width = bounds.width
  shape.height = bounds.height
  shape.imageUrl = persistedRelativePath ?? dataUrl

  useCanvasShapeStore.getState().addShape(shape)
  useCanvasSelectionStore.getState().select([shape.id])
  useCanvasViewportStore.getState().setActiveTool('select')

  return { ok: true, shapeId: shape.id }
}

function imageNameFromPath(path: string): string {
  const fileName = path.split('/').pop()?.trim() || 'Image'
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim()
  return withoutExt || 'Image'
}

export async function importWorkspaceImageToCanvas(options: {
  workspaceRoot: string
  vbox: ViewBox
  imageDirectory?: string
}): Promise<CanvasImageImportResult> {
  const workspaceRoot = options.workspaceRoot.trim()
  if (!workspaceRoot) {
    return { ok: false, message: 'Workspace root is required.' }
  }
  if (typeof window.kunGui?.pickWorkspaceImage !== 'function') {
    return { ok: false, message: 'Image picker is unavailable.' }
  }

  const picked = await window.kunGui
    .pickWorkspaceImage({
      workspaceRoot,
      ...(options.imageDirectory ? { imageDirectory: options.imageDirectory } : {})
    })
    .catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error)
    }))

  if (!picked.ok) {
    return picked
  }

  const imageUrl = picked.workspaceRelativePath || picked.relativePath
  const bounds = computeImportedImagePlacement(options.vbox, {
    width: picked.width,
    height: picked.height
  }, currentCanvasOccupiedRects())
  const shape = createDefaultShape('image', bounds.x, bounds.y)
  shape.name = imageNameFromPath(imageUrl)
  shape.width = bounds.width
  shape.height = bounds.height
  shape.imageUrl = imageUrl

  useCanvasShapeStore.getState().addShape(shape)
  useCanvasSelectionStore.getState().select([shape.id])
  useCanvasViewportStore.getState().setActiveTool('select')

  return { ok: true, shapeId: shape.id }
}
