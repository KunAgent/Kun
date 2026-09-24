import { app, ipcMain, shell } from 'electron'
import { resolve } from 'node:path'
import {
  paperLibraryDetectPayloadSchema,
  paperLibraryListPayloadSchema,
  paperLocalStateReadPayloadSchema,
  paperLocalStateWritePayloadSchema,
  paperMoveToGroupPayloadSchema,
  paperTrashUnitPayloadSchema,
  paperUpdateMetaPayloadSchema
} from './app-ipc-schemas/paper-library'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import {
  normalizeWritePaperReadingSettings,
  normalizeWritePapersDir
} from '../../shared/app-settings-write'
import type {
  PaperLibraryDetectResult,
  PaperLibraryEntriesResult,
  PaperLibraryTrashResult,
  PaperLocalLibraryState,
  PaperMoveToGroupResult
} from '../../shared/paper/paper-library-types'
import type { PaperUnitMetaV2 } from '../../shared/paper/paper-meta-v2'
import {
  canonicalPath,
  expandHomePath,
  resolveTargetPathWithinWorkspace
} from '../services/workspace-paths'
import {
  PaperUnitError,
  workspaceRelativeDir
} from '../services/paper/paper-unit-service'
import {
  detectPaperLibraries,
  movePaperUnitToGroup,
  scanPaperLibrary,
  scannedUnitToEntry,
  updatePaperUnitMetaV2
} from '../services/paper/paper-library-service'
import {
  readPaperLocalLibraryState,
  writePaperLocalUnitState
} from '../services/paper/paper-local-state-store'

function resolvePath(raw: string): string {
  return resolve(expandHomePath(raw.trim()))
}

function paperErrorResult<T>(error: unknown, fallbackCode: string = 'io'): T {
  if (error instanceof PaperUnitError) {
    return { ok: false, code: error.code, message: error.message } as T
  }
  return {
    ok: false,
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error)
  } as T
}

function emptyCounts() {
  return { total: 0, unread: 0, reading: 0, read: 0, missingPdf: 0 }
}

