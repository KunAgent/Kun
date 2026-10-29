/**
 * Import target folder for paper mode. Papers land in `<papersDir>/<folder>`
 * ('' = the papers dir itself). The last folder used is remembered per
 * library, so every import entry point (dialog, search, research pool,
 * assistant cards, drag-and-drop) files new papers in the same place.
 */
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'
import { refreshPaperLibrary } from './paper-library-index'

const KEY_PREFIX = 'kun.paper.importFolder.'
export const MAX_FOLDER_DEPTH = 3
/** Paper-unit internals; the main process refuses them as folder names too. */
const RESERVED_FOLDER_NAMES = new Set(['figures', 'marks', 'source', 'assets'])

/**
 * Folder names are relative paths under `<papersDir>/`; '' is the top level.
 * Returns null for input that cannot be a folder (dot segments, reserved
 * characters, too deep).
 */
export function normalizePaperFolderInput(value: string): string | null {
  const folder = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!folder) return ''
  const segments = folder.split('/').map((segment) => segment.trim())
  if (segments.length > MAX_FOLDER_DEPTH) return null
  const invalid = segments.some(
    (segment) => !segment || segment.startsWith('.') || RESERVED_FOLDER_NAMES.has(segment) || /[<>:"|?*]/.test(segment)
  )
  return invalid ? null : segments.join('/')
}

/**
 * `<parent>/<name>` as a valid folder path, or null when it cannot be one
 * (invalid name, deeper than the library scan reaches). An empty name is the
 * parent itself.
 */
export function joinPaperFolder(parent: string, name: string): string | null {
  const child = name.trim()
  if (!child) return parent
  return normalizePaperFolderInput(parent ? `${parent}/${child}` : child)
}

function storageKey(library: string): string {
  return `${KEY_PREFIX}${normalizePath(library)}`
}

export function readImportFolder(library: string): string {
  if (!library) return ''
  try {
    return normalizePaperFolderInput(window.localStorage.getItem(storageKey(library)) ?? '') ?? ''
  } catch {
    return ''
  }
}

export function writeImportFolder(library: string, folder: string): void {
  if (!library) return
  try {
    window.localStorage.setItem(storageKey(library), folder)
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/** `parentDir` for `paperImport*` calls: the papers dir joined with the folder. */
export function paperImportParentDir(papersDir: string, folder: string): string {
  const base = papersDir.trim().replace(/\/+$/, '') || 'papers'
  return folder ? `${base}/${folder}` : base
}

/** Short label for a folder: its last segment, or `rootLabel` for ''. */
export function importFolderLabel(folder: string, rootLabel: string): string {
  return folder ? folder.split('/').pop() || folder : rootLabel
}

/**
 * Label that keeps a nested folder recognisable: the whole path while it is
 * short, otherwise `…/parent/leaf`. '' (the papers dir itself) is `rootLabel`.
 */
export function folderDisplayPath(folder: string, rootLabel: string): string {
  if (!folder) return rootLabel
  const parts = folder.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : folder
}

function currentLibrary(): string {
  return normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)
}

/** The fixed paper-space target never follows the selected Work root. */
export function currentImportFolder(): string {
  return ''
}

/** The only import destination is the paper space's root papers directory. */
export function currentImportParentDir(_folder = ''): string {
  return paperImportParentDir(useWriteWorkspaceStore.getState().paperReading.papersDir, '')
}

/** The fixed paper space has no user-selectable import folder. */
export function setImportFolder(_folder: string, _library?: string): void {
  // Kept as a no-op compatibility boundary for older drag/drop callers.
}

/** Hook: the fixed paper-space root has no folder selector. */
export function useImportFolder(): string {
  return ''
}

export type CreatePaperFolderResult = { ok: true; folder: string } | { ok: false; message: string }

/** Create `<papersDir>/<folder>` on disk inside `library` (default: mounted root). */
export async function createPaperFolder(
  raw: string,
  library?: string
): Promise<CreatePaperFolderResult> {
  const folder = normalizePaperFolderInput(raw)
  if (!folder) return { ok: false, message: 'invalid' }
  const root = normalizePath(library ?? '') || currentLibrary()
  if (!root || typeof window.kunGui?.paperCreateGroup !== 'function') {
    return { ok: false, message: 'unavailable' }
  }
  const result = await window.kunGui
    .paperCreateGroup({ workspaceRoot: root, group: folder })
    .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
  if (!result.ok) {
    return {
      ok: false,
      message: 'code' in result && result.code === 'invalid-group' ? 'invalid' : result.message
    }
  }
  if (root === currentLibrary()) usePaperModeStore.getState().addGroup(result.group)
  refreshPaperLibrary(root)
  return { ok: true, folder: result.group }
}
