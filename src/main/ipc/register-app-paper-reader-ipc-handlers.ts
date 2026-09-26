import { app, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  paperArxivTodayPayloadSchema,
  paperFetchFeedPayloadSchema,
  paperIdentifyPdfPayloadSchema,
  paperListVenuePayloadSchema,
  paperVenueCatalogPayloadSchema,
  paperMarksReadPayloadSchema,
  paperMarksWritePayloadSchema,
  paperReferencesPayloadSchema,
  paperSaveVisualMarkPayloadSchema,
  paperResolveDoiPayloadSchema,
  paperSearchTitlePayloadSchema,
  paperTranslateBlocksPayloadSchema,
  paperTranslateDocumentPayloadSchema,
  paperTranslateSelectionPayloadSchema,
  paperUrlMetaPayloadSchema
} from './app-ipc-schemas/paper-reader'
import { paperExportBibtexPayloadSchema, paperImportBibtexPayloadSchema } from './app-ipc-schemas/paper-library'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import type {
  PaperBibtexImportResult,
  PaperMarksResult,
  PaperReferencesResult,
  PaperTranslateBlocksResult,
  PaperTranslateDocumentResult,
  PaperTranslateTextResult
} from '../../shared/paper/paper-library-types'
import { paperHighlightSchema } from '../../shared/paper/paper-marks-types'
import {
  normalizeWritePaperReadingSettings,
  normalizeWritePapersDir
} from '../../shared/app-settings-write'
import { normalizeWritePaperModeSettings } from '../../shared/app-settings-paper-mode'
import type { WritePaperModeSettingsPatchV1 } from '../../shared/app-settings-types-paper-mode'
import {
  canonicalPath,
  expandHomePath,
  resolveTargetPathWithinWorkspace
} from '../services/workspace-paths'
import { PaperUnitError } from '../services/paper/paper-unit-service'
import {
  readPaperUnitMetaV2,
  exportPaperBibtex,
  importPaperBibtex
} from '../services/paper/paper-library-service'
import {
  deletePaperMarkCard,
  listPaperMarkCards,
  mergeWritePaperAnnotations,
  readPaperAnnotations,
  writePaperMarkCard,
  writePaperVisualMarkPng
} from '../services/paper/paper-marks-service'
import {
  translatePaperDocument,
  translatePaperSelection
} from '../services/paper/paper-translate-service'
import { translatePaperBlocks } from '../services/paper/paper-block-translate'
import { resolvePaperReferences } from '../services/paper/paper-references-service'
import {
  fetchArxivToday,
  fetchPaperFeed,
  fetchUrlPaperMeta,
  searchPapersByTitle
} from '../services/paper/paper-discover-service'
import { fetchCoolVenue, fetchCoolVenueCatalog } from '../services/paper/coolpapers-venue-client'
import { identifyLocalPdf } from '../services/paper/paper-identify-service'
import { fetchCrossrefWork } from '../services/paper/crossref-client'
import { beginPaperJob, finishPaperJob, isPaperJobCanceled } from '../services/paper/paper-jobs'
import { resolveProviderProxyUrl, resolveKunRuntimeSettings } from '../../shared/app-settings'

function resolvePath(raw: string): string {
  return resolve(expandHomePath(raw.trim()))
}

function paperError<T>(error: unknown, fallbackCode: string, fallbackMessage: string): T {
  if (error instanceof PaperUnitError) {
    return { ok: false, code: error.code, message: error.message } as T
  }
  return {
    ok: false,
    code: fallbackCode,
    message: error instanceof Error ? error.message : fallbackMessage
  } as T
}

