import { ipcMain } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  paperCancelPayloadSchema,
  paperImportPayloadSchema,
  paperJobPayloadSchema,
  paperListUnitsPayloadSchema,
  paperRecordInterpretationPayloadSchema,
  paperUnitTargetPayloadSchema
} from './app-ipc-schemas'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import {
  normalizeWritePapersDir,
  normalizeWritePaperReadingSettings
} from '../../shared/app-settings-write'
import { resolveModelProviderProxyUrl } from '../../shared/app-settings-provider-core'
import {
  PAPER_CACHE_DIR_NAME,
  PAPER_COOL_NOTES_CACHE_FILE_NAME,
  PAPER_META_FILE_NAME,
  PAPER_NOTES_FILE_NAME,
  type PaperCoolNotesResult,
  type PaperFigureSource,
  type PaperImportResult,
  type PaperListUnitsResult,
  type PaperPreprocessResult,
  type PaperRecordInterpretationResult,
  type PaperUnitReadResult
} from '../../shared/paper/paper-types'
import {
  canonicalPath,
  expandHomePath,
  pathExists,
  resolveTargetPathWithinWorkspace
} from '../services/workspace-paths'
import {
  PaperUnitError,
  importPaperUnit,
  listPaperUnits,
  readPaperFigureIndex,
  readPaperUnitMeta,
  resolvePaperImportSource,
  updatePaperUnitMeta,
  workspaceRelativeDir
} from '../services/paper/paper-unit-service'
import { PaperFetchError } from '../services/paper/paper-http'
import { buildCoolNotesBlock, fetchCoolNotesMarkdown } from '../services/paper/coolpapers-client'
import { appendMarkdownBlockIdempotent } from '../services/paper/paper-notes-append'
import { generatePaperText } from '../services/paper/paper-text-service'
import { generatePaperFigures } from '../services/paper/paper-figure-service'
import {
  beginPaperJob,
  cancelPaperJob,
  finishPaperJob
} from '../services/paper/paper-jobs'

type UnitContext = { workspacePath: string; unitDirAbs: string }

async function resolveUnitDir(workspaceRoot: string, unitDir: string): Promise<UnitContext> {
  const workspacePath = await canonicalPath(resolvePath(workspaceRoot))
  const unitDirAbs = await resolveTargetPathWithinWorkspace(unitDir, workspacePath)
  const info = await stat(unitDirAbs).catch(() => null)
  if (!info?.isDirectory()) {
    throw new PaperUnitError('invalid-unit', 'paper unit path is not a directory')
  }
  return { workspacePath, unitDirAbs }
}

function resolvePath(raw: string): string {
  return resolve(expandHomePath(raw.trim()))
}

function paperErrorResult<T>(error: unknown, fallbackCode: 'io' | 'invalid-unit' | 'network' = 'io'): T {
  if (error instanceof PaperUnitError) {
    return { ok: false, code: error.code === 'not-found' ? 'not-found' : error.code, message: error.message } as T
  }
  if (error instanceof PaperFetchError) {
    const code = error.code === 'timeout' || error.code === 'canceled' ? error.code : 'network'
    return { ok: false, code, message: error.message } as T
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { ok: false, code: 'canceled', message: 'Canceled.' } as T
  }
  return { ok: false, code: fallbackCode, message: error instanceof Error ? error.message : String(error) } as T
}

