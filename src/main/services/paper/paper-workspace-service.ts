import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { normalizeWritePaperModeSettings, PAPER_MODE_MAX_LIBRARIES } from '../../../shared/app-settings-paper-mode'
import type { AppSettingsV1 } from '../../../shared/app-settings'
import type { WritePaperModeSettingsV1 } from '../../../shared/app-settings-types-paper-mode'
import type { PaperWorkspaceEnsureResult } from '../../../shared/paper/paper-workspace-types'
import type { JsonSettingsStore } from '../../settings-store'
import { expandHomePath } from '../workspace-paths'

type FileSystem = Pick<typeof fs, 'access' | 'lstat' | 'mkdir' | 'realpath' | 'stat'>
type EnsureOptions = {
  store: Pick<JsonSettingsStore, 'load' | 'updateIf'>
  userDataDir: () => string
}
type FailureCode = Extract<PaperWorkspaceEnsureResult, { ok: false }>['code']

class WorkspaceError extends Error {
  constructor(readonly code: FailureCode, message: string) {
    super(message)
  }
}

function selection(settings: AppSettingsV1): WritePaperModeSettingsV1 {
  return normalizeWritePaperModeSettings(settings.write.paperMode)
}

function sameSelection(a: WritePaperModeSettingsV1, b: WritePaperModeSettingsV1): boolean {
  return a.activeLibrary === b.activeLibrary &&
    a.workspaceInitialized === b.workspaceInitialized &&
    a.libraries.length === b.libraries.length &&
    a.libraries.every((root, index) => root === b.libraries[index])
}

function absolutePath(raw: string): string {
  const expanded = expandHomePath(raw)
  if (!expanded || expanded.includes('\0') || !isAbsolute(expanded)) {
    throw new WorkspaceError('invalid-root', 'The paper workspace must be an absolute folder path.')
  }
  return resolve(expanded)
}

async function checkDirectory(fileSystem: FileSystem, path: string, writable = false): Promise<void> {
  if (!(await fileSystem.stat(path)).isDirectory()) {
    throw new WorkspaceError('invalid-root', 'The paper workspace path is not a folder.')
  }
  // Existing libraries can be read-only. Import/edit operations own their write
  // errors; bootstrap must not make a readable library disappear from the UI.
  await fileSystem.access(path, constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0))
}

/**
 * The app-provided userData root may itself use an OS/user-selected alias.
 * Resolve that trusted anchor once. Managed children must be real directories,
 * never symlinks/junctions; check every existing segment before creating a child.
 * Ordinary, explicitly chosen library aliases are only validated, never created.
 */