export function registerAppPaperLibraryIpcHandlers(
  options: RegisterAppIpcHandlersOptions
): void {
  const { getMainWindow, store, logError } = options

  const papersDirFor = async (override?: string): Promise<string> => {
    const settings = await store.load()
    const paperReading = normalizeWritePaperReadingSettings(
      (settings.write as { paperReading?: unknown } | undefined)?.paperReading as never
    )
    return normalizeWritePapersDir(override ?? paperReading.papersDir)
  }

  const userDataDir = (): string => app.getPath('userData')

  ipcMain.handle(
    'paper-library:list',
    async (event, payload: unknown): Promise<PaperLibraryEntriesResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:list',
        paperLibraryListPayloadSchema,
        payload
      )
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const papersDir = await papersDirFor(request.papersDir)
        const papersDirAbs = await resolveTargetPathWithinWorkspace(papersDir, workspacePath)
        const [units, local] = await Promise.all([
          scanPaperLibrary(workspacePath, papersDirAbs),
          readPaperLocalLibraryState(userDataDir(), workspacePath)
        ])
        const counts = emptyCounts()
        const tags = new Set<string>()
        const groups = new Set<string>()
        const entries = units.map((unit) => {
          const entry = scannedUnitToEntry(unit, local.units[unit.unitDir])
          counts.total += 1
          const status = entry.meta.status ?? 'unread'
          counts[status] += 1
          if (!entry.hasPdf) counts.missingPdf += 1
          for (const tag of entry.meta.tags ?? []) tags.add(tag)
          if (entry.group) groups.add(entry.group)
          return entry
        })
        return {
          ok: true,
          entries,
          counts,
          tags: [...tags].sort((a, b) => a.localeCompare(b)),
          groups: [...groups].sort((a, b) => a.localeCompare(b))
        }
      } catch (error) {
        logError?.('paper-library', 'paper-library:list failed', error)
        return paperErrorResult<PaperLibraryEntriesResult>(error, 'invalid-root')
      }
    }
  )

  ipcMain.handle(
    'paper-library:detect',
    async (event, payload: unknown): Promise<PaperLibraryDetectResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:detect',
        paperLibraryDetectPayloadSchema,
        payload
      )
      try {
        const papersDir = await papersDirFor(request.papersDir)
        const roots = request.workspaceRoots.map((root) => resolvePath(root))
        const candidates = await detectPaperLibraries(roots, papersDir)
        return { ok: true, candidates }
      } catch (error) {
        logError?.('paper-library', 'paper-library:detect failed', error)
        return { ok: false, candidates: [] }
      }
    }
  )

  ipcMain.handle(
    'paper-library:update-meta',
    async (
      event,
      payload: unknown
    ): Promise<
      | { ok: true; meta: PaperUnitMetaV2 }
      | { ok: false; code: 'invalid-unit' | 'io' | 'invalid-patch'; message: string }
    > => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:update-meta',
        paperUpdateMetaPayloadSchema,
        payload
      )
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const unitDirAbs = await resolveTargetPathWithinWorkspace(request.unitDir, workspacePath)
        const meta = await updatePaperUnitMetaV2(unitDirAbs, request.patch)
        return { ok: true, meta }
      } catch (error) {
        logError?.('paper-library', 'paper-library:update-meta failed', error)
        if (error instanceof PaperUnitError) {
          return { ok: false, code: 'invalid-unit', message: error.message }
        }
        return paperErrorResult(error, 'io')
      }
    }
  )

  ipcMain.handle(
    'paper-library:move-to-group',
    async (event, payload: unknown): Promise<PaperMoveToGroupResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:move-to-group',
        paperMoveToGroupPayloadSchema,
        payload
      )
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const papersDir = await papersDirFor()
        const papersDirAbs = await resolveTargetPathWithinWorkspace(papersDir, workspacePath)
        const unitDirAbs = await resolveTargetPathWithinWorkspace(request.unitDir, workspacePath)
        const group = request.group.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        if (group.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
          return { ok: false, code: 'invalid-group', message: 'Invalid group path.' }
        }
        const previousUnitDir = workspaceRelativeDir(workspacePath, unitDirAbs)
        const moved = await movePaperUnitToGroup(workspacePath, papersDirAbs, unitDirAbs, group)
        return { ok: true, unitDir: moved.unitDir, previousUnitDir }
      } catch (error) {
        logError?.('paper-library', 'paper-library:move-to-group failed', error)
        if (error instanceof PaperUnitError) {
          return {
            ok: false,
            code: error.code === 'io' ? 'exists' : 'invalid-unit',
            message: error.message
          }
        }
        return paperErrorResult<PaperMoveToGroupResult>(error, 'io')
      }
    }
  )

  ipcMain.handle(
    'paper-library:trash',
    async (event, payload: unknown): Promise<PaperLibraryTrashResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:trash',
        paperTrashUnitPayloadSchema,
        payload
      )
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const unitDirAbs = await resolveTargetPathWithinWorkspace(request.unitDir, workspacePath)
        await shell.trashItem(unitDirAbs)
        return { ok: true }
      } catch (error) {
        logError?.('paper-library', 'paper-library:trash failed', error)
        return paperErrorResult<PaperLibraryTrashResult>(error, 'io')
      }
    }
  )

  ipcMain.handle(
    'paper-library:local-state-read',
    async (event, payload: unknown): Promise<PaperLocalLibraryState> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:local-state-read',
        paperLocalStateReadPayloadSchema,
        payload
      )
      try {
        return await readPaperLocalLibraryState(userDataDir(), resolvePath(request.libraryRoot))
      } catch (error) {
        logError?.('paper-library', 'paper-library:local-state-read failed', error)
        return { version: 1, units: {} }
      }
    }
  )

  ipcMain.handle(
    'paper-library:local-state-write',
    async (event, payload: unknown): Promise<void> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-library:local-state-write',
        paperLocalStateWritePayloadSchema,
        payload
      )
      try {
        await writePaperLocalUnitState(
          userDataDir(),
          resolvePath(request.libraryRoot),
          request.unitRelDir,
          request.patch
        )
      } catch (error) {
        logError?.('paper-library', 'paper-library:local-state-write failed', error)
      }
    }
  )
}