export function registerAppPaperIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { getMainWindow, store, logError } = options

  const loadPaperSettings = async () => {
    const settings = await store.load()
    return {
      paperReading: normalizeWritePaperReadingSettings(
        (settings.write as { paperReading?: unknown } | undefined)?.paperReading as never
      ),
      proxyUrl: resolveModelProviderProxyUrl(settings)
    }
  }

  ipcMain.handle('paper:import', async (event, payload: unknown): Promise<PaperImportResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:import', paperImportPayloadSchema, payload)
    const job = beginPaperJob(request.requestId, 'import', event.sender)
    let jobStatus: 'done' | 'error' | 'canceled' = 'done'
    try {
      const { paperReading, proxyUrl } = await loadPaperSettings()
      const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
      const parentRel = normalizeWritePapersDir(request.parentDir ?? paperReading.papersDir)
      const parentAbs = await resolveTargetPathWithinWorkspace(parentRel, workspacePath)
      const localPdfPath = request.localPdfPath?.trim()
        ? resolvePath(request.localPdfPath)
        : undefined
      const resolution = resolvePaperImportSource({ input: request.input, localPdfPath })
      if (!resolution) {
        return { ok: false, code: 'invalid-input', message: 'Unrecognized paper input.' }
      }
      const outcome = await importPaperUnit(parentAbs, resolution, {
        signal: job.signal,
        proxyUrl,
        onProgress: job.progress
      })
      return {
        ok: true,
        unitDir: workspaceRelativeDir(workspacePath, outcome.unitDir),
        meta: outcome.meta,
        reused: outcome.reused
      }
    } catch (error) {
      logError?.('paper', 'paper:import failed', error)
      jobStatus = job.signal.aborted ? 'canceled' : 'error'
      return paperErrorResult<PaperImportResult>(error, 'io')
    } finally {
      finishPaperJob(request.requestId, jobStatus)
    }
  })

  ipcMain.handle('paper:read-unit', async (event, payload: unknown): Promise<PaperUnitReadResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:read-unit', paperUnitTargetPayloadSchema, payload)
    try {
      const { workspacePath, unitDirAbs } = await resolveUnitDir(request.workspaceRoot, request.unitDir)
      const meta = await readPaperUnitMeta(unitDirAbs)
      if (!meta) {
        return { ok: false, code: 'not-paper-unit', message: `No valid ${PAPER_META_FILE_NAME} found.` }
      }
      const figures = await readPaperFigureIndex(unitDirAbs)
      return { ok: true, unitDir: workspaceRelativeDir(workspacePath, unitDirAbs), meta, figures }
    } catch (error) {
      return paperErrorResult<PaperUnitReadResult>(error, 'invalid-unit')
    }
  })

  ipcMain.handle('paper:list-units', async (event, payload: unknown): Promise<PaperListUnitsResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:list-units', paperListUnitsPayloadSchema, payload)
    try {
      const { paperReading } = await loadPaperSettings()
      const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
      const parentRel = normalizeWritePapersDir(request.parentDir ?? paperReading.papersDir)
      const parentAbs = await resolveTargetPathWithinWorkspace(parentRel, workspacePath)
      const units = await listPaperUnits(parentAbs)
      return {
        ok: true,
        units: units.map((unit) => ({
          unitDir: workspaceRelativeDir(workspacePath, unit.dir),
          meta: unit.meta
        }))
      }
    } catch (error) {
      return paperErrorResult<PaperListUnitsResult>(error, 'io')
    }
  })

  ipcMain.handle('paper:fetch-cool-notes', async (event, payload: unknown): Promise<PaperCoolNotesResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:fetch-cool-notes', paperJobPayloadSchema, payload)
    const job = beginPaperJob(request.requestId, 'cool-notes', event.sender)
    let jobStatus: 'done' | 'error' | 'canceled' = 'done'
    try {
      const { paperReading, proxyUrl } = await loadPaperSettings()
      if (!paperReading.coolNotesEnabled) {
        return { ok: false, code: 'invalid-unit', message: 'Cool Papers notes are disabled in settings.' }
      }
      const { unitDirAbs } = await resolveUnitDir(request.workspaceRoot, request.unitDir)
      const meta = await readPaperUnitMeta(unitDirAbs)
      if (!meta) {
        return { ok: false, code: 'invalid-unit', message: `No valid ${PAPER_META_FILE_NAME} found.` }
      }
      const notesPath = join(unitDirAbs, PAPER_NOTES_FILE_NAME)
      if (!(await pathExists(notesPath))) {
        return { ok: false, code: 'no-notes-file', message: `No ${PAPER_NOTES_FILE_NAME} in this paper unit.` }
      }

      const cachePath = join(unitDirAbs, PAPER_CACHE_DIR_NAME, PAPER_COOL_NOTES_CACHE_FILE_NAME)
      let markdown = ''
      let pageUrl = meta.sourceUrl ?? ''
      let matchedBy = meta.coolNotes?.matchedBy ?? 'arxivId'
      let fromCache = false

      if (!request.force && (await pathExists(cachePath))) {
        markdown = await readFile(cachePath, 'utf8')
        fromCache = true
      }
      if (!markdown.trim()) {
        job.progress('resolve', 'resolving on papers.cool')
        const outcome = await fetchCoolNotesMarkdown(
          {
            sourceUrl: meta.sourceUrl,
            coolId: meta.coolPapers?.branch === 'venue' ? meta.coolPapers.id : undefined,
            arxivId: meta.arxivId,
            title: meta.title
          },
          { signal: job.signal, proxyUrl }
        )
        if (!outcome.found) return { ok: true, found: false }
        markdown = outcome.markdown
        pageUrl = outcome.pageUrl
        matchedBy = outcome.matchedBy
        await mkdir(join(unitDirAbs, PAPER_CACHE_DIR_NAME), { recursive: true })
        await writeFile(cachePath, markdown, 'utf8')
      }

      job.progress('append', 'appending to NOTES.md')
      const appended = await appendMarkdownBlockIdempotent(
        notesPath,
        buildCoolNotesBlock(markdown, pageUrl)
      )
      await updatePaperUnitMeta(unitDirAbs, (m) => ({
        ...m,
        coolNotes: { fetchedAt: new Date().toISOString(), matchedBy, url: pageUrl }
      }))
      return { ok: true, found: true, appended, fromCache, url: pageUrl, matchedBy }
    } catch (error) {
      logError?.('paper', 'paper:fetch-cool-notes failed', error)
      jobStatus = job.signal.aborted ? 'canceled' : 'error'
      if (job.signal.aborted) return { ok: false, code: 'canceled', message: 'Canceled.' }
      return paperErrorResult<PaperCoolNotesResult>(error, 'network')
    } finally {
      finishPaperJob(request.requestId, jobStatus)
    }
  })

  ipcMain.handle('paper:preprocess', async (event, payload: unknown): Promise<PaperPreprocessResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:preprocess', paperJobPayloadSchema, payload)
    const job = beginPaperJob(request.requestId, 'preprocess', event.sender)
    let jobStatus: 'done' | 'error' | 'canceled' = 'done'
    try {
      const { proxyUrl } = await loadPaperSettings()
      const { unitDirAbs } = await resolveUnitDir(request.workspaceRoot, request.unitDir)
      const meta = await readPaperUnitMeta(unitDirAbs)
      if (!meta) {
        return { ok: false, code: 'invalid-unit', message: `No valid ${PAPER_META_FILE_NAME} found.` }
      }
      if (
        !request.force &&
        meta.preprocess?.textStatus === 'ok' &&
        meta.preprocess.figuresStatus !== undefined &&
        meta.preprocess.figuresStatus !== 'none' &&
        meta.preprocess.figuresStatus !== 'failed'
      ) {
        const figures = await readPaperFigureIndex(unitDirAbs)
        return {
          ok: true,
          textStatus: 'ok',
          figuresStatus: meta.preprocess.figuresStatus,
          figuresSource: meta.preprocess.figuresSource,
          figureCount: figures?.items.length ?? 0
        }
      }

      job.progress('text', 'extracting paper text')
      const textStatus = await generatePaperText(unitDirAbs, meta)
      job.progress('figures', 'extracting figures')
      let figuresStatus: 'ok' | 'partial' | 'failed' = 'failed'
      let figuresSource: PaperFigureSource | undefined
      let figureCount = 0
      try {
        const figures = await generatePaperFigures(unitDirAbs, meta, { signal: job.signal, proxyUrl }, job.progress)
        figuresStatus = figures.status
        figuresSource = figures.source
        figureCount = figures.figureCount
      } catch (error) {
        if (!job.signal.aborted) logError?.('paper', 'paper figures failed', error)
      }
      await updatePaperUnitMeta(unitDirAbs, (m) => ({
        ...m,
        preprocess: {
          textStatus,
          figuresStatus,
          figuresSource,
          updatedAt: new Date().toISOString()
        }
      }))
      return {
        ok: true,
        textStatus,
        figuresStatus,
        figuresSource,
        figureCount
      }
    } catch (error) {
      logError?.('paper', 'paper:preprocess failed', error)
      jobStatus = job.signal.aborted ? 'canceled' : 'error'
      if (job.signal.aborted) return { ok: false, code: 'canceled', message: 'Canceled.' }
      return paperErrorResult<PaperPreprocessResult>(error, 'io')
    } finally {
      finishPaperJob(request.requestId, jobStatus)
    }
  })

  ipcMain.handle('paper:record-interpretation', async (event, payload: unknown): Promise<PaperRecordInterpretationResult> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload(
      'paper:record-interpretation',
      paperRecordInterpretationPayloadSchema,
      payload
    )
    try {
      const { unitDirAbs } = await resolveUnitDir(request.workspaceRoot, request.unitDir)
      const target = await resolveTargetPathWithinWorkspace(request.path, request.workspaceRoot)
      const relative = workspaceRelativeDir(unitDirAbs, target)
      if (relative.startsWith('..')) {
        return { ok: false, code: 'invalid-unit', message: 'Interpretation path must live inside the paper unit.' }
      }
      const meta = await updatePaperUnitMeta(unitDirAbs, (m) => {
        const interpretations = (m.interpretations ?? []).filter((entry) => entry.path !== relative)
        interpretations.push({ path: relative, createdAt: new Date().toISOString(), threadId: request.threadId })
        return { ...m, interpretations }
      })
      return { ok: true, meta }
    } catch (error) {
      return paperErrorResult<PaperRecordInterpretationResult>(error, 'io')
    }
  })

  ipcMain.handle('paper:cancel', async (event, payload: unknown): Promise<void> => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const request = parseIpcPayload('paper:cancel', paperCancelPayloadSchema, payload)
    cancelPaperJob(request.requestId)
  })
}
