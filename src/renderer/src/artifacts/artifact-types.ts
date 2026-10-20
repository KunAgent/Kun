import { officeDocumentPreviewFormatFromName } from '@shared/office-document'

export type LibraryArtifactKind = 'design' | 'doc' | 'slides' | 'sheet' | 'board' | 'image'

export const LIBRARY_ARTIFACT_KINDS: readonly LibraryArtifactKind[] = [
  'design', 'doc', 'slides', 'board', 'sheet', 'image'
]

/** One thing Kun produced in a project: a design draft, an office file, a whiteboard or an image. */
export type LibraryArtifact = {
  /** Stable across scans: kind, project and location. */
  id: string
  kind: LibraryArtifactKind
  title: string
  workspaceRoot: string
  projectName: string
  /** Workspace-relative file, or the design draft / whiteboard directory. */
  path: string
  ext: string
  updatedAt: number
  size?: number
  /** Design draft id inside `.kun-design`. */
  designDocumentId?: string
  /** Work whiteboard id inside `.kun-whiteboards`. */
  whiteboardId?: string
  /** Conversation that produced it, when the source records one. */
  sourceThreadId?: string
}

export type LibraryArtifactKindStyle = {
  /** Tailwind classes for the tinted type chip. */
  chip: string
  /** Tailwind classes for the tinted icon tile. */
  tile: string
}

export const LIBRARY_ARTIFACT_KIND_STYLE: Record<LibraryArtifactKind, LibraryArtifactKindStyle> = {
  design: {
    chip: 'bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300'
  },
  doc: {
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200',
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300'
  },
  slides: {
    chip: 'bg-orange-50 text-orange-700 dark:bg-orange-400/15 dark:text-orange-200',
    tile: 'bg-orange-50 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300'
  },
  sheet: {
    chip: 'bg-green-50 text-green-700 dark:bg-green-400/15 dark:text-green-200',
    tile: 'bg-green-50 text-green-600 dark:bg-green-400/15 dark:text-green-300'
  },
  board: {
    chip: 'bg-teal-50 text-teal-700 dark:bg-teal-400/15 dark:text-teal-200',
    tile: 'bg-teal-50 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300'
  },
  image: {
    chip: 'bg-pink-50 text-pink-700 dark:bg-pink-400/15 dark:text-pink-200',
    tile: 'bg-pink-50 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300'
  }
}

const OFFICE_KIND_BY_EXT: Readonly<Record<string, LibraryArtifactKind>> = {
  '.docx': 'doc',
  '.doc': 'doc',
  '.pdf': 'doc',
  '.pptx': 'slides',
  '.ppt': 'slides',
  '.xlsx': 'sheet',
  '.xls': 'sheet',
  '.csv': 'sheet'
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export function officeKindForExt(ext: string): LibraryArtifactKind | null {
  return OFFICE_KIND_BY_EXT[ext.toLowerCase()] ?? null
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase())
}

/** Files the shared workspace office preview renders inside a viewer. */
export function officePreviewable(path: string): boolean {
  return officeDocumentPreviewFormatFromName(path) !== null
}
