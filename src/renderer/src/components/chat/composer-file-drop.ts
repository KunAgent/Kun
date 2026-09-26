import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  composerFileReferenceFromPath,
  parseComposerFileReferenceDragData,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import {
  composerImageMimeTypeFromFileName,
  imageFilesFromTransfer,
  imageTransferHasImages,
  isComposerImageMimeType,
  isComposerOfficeFile,
  isComposerPdfFile,
  type ComposerImageTransferSource
} from './FloatingComposerAttachments'

export type ComposerFileDropSource = ComposerImageTransferSource & {
  types?: ArrayLike<string> | null
  getData?: (format: string) => string
}

export type ComposerFileDropOptions = {
  canPickAttachment: boolean
  canPickLocalFileReference: boolean
  canAddFileReference: boolean
  workspaceRoot: string
  extraWorkspaceRoots?: readonly string[]
  onPickAttachments?: (files: File[]) => void
  onAddFileReference?: (reference: ComposerFileReference) => void
  getPathForFile?: (file: File) => string
}

function arrayLikeValues<T>(value: ArrayLike<T> | null | undefined): T[] {
  if (!value) return []
  const out: T[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item) out.push(item)
  }
  return out
}

function isImageLike(file: File): boolean {
  return isComposerImageMimeType(file.type) || Boolean(composerImageMimeTypeFromFileName(file.name))
}

function transferHasType(source: ComposerFileDropSource, type: string): boolean {
  return arrayLikeValues(source.types).includes(type)
}

export function canAcceptComposerFileDrop(
  source: ComposerFileDropSource,
  options: ComposerFileDropOptions
): boolean {
  const canRouteAttachments = options.canPickAttachment && Boolean(options.onPickAttachments)
  const canRouteLocalFiles =
    options.canPickLocalFileReference &&
    Boolean(options.onAddFileReference) &&
    Boolean(options.getPathForFile)
  const canRouteInternalReference = options.canAddFileReference && Boolean(options.onAddFileReference)

  if (
    canRouteInternalReference &&
    transferHasType(source, COMPOSER_FILE_REFERENCE_DRAG_MIME)
  ) {
    return true
  }

  if (canRouteAttachments && imageTransferHasImages(source)) return true

  const files = arrayLikeValues(source.files)
  if (canRouteAttachments && files.some((file) => isComposerPdfFile(file) || isComposerOfficeFile(file))) {
    return true
  }
  if (
    canRouteLocalFiles &&
    files.some((file) => !isImageLike(file) && !isComposerPdfFile(file) && !isComposerOfficeFile(file))
  ) {
    return true
  }

  // macOS and Chromium may expose only the generic Files type until drop.
  return files.length === 0 && transferHasType(source, 'Files') && (canRouteAttachments || canRouteLocalFiles)
}

export function routeComposerFileDrop(
  source: ComposerFileDropSource,
  options: ComposerFileDropOptions
): boolean {
  let handled = false
  const draggedReference = options.canAddFileReference
    ? parseComposerFileReferenceDragData(
        source.getData?.(COMPOSER_FILE_REFERENCE_DRAG_MIME) ?? '',
        [options.workspaceRoot, ...(options.extraWorkspaceRoots ?? [])]
      )
    : null

  if (draggedReference && options.onAddFileReference) {
    options.onAddFileReference(draggedReference)
    handled = true
  }

  const imageFiles = options.canPickAttachment ? imageFilesFromTransfer(source) : []
  const rawFiles = arrayLikeValues(source.files)
  const pdfFiles = options.canPickAttachment ? rawFiles.filter(isComposerPdfFile) : []
  const officeFiles = options.canPickAttachment ? rawFiles.filter(isComposerOfficeFile) : []
  if ((imageFiles.length > 0 || pdfFiles.length > 0 || officeFiles.length > 0) && options.onPickAttachments) {
    options.onPickAttachments([...imageFiles, ...pdfFiles, ...officeFiles])
    handled = true
  }

  const pathFiles = options.canPickLocalFileReference && options.onAddFileReference
    ? rawFiles.filter(
        (file) => !isImageLike(file) && !isComposerPdfFile(file) && !isComposerOfficeFile(file)
      )
    : []
  if (pathFiles.length > 0 && options.getPathForFile && options.onAddFileReference) {
    for (const file of pathFiles) {
      try {
        const path = options.getPathForFile(file)
        if (!path) continue
        options.onAddFileReference(composerFileReferenceFromPath(
          path,
          [options.workspaceRoot, ...(options.extraWorkspaceRoots ?? [])]
        ))
        handled = true
      } catch {
        // Ignore files whose native filesystem path cannot be resolved.
      }
    }
  }

  return handled
}
