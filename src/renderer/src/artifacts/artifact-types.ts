import { officeDocumentPreviewFormatFromName } from '@shared/office-document'

export type LibraryArtifactKind = 'design' | 'doc' | 'slides' | 'report' | 'sheet' | 'board' | 'image'

export const LIBRARY_ARTIFACT_KINDS: readonly LibraryArtifactKind[] = [
  'design', 'doc', 'slides', 'report', 'board', 'sheet', 'image'
]

/** One thing Kun produced in a project: a design draft, an office file, a data report, a whiteboard or an image. */
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
  /** Data report id inside `.kun-reports`. */
  reportId?: string
  /** Conversation that produced it, when the source records one. */
  sourceThreadId?: string
}

export type LibraryArtifactKindStyle = {
  /** Tailwind classes for the tinted type chip. */
  chip: string
  /** Tailwind classes for the tinted icon tile. */
  tile: string
  /** Tailwind classes for the tinted ground behind a card thumbnail. */
  canvas: string
}

export const LIBRARY_ARTIFACT_KIND_STYLE: Record<LibraryArtifactKind, LibraryArtifactKindStyle> = {
  design: {
    chip: 'bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200',
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300',
    canvas: 'bg-violet-50/70 dark:bg-violet-400/[0.07]'
  },
  doc: {
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-200',
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300',
    canvas: 'bg-blue-50/70 dark:bg-blue-400/[0.07]'
  },
  slides: {
    chip: 'bg-orange-50 text-orange-700 dark:bg-orange-400/15 dark:text-orange-200',
    tile: 'bg-orange-50 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300',
    canvas: 'bg-orange-50/70 dark:bg-orange-400/[0.07]'
  },
  report: {
    chip: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200',
    tile: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300',
    canvas: 'bg-indigo-50/70 dark:bg-indigo-400/[0.07]'
  },
  sheet: {
    chip: 'bg-green-50 text-green-700 dark:bg-green-400/15 dark:text-green-200',
    tile: 'bg-green-50 text-green-600 dark:bg-green-400/15 dark:text-green-300',
    canvas: 'bg-green-50/70 dark:bg-green-400/[0.07]'
  },
  board: {
    chip: 'bg-teal-50 text-teal-700 dark:bg-teal-400/15 dark:text-teal-200',
    tile: 'bg-teal-50 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300',
    canvas: 'bg-teal-50/70 dark:bg-teal-400/[0.07]'
  },
  image: {
    chip: 'bg-pink-50 text-pink-700 dark:bg-pink-400/15 dark:text-pink-200',
    tile: 'bg-pink-50 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300',
    canvas: 'bg-pink-50/70 dark:bg-pink-400/[0.07]'
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