async function managedDirectory(
  fileSystem: FileSystem,
  userDataPath: string,
  create: boolean
): Promise<boolean> {
  const anchor = await fileSystem.realpath(userDataPath)
  await checkDirectory(fileSystem, anchor, create)
  let parent = anchor
  let created = false
  for (const segment of ['paper-workspaces', 'default']) {
    const path = join(parent, segment)
    // Recheck the parent immediately before each mkdir; do not follow a managed
    // parent replaced with an alias while filesystem work was pending.
    if ((await fileSystem.realpath(parent)) !== parent) {
      throw new WorkspaceError('invalid-root', 'The managed paper workspace cannot use symbolic links.')
    }
    let info
    try {
      info = await fileSystem.lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error
      try {
        await fileSystem.mkdir(path, { mode: 0o700 })
        if (segment === 'default') created = true
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      info = await fileSystem.lstat(path)
    }
    if (info.isSymbolicLink() || !info.isDirectory() || (await fileSystem.realpath(path)) !== path) {
      throw new WorkspaceError('invalid-root', 'The managed paper workspace must be a real folder, not a symbolic link or file.')
    }
    parent = path
  }
  await checkDirectory(fileSystem, parent, create)
  return created
}

function failure(error: unknown, root: string, defaultWorkspaceRoot: string): PaperWorkspaceEnsureResult {
  const errno = (error as NodeJS.ErrnoException | undefined)?.code
  const code: FailureCode = error instanceof WorkspaceError ? error.code
    : errno === 'ENOENT' ? 'missing-root'
      : errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS' ? 'permission-denied'
        : errno === 'ENOTDIR' || errno === 'ELOOP' ? 'invalid-root' : 'io'
  const message = error instanceof WorkspaceError ? error.message
    : code === 'missing-root'
      ? 'The paper workspace folder is missing. Restore it or choose another folder; it will not be recreated automatically.'
      : code === 'permission-denied'
        ? 'The paper workspace could not be accessed or initialized. Check folder permissions or choose another folder.'
        : error instanceof Error ? error.message : String(error)
  return { ok: false, code, message, ...(root ? { workspaceRoot: root } : {}), defaultWorkspaceRoot }
}

/**
 * One shared in-flight operation per registered handler. Filesystem work stays
 * outside the settings lock. The final update rechecks the latest selection in
 * the store's atomic/revision-aware lane, so a newer user choice always wins.
 * Removing a registered folder (including the default) is never auto-repaired.
 */
export function createPaperWorkspaceEnsurer(
  { store, userDataDir }: EnsureOptions,
  fileSystem: FileSystem = fs
): () => Promise<PaperWorkspaceEnsureResult> {
  let inFlight: Promise<PaperWorkspaceEnsureResult> | undefined

  const ensure = async (): Promise<PaperWorkspaceEnsureResult> => {
    let defaultWorkspaceRoot = ''
    let root = ''
    try {
      const userDataPath = absolutePath(userDataDir())
      defaultWorkspaceRoot = join(userDataPath, 'paper-workspaces', 'default')
      while (true) {
        const snapshot = selection(await store.load())
        const bootstrap = !snapshot.activeLibrary && snapshot.libraries.length === 0 &&
          !snapshot.workspaceInitialized
        root = snapshot.activeLibrary || snapshot.libraries[0] || (bootstrap ? defaultWorkspaceRoot : '')
        if (!root) {
          return failure(new WorkspaceError('unconfigured', 'Choose a paper workspace folder to continue.'), root, defaultWorkspaceRoot)
        }
        if (!snapshot.libraries.includes(root) && snapshot.libraries.length >= PAPER_MODE_MAX_LIBRARIES) {
          return failure(new WorkspaceError('library-limit', 'The paper workspace list is full. Remove an unused workspace before adding this folder.'), root, defaultWorkspaceRoot)
        }

        let created = false
        try {
          const path = absolutePath(root)
          if (path === defaultWorkspaceRoot) {
            created = await managedDirectory(fileSystem, userDataPath, bootstrap)
          } else {
            await checkDirectory(fileSystem, path)
          }
        } catch (error) {
          // An obsolete failed lookup must not hide a newer valid user choice.
          if (!sameSelection(snapshot, selection(await store.load()))) continue
          return failure(error, root, defaultWorkspaceRoot)
        }

        const selectedRoot = root
        const { settings, applied } = await store.updateIf(
          (current) => sameSelection(snapshot, selection(current)),
          (current) => {
            const paperMode = selection(current)
            const libraries = paperMode.libraries.includes(selectedRoot)
              ? paperMode.libraries
              : [selectedRoot, ...paperMode.libraries]
            if (paperMode.activeLibrary === selectedRoot && paperMode.workspaceInitialized &&
              libraries === paperMode.libraries) return current
            return {
              ...current,
              write: {
                ...current.write,
                paperMode: { ...paperMode, libraries, activeLibrary: selectedRoot, workspaceInitialized: true }
              }
            }
          }
        )
        if (!applied) continue
        const saved = selection(settings)
        return {
          ok: true,
          workspaceRoot: saved.activeLibrary,
          defaultWorkspaceRoot,
          created,
          libraries: saved.libraries,
          activeLibrary: saved.activeLibrary
        }
      }
    } catch (error) {
      return failure(error, root, defaultWorkspaceRoot)
    }
  }

  return () => {
    inFlight ??= ensure().finally(() => { inFlight = undefined })
    return inFlight
  }
}
