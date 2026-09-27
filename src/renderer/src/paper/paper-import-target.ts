/**
 * Import target folder for paper mode. Papers land in `<papersDir>/<folder>`
 * ('' = the papers dir itself). The last folder used is remembered per
 * library, so every import entry point (dialog, search, research pool,
 * assistant cards, drag-and-drop) files new papers in the same place.
 */
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { normalizePath } from '../write/write-workspace-store-helpers'
import { usePaperModeStore } from './paper-mode-store'

const KEY_PREFIX = 'kun.paper.importFolder.'
const MAX_FOLDER_DEPTH = 3
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

function currentLibrary(): string {
  return normalizePath(useWriteWorkspaceStore.getState().workspaceRoot)
}

/** Current import folder for the open library (non-hook read). */
export function currentImportFolder(): string {
  const library = currentLibrary()
  const chosen = usePaperModeStore.getState().importFolders[library]
  return chosen ?? readImportFolder(library)
}

/** `parentDir` for the current library's import folder. */
export function currentImportParentDir(folder = currentImportFolder()): string {
  return paperImportParentDir(useWriteWorkspaceStore.getState().paperReading.papersDir, folder)
}

export function setImportFolder(folder: string): void {
  const library = currentLibrary()
  if (!library) return
  usePaperModeStore.getState().setImportFolder(library, folder)
  writeImportFolder(library, folder)
}

/** Hook: the open library's import folder, re-rendering on change. */
export function useImportFolder(): string {
  const library = useWriteWorkspaceStore((s) => normalizePath(s.workspaceRoot))
  const chosen = usePaperModeStore((s) => s.importFolders[library])
  return chosen ?? readImportFolder(library)
}

export type CreatePaperFolderResult = { ok: true; folder: string } | { ok: false; message: string }

/** Create `<papersDir>/<folder>` on disk and add it to the folder list. */
export async function createPaperFolder(raw: string): Promise<CreatePaperFolderResult> {
  const folder = normalizePaperFolderInput(raw)
  if (!folder) return { ok: false, message: 'invalid' }
  const library = currentLibrary()
  if (!library || typeof window.kunGui?.paperCreateGroup !== 'function') {
    return { ok: false, message: 'unavailable' }
  }
  const result = await window.kunGui
    .paperCreateGroup({ workspaceRoot: library, group: folder })
    .catch((error: unknown) => ({ ok: false as const, message: String(error) }))
  if (!result.ok) {
    return {
      ok: false,
      message: 'code' in result && result.code === 'invalid-group' ? 'invalid' : result.message
    }
  }
  usePaperModeStore.getState().addGroup(result.group)
  usePaperModeStore.getState().refreshEntries()
  return { ok: true, folder: result.group }
}