export function registerAppPaperReaderIpcHandlers(
  options: RegisterAppIpcHandlersOptions
): void {
  const { getMainWindow, store, logError } = options

  const unitDirAbsFor = async (workspaceRoot: string, unitDir: string) => {
    const workspacePath = await canonicalPath(resolvePath(workspaceRoot))
    return { workspacePath, unitDirAbs: await resolveTargetPathWithinWorkspace(unitDir, workspacePath) }
  }

  const papersDirAbsFor = async (workspacePath: string): Promise<string> => {
    const settings = await store.load()
    const paperReading = normalizeWritePaperReadingSettings(
      (settings.write as { paperReading?: unknown } | undefined)?.paperReading as never
    )
    return resolveTargetPathWithinWorkspace(normalizeWritePapersDir(paperReading.papersDir), workspacePath)
  }

  const fetchContext = async () => {
    const settings = await store.load()
    const runtime = resolveKunRuntimeSettings(settings)
    return { proxyUrl: resolveProviderProxyUrl(settings, runtime.providerId) }
  }

  // ---- marks ----------------------------------------------------------------

  ipcMain.handle(
    'paper-reader:marks-read',
    async (event, payload: unknown): Promise<PaperMarksResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-reader:marks-read', paperMarksReadPayloadSchema, payload)
      try {
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        const [annotations, cards] = await Promise.all([
          readPaperAnnotations(unitDirAbs),
          listPaperMarkCards(unitDirAbs)
        ])
        return { ok: true, items: [...annotations, ...cards] }
      } catch (error) {
        logError?.('paper-reader', 'marks-read failed', error)
        return paperError<PaperMarksResult>(error, 'io', 'Failed to read marks.')
      }
    }
  )

  ipcMain.handle(
    'paper-reader:marks-write',
    async (event, payload: unknown): Promise<PaperMarksResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-reader:marks-write', paperMarksWritePayloadSchema, payload)
      try {
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        // Split the payload: highlights merge into annotations.json; translate/
        // ask cards persist as per-id files under marks/.
        const highlights = z.array(paperHighlightSchema).parse(
          (request.items as { kind?: string }[]).filter((item) => item?.kind === 'highlight')
        )
        const cards = (request.items as { kind?: string }[]).filter(
          (item) => item && (item.kind === 'translate' || item.kind === 'ask' || item.kind === 'visual')
        )
        for (const card of cards) {
          await writePaperMarkCard(unitDirAbs, card)
        }
        for (const removedId of request.removedIds ?? []) {
          await deletePaperMarkCard(unitDirAbs, removedId)
        }
        const merged = await mergeWritePaperAnnotations(
          unitDirAbs,
          highlights,
          request.removedIds ?? []
        )
        return { ok: true, items: merged }
      } catch (error) {
        logError?.('paper-reader', 'marks-write failed', error)
        return paperError<PaperMarksResult>(error, 'io', 'Failed to write marks.')
      }
    }
  )

  ipcMain.handle(
    'paper-reader:save-visual-mark',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-reader:save-visual-mark',
        paperSaveVisualMarkPayloadSchema,
        payload
      )
      try {
        const png = Buffer.from(request.pngBase64, 'base64')
        const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        if (png.length < 8 || !png.subarray(0, 8).equals(PNG_MAGIC) || png.length > 4 * 1024 * 1024) {
          return { ok: false as const, code: 'invalid-image' as const, message: 'Invalid PNG payload.' }
        }
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        const meta = await readPaperUnitMetaV2(unitDirAbs)
        if (!meta) {
          return { ok: false as const, code: 'invalid-unit' as const, message: 'paper.json is missing or invalid.' }
        }
        const imagePath = await writePaperVisualMarkPng(unitDirAbs, request.mark.id, png)
        const now = new Date().toISOString()
        const card = {
          id: request.mark.id,
          kind: 'visual' as const,
          page: request.mark.page,
          rect: request.mark.rect,
          ...(request.mark.comment ? { comment: request.mark.comment } : {}),
          image: { path: imagePath },
          createdAt: now,
          updatedAt: now
        }
        await writePaperMarkCard(unitDirAbs, card)
        return { ok: true as const, mark: card }
      } catch (error) {
        logError?.('paper-reader', 'save-visual-mark failed', error)
        return paperError<unknown>(error, 'io', 'Failed to save the region mark.')
      }
    }
  )

  // ---- translation ------------------------------------------------------------

  ipcMain.handle(
    'paper-reader:translate-selection',
    async (event, payload: unknown): Promise<PaperTranslateTextResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-reader:translate-selection',
        paperTranslateSelectionPayloadSchema,
        payload
      )
      try {
        const settings = await store.load()
        return await translatePaperSelection({
          settings,
          text: request.text,
          targetLanguage: request.targetLanguage,
          providerId: request.providerId,
          model: request.model
        })
      } catch (error) {
        logError?.('paper-reader', 'translate-selection failed', error)
        return paperError<PaperTranslateTextResult>(error, 'io', 'Translation failed.')
      }
    }
  )

  ipcMain.handle(
    'paper-reader:translate-document',
    async (event, payload: unknown): Promise<PaperTranslateDocumentResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-reader:translate-document',
        paperTranslateDocumentPayloadSchema,
        payload
      )
      const job = beginPaperJob(request.requestId, 'translate-document', event.sender)
      try {
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        const meta = await readPaperUnitMetaV2(unitDirAbs)
        if (!meta) {
          return { ok: false, code: 'invalid-unit', message: 'paper.json is missing or invalid.' }
        }
        const settings = await store.load()
        const result = await translatePaperDocument({
          settings,
          unitDirAbs,
          meta,
          targetLanguage: request.targetLanguage,
          providerId: request.providerId,
          model: request.model,
          signal: job.signal,
          progress: (done, total) => job.progress('translate', `${done}/${total}`)
        })
        finishPaperJob(request.requestId, result.ok ? 'done' : result.code === 'canceled' ? 'canceled' : 'error', result.ok ? undefined : result.message)
        return result
      } catch (error) {
        logError?.('paper-reader', 'translate-document failed', error)
        finishPaperJob(request.requestId, isPaperJobCanceled(job.signal, error) ? 'canceled' : 'error')
        return paperError<PaperTranslateDocumentResult>(error, 'io', 'Translation failed.')
      }
    }
  )

  ipcMain.handle(
    'paper-reader:translate-blocks',
    async (event, payload: unknown): Promise<PaperTranslateBlocksResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload(
        'paper-reader:translate-blocks',
        paperTranslateBlocksPayloadSchema,
        payload
      )
      try {
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        const meta = await readPaperUnitMetaV2(unitDirAbs)
        if (!meta) {
          return { ok: false, code: 'invalid-unit', message: 'paper.json is missing or invalid.' }
        }
        const settings = await store.load()
        return await translatePaperBlocks({
          settings,
          unitDirAbs,
          blocks: request.blocks,
          targetLanguage: request.targetLanguage,
          providerId: request.providerId,
          model: request.model
        })
      } catch (error) {
        logError?.('paper-reader', 'translate-blocks failed', error)
        return paperError<PaperTranslateBlocksResult>(error, 'io', 'Translation failed.')
      }
    }
  )

  // ---- references ---------------------------------------------------------------

  ipcMain.handle(
    'paper-reader:references',
    async (event, payload: unknown): Promise<PaperReferencesResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-reader:references', paperReferencesPayloadSchema, payload)
      try {
        const { unitDirAbs } = await unitDirAbsFor(request.workspaceRoot, request.unitDir)
        const meta = await readPaperUnitMetaV2(unitDirAbs)
        if (!meta) {
          return { ok: false, code: 'invalid-unit', message: 'paper.json is missing or invalid.' }
        }
        const settings = await store.load()
        const scholar = normalizeWritePaperModeSettings(
          (settings.write as { paperMode?: WritePaperModeSettingsPatchV1 } | undefined)?.paperMode
        ).scholar
        const context = await fetchContext()
        return await resolvePaperReferences({
          unitDirAbs,
          meta,
          force: request.force,
          kind: request.kind,
          online: scholar.onlineReferences,
          fetchContext: context,
          scholarApiKey: scholar.semanticScholarApiKey || undefined,
          crossrefMailto: scholar.crossrefMailto || undefined
        })
      } catch (error) {
        logError?.('paper-reader', 'references failed', error)
        return paperError<PaperReferencesResult>(error, 'io', 'Failed to load references.')
      }
    }
  )

  // ---- bibtex --------------------------------------------------------------------

  ipcMain.handle(
    'paper-library:export-bibtex',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-library:export-bibtex', paperExportBibtexPayloadSchema, payload)
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const papersDirAbs = await papersDirAbsFor(workspacePath)
        const unitDirAbs = request.unitDir
          ? await resolveTargetPathWithinWorkspace(request.unitDir, workspacePath)
          : undefined
        const bibtex = await exportPaperBibtex(workspacePath, papersDirAbs, unitDirAbs)
        return { ok: true as const, bibtex }
      } catch (error) {
        logError?.('paper-library', 'export-bibtex failed', error)
        return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'paper-library:import-bibtex',
    async (event, payload: unknown): Promise<PaperBibtexImportResult> => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-library:import-bibtex', paperImportBibtexPayloadSchema, payload)
      const job = beginPaperJob(request.requestId, 'bibtex-import', event.sender)
      try {
        const workspacePath = await canonicalPath(resolvePath(request.workspaceRoot))
        const papersDirAbs = await papersDirAbsFor(workspacePath)
        const result = await importPaperBibtex(workspacePath, papersDirAbs, request.bibtex, job.signal)
        finishPaperJob(request.requestId, 'done')
        return { ok: true, ...result }
      } catch (error) {
        logError?.('paper-library', 'import-bibtex failed', error)
        finishPaperJob(request.requestId, isPaperJobCanceled(job.signal, error) ? 'canceled' : 'error')
        if (job.signal.aborted) {
          return { ok: false, code: 'canceled', message: 'Import canceled.' }
        }
        return paperError<PaperBibtexImportResult>(error, 'io', 'BibTeX import failed.')
      }
    }
  )

  // ---- discover -------------------------------------------------------------------

  ipcMain.handle(
    'paper-discover:search-title',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:search-title', paperSearchTitlePayloadSchema, payload)
      return searchPapersByTitle({
        query: request.query,
        limit: request.limit,
        fetchContext: await fetchContext()
      })
    }
  )

  ipcMain.handle(
    'paper-discover:resolve-doi',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:resolve-doi', paperResolveDoiPayloadSchema, payload)
      try {
        const settings = await store.load()
        const scholar = normalizeWritePaperModeSettings(
          (settings.write as { paperMode?: WritePaperModeSettingsPatchV1 } | undefined)?.paperMode
        ).scholar
        const meta = await fetchCrossrefWork(request.doi, {
          ...(await fetchContext()),
          mailto: scholar.crossrefMailto || undefined
        })
        if (!meta || !meta.title) {
          return { ok: false as const, code: 'not-found' as const, message: 'DOI not found.' }
        }
        return { ok: true as const, meta }
      } catch (error) {
        logError?.('paper-discover', 'resolve-doi failed', error)
        return { ok: false as const, code: 'network' as const, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'paper-discover:url-meta',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:url-meta', paperUrlMetaPayloadSchema, payload)
      return fetchUrlPaperMeta(request.url, await fetchContext())
    }
  )

  ipcMain.handle(
    'paper-discover:identify-pdf',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:identify-pdf', paperIdentifyPdfPayloadSchema, payload)
      try {
        const result = await identifyLocalPdf(resolvePath(request.path))
        return { ok: true as const, ...result }
      } catch (error) {
        logError?.('paper-discover', 'identify-pdf failed', error)
        return { ok: false as const, code: 'io' as const, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'paper-discover:feed',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:feed', paperFetchFeedPayloadSchema, payload)
      return fetchPaperFeed(request.url, await fetchContext())
    }
  )

  ipcMain.handle(
    'paper-discover:arxiv-today',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:arxiv-today', paperArxivTodayPayloadSchema, payload)
      const date = request.date ?? new Date().toISOString().slice(0, 10)
      return fetchArxivToday({
        categories: request.categories,
        date,
        cacheDir: join(app.getPath('userData'), 'paper-discover'),
        force: request.force,
        fetchContext: await fetchContext()
      })
    }
  )

  ipcMain.handle(
    'paper-discover:venue',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:venue', paperListVenuePayloadSchema, payload)
      return fetchCoolVenue(request, await fetchContext())
    }
  )

  ipcMain.handle(
    'paper-discover:venue-catalog',
    async (event, payload: unknown) => {
      assertTrustedWorkbenchSender(event, getMainWindow)
      const request = parseIpcPayload('paper-discover:venue-catalog', paperVenueCatalogPayloadSchema, payload)
      return fetchCoolVenueCatalog({ ...(await fetchContext()), force: request.force })
    }
  )
}
