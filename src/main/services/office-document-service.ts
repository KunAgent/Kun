import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'
import sharp from 'sharp'
import {
  MAX_RUNTIME_DOCUMENT_SOURCE_BYTES,
  MAX_RUNTIME_DOCUMENT_TEXT_CHARS,
  isLegacyOfficeDocumentFormat,
  officeDocumentFormatFromName,
  officeDocumentPreviewSrcDoc,
  officeDocumentPreviewFormatFromName,
  officeDocumentPreviewMimeType,
  type LegacyOfficeDocumentFormat,
  type OfficeDocumentReadFailure,
  type OfficeDocumentReadSuccess,
  type LocalOfficeDocumentReadResult,
  type LocalOfficeDocumentTarget,
  type OfficeDocumentFormat,
  type OfficeDocumentPreviewFormat,
  type OfficeDocumentVisualPreview
} from '../../shared/office-document'
import {
  extractOfficeDocumentSheetNames,
  isSafeOfficeDocumentDataImage,
  sanitizeOfficeDocumentHtml,
  selectOfficeDocumentSheet
} from './office-document-html'
import {
  convertLegacyOfficeDocument,
  OfficeDocumentConversionError,
  type LegacyOfficeDocumentConversion,
  type LegacyOfficeDocumentConversionDependencies
} from './office-document-legacy'
import {
  createOfficeDocumentSnapshot,
  type OfficeDocumentSnapshot
} from './office-document-snapshot'
import { assertOoxmlPackageType } from './office-document-ooxml'

const OFFICECLI_TIMEOUT_MS = 60_000
const OFFICECLI_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const OFFICECLI_MAX_CONCURRENCY = 2
const OFFICECLI_VERSION = '1.0.141'
// The runtime's default preview/fallback limit is measured in Base64
// characters. 384 KiB encodes to exactly 512 KiB, so keep the binary side at
// or below that decoded ceiling.
const VISUAL_PREVIEW_MAX_BYTES = 384 * 1024
const VISUAL_PREVIEW_MAX_DIMENSION = 1920
let activeOfficeCliProcesses = 0
const officeCliProcessWaiters: Array<() => void> = []

export type OfficeCliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type OfficePreviewSelection = { page?: number; sheetIndex?: number }

type OfficeDocumentSemanticReadResult =
  | OfficeDocumentReadSuccess<OfficeDocumentPreviewFormat>
  | OfficeDocumentReadFailure

export type OfficeDocumentServiceDependencies = {
  binaryPath?: string
  runOfficeCli?: (args: string[]) => Promise<OfficeCliResult>
  renderHtml?: (html: string) => Promise<OfficeDocumentVisualPreview>
  signal?: AbortSignal
  convertLegacyDocument?: (
    sourcePath: string,
    sourceFormat: LegacyOfficeDocumentFormat,
    dependencies: LegacyOfficeDocumentConversionDependencies
  ) => Promise<LegacyOfficeDocumentConversion>
} & Pick<
  LegacyOfficeDocumentConversionDependencies,
  'resolveLibreOfficeBinary' | 'runLibreOffice' | 'temporaryDirectory'
>

export async function readLocalOfficeDocument(
  target: LocalOfficeDocumentTarget,
  dependencies: OfficeDocumentServiceDependencies = {}
): Promise<LocalOfficeDocumentReadResult> {
  // Keep the pre-existing local attachment reader scoped to modern OOXML. The
  // workspace route opts into legacy conversion below without widening uploads.
  const result = await readOfficeDocument(target, dependencies, false)
  return result as LocalOfficeDocumentReadResult
}

async function readOfficeDocument(
  target: LocalOfficeDocumentTarget,
  dependencies: OfficeDocumentServiceDependencies,
  allowLegacy: boolean,
  previewSelection: OfficePreviewSelection = {}
): Promise<OfficeDocumentSemanticReadResult> {
  let conversion: LegacyOfficeDocumentConversion | undefined
  let sourceSnapshot: OfficeDocumentSnapshot | undefined
  try {
    const filePath = target.path.trim()
    const sourceFormat = allowLegacy
      ? officeDocumentPreviewFormatFromName(filePath)
      : officeDocumentFormatFromName(filePath)
    if (!filePath || !sourceFormat) {
      return {
        ok: false,
        code: 'unsupported_type',
        message: allowLegacy
          ? 'Expected a .doc, .docx, .xls, .xlsx, .ppt, or .pptx file.'
          : 'Expected a .docx, .xlsx, or .pptx file.'
      }
    }
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      return { ok: false, code: 'not_a_file', message: 'Office document path is not a regular file.' }
    }
    if (fileStat.size <= 0) {
      return { ok: false, code: 'empty_file', message: 'Office document is empty.' }
    }
    if (fileStat.size > MAX_RUNTIME_DOCUMENT_SOURCE_BYTES) {
      return {
        ok: false,
        code: 'file_too_large',
        message: `Office document exceeds the ${MAX_RUNTIME_DOCUMENT_SOURCE_BYTES} byte attachment limit.`
      }
    }
    const source = await readFile(filePath)
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    sourceSnapshot = await createOfficeDocumentSnapshot(source, sourceFormat)
    let renderPath = sourceSnapshot.path
    let renderFormat: OfficeDocumentFormat
    if (isLegacyOfficeDocumentFormat(sourceFormat)) {
      const legacyDependencies: LegacyOfficeDocumentConversionDependencies = {
        resolveLibreOfficeBinary: dependencies.resolveLibreOfficeBinary,
        runLibreOffice: dependencies.runLibreOffice,
        temporaryDirectory: dependencies.temporaryDirectory,
        signal: dependencies.signal
      }
      conversion = await (dependencies.convertLegacyDocument ?? convertLegacyOfficeDocument)(
        renderPath,
        sourceFormat,
        legacyDependencies
      )
      renderPath = conversion.path
      renderFormat = conversion.format
    } else {
      renderFormat = sourceFormat
    }
    await assertOoxmlPackageType(renderPath, renderFormat)
    const run = dependencies.runOfficeCli ??
      ((args) => runOfficeCli(
        dependencies.binaryPath || 'officecli',
        args,
        dependencies.signal
      ))

    const validation = await run(['validate', renderPath, '--json'])
    let validationWarning: string | undefined
    if (validation.exitCode !== 0) {
      if (!isBenignOoxmlSchemaFailure(validation)) {
        assertOfficeCliSuccess(validation, 'Office document validation failed')
      }
      // Vendor extensions (notably WPS etCustomData attrs) fail strict OpenXML
      // schema checks but still extract cleanly. Keep intake open and surface a
      // warning instead of forcing a local tool-reference fallback (#1122).
      validationWarning = summarizeOfficeCliFailure(validation, 'Office document validation warning')
    }

    const semanticArgs = semanticViewArgs(renderPath, renderFormat)
    const semantic = await run(semanticArgs)
    assertOfficeCliSuccess(semantic, 'Office document text extraction failed')
    const rawText = semantic.stdout.trim()
    if (!rawText) throw new Error('OfficeCLI returned no semantic document content.')
    const truncated = rawText.length > MAX_RUNTIME_DOCUMENT_TEXT_CHARS
    const documentText = truncated
      ? rawText.slice(0, MAX_RUNTIME_DOCUMENT_TEXT_CHARS)
      : rawText

    const statsResult = await run(['view', renderPath, 'stats', '--json']).catch(() => null)
    const pageCount = statsResult?.exitCode === 0
      ? extractPageCount(statsResult.stdout, renderFormat)
      : undefined

    const selectedPage = renderFormat !== 'xlsx' && previewSelection.page
      ? pageCount ? Math.min(pageCount, previewSelection.page) : previewSelection.page
      : undefined
    let sanitizedHtml: string | undefined
    let sheetNames: string[] | undefined
    let selectedSheetIndex: number | undefined
    let htmlPreviewFailure: string | undefined
    try {
      const htmlResult = await run(officeHtmlViewArgs(renderPath, renderFormat, selectedPage))
      assertOfficeCliSuccess(htmlResult, 'Office document HTML preview failed')
      sanitizedHtml = sanitizeOfficeDocumentHtml(htmlResult.stdout)
      if (renderFormat === 'xlsx') {
        sheetNames = extractOfficeDocumentSheetNames(sanitizedHtml)
        if (previewSelection.sheetIndex !== undefined && sheetNames.length > 0) {
          selectedSheetIndex = Math.max(0, Math.min(previewSelection.sheetIndex, sheetNames.length - 1))
          sanitizedHtml = selectOfficeDocumentSheet(sanitizedHtml, selectedSheetIndex)
        }
      }
    } catch (error) {
      htmlPreviewFailure = boundedErrorMessage(error)
    }

    let visualPreview: OfficeDocumentVisualPreview | undefined
    let previewUnavailableReason: string | undefined
    try {
      visualPreview = dependencies.renderHtml
        ? undefined
        : await readCachedOfficePreview(sourceSha256, selectedPage, selectedSheetIndex)
      if (!visualPreview && sanitizedHtml) {
        visualPreview = await (dependencies.renderHtml ?? renderOfficeHtmlPreview)(sanitizedHtml)
        if (!dependencies.renderHtml) {
          await writeCachedOfficePreview(sourceSha256, visualPreview, selectedPage, selectedSheetIndex)
        }
      }
    } catch (error) {
      previewUnavailableReason = boundedErrorMessage(error)
    }
    if (!visualPreview && htmlPreviewFailure && !previewUnavailableReason) {
      previewUnavailableReason = htmlPreviewFailure
    }

    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      format: sourceFormat,
      mimeType: officeDocumentPreviewMimeType(sourceFormat),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      sourceSha256,
      documentText,
      ...(pageCount ? { pageCount } : {}),
      ...(sheetNames?.length ? { sheetNames } : {}),
      ...(selectedPage || selectedSheetIndex !== undefined
        ? { previewSelection: {
            ...(selectedPage ? { page: selectedPage } : {}),
            ...(selectedSheetIndex !== undefined ? { sheetIndex: selectedSheetIndex } : {})
          } }
        : {}),
      truncated,
      ...(sanitizedHtml ? { sanitizedHtml } : {}),
      ...(visualPreview ? { visualPreview } : {}),
      ...(previewUnavailableReason ? { previewUnavailableReason } : {}),
      ...(conversion ? { convertedFromLegacy: true as const } : {}),
      ...(validationWarning ? { validationWarning } : {})
    }
  } catch (error) {
    return {
      ok: false,
      code: error instanceof OfficeDocumentConversionError ? error.code : 'office_document_failed',
      message: boundedErrorMessage(error)
    }
  } finally {
    await conversion?.cleanup().catch(() => undefined)
    await sourceSnapshot?.cleanup().catch(() => undefined)
  }
}

function semanticViewArgs(filePath: string, format: OfficeDocumentFormat): string[] {
  if (format === 'docx') return ['view', filePath, 'annotated']
  if (format === 'xlsx') return ['view', filePath, 'text', '--max-lines', '4000']
  return ['view', filePath, 'outline']
}

export async function extractOfficeDocumentSemanticText(
  filePath: string,
  format: OfficeDocumentFormat,
  options: {
    binaryPath: string
    signal?: AbortSignal
    runOfficeCli?: (args: string[]) => Promise<OfficeCliResult>
  }
): Promise<string> {
  const result = options.runOfficeCli
    ? await options.runOfficeCli(semanticViewArgs(filePath, format))
    : await runOfficeCli(options.binaryPath, semanticViewArgs(filePath, format), options.signal)
  assertOfficeCliSuccess(result, 'Office document text extraction failed')
  const text = result.stdout.trim()
  if (!text) throw new Error('OfficeCLI returned no semantic document content.')
  return text
}

function officeHtmlViewArgs(
  filePath: string,
  format: OfficeDocumentFormat,
  page?: number
): string[] {
  const args = ['view', filePath, 'html']
  if (!page || format === 'xlsx') return args
  return [...args, '--page', String(page)]
}

function assertOfficeCliSuccess(result: OfficeCliResult, fallback: string): void {
  if (result.exitCode === 0) return
  throw new Error(summarizeOfficeCliFailure(result, fallback))
}

function summarizeOfficeCliFailure(result: OfficeCliResult, fallback: string): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  return detail ? `${fallback}: ${detail}` : fallback
}

/**
 * Intake-only: strict OpenXML schema rejects common vendor extensions (WPS
 * etCustomData attributes, undeclared Ignorable attrs). Those documents still
 * yield usable text via `view`. Reject anything that is not a Schema / undeclared
 * markup failure so corrupted packages stay blocked.
 */
export function isBenignOoxmlSchemaFailure(result: OfficeCliResult): boolean {
  if (result.exitCode === 0) return false
  const payload = result.stdout.trim() || result.stderr.trim()
  if (!payload) return false
  const errors = extractOfficeValidateErrors(payload)
  if (!errors || errors.length === 0) {
    // Fallback when officecli prints a flat message without --json structure.
    return /not declared|undeclared|schema/i.test(payload) &&
      /wps\.cn|etCustomData|officeDocument\/2017/i.test(payload)
  }
  return errors.every((error) => isBenignOoxmlSchemaError(error))
}

function extractOfficeValidateErrors(payload: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const root = parsed as Record<string, unknown>
    const data = root.data && typeof root.data === 'object'
      ? root.data as Record<string, unknown>
      : root
    const errors = data.errors
    if (!Array.isArray(errors)) return null
    return errors.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object'
    )
  } catch {
    return null
  }
}

function isBenignOoxmlSchemaError(error: Record<string, unknown>): boolean {
  const type = typeof error.type === 'string' ? error.type : ''
  const description = typeof error.description === 'string' ? error.description : ''
  const combined = `${type} ${description}`
  if (!/schema/i.test(type) && !/schema/i.test(description)) return false
  return /not declared|undeclared|wps\.cn|etCustomData|officeDocument\/2017/i.test(combined)
}

export async function runOfficeCli(
  binaryPath: string,
  args: string[],
  signal?: AbortSignal
): Promise<OfficeCliResult> {
  if (signal?.aborted) throw abortError()
  const release = await acquireOfficeCliProcessSlot()
  const profileDir = join(app.getPath('userData'), 'runtime', 'officecli-profile')
  try {
    await mkdir(profileDir, { recursive: true, mode: 0o700 })
    return await new Promise<OfficeCliResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(binaryPath, args, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: officeCliEnvironment(profileDir)
        })
      } catch (error) {
        reject(error)
        return
      }
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let settled = false
      let timeout: NodeJS.Timeout | undefined
      const finish = (result: () => void): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        result()
      }
      const onAbort = (): void => {
        child.kill()
        finish(() => reject(abortError()))
      }
      const append = (
        current: Buffer<ArrayBufferLike>,
        chunk: Buffer<ArrayBufferLike>
      ): Buffer<ArrayBufferLike> => {
        if (current.length + chunk.length > OFFICECLI_MAX_OUTPUT_BYTES) {
          child.kill()
          finish(() => reject(new Error(`OfficeCLI output exceeds ${OFFICECLI_MAX_OUTPUT_BYTES} bytes.`)))
          return current
        }
        return Buffer.concat([current, chunk])
      }
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('close', (code) => finish(() => resolve({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode: code ?? 1
      })))
      signal?.addEventListener('abort', onAbort, { once: true })
      timeout = setTimeout(() => {
        child.kill()
        finish(() => reject(new Error(`OfficeCLI timed out after ${OFFICECLI_TIMEOUT_MS}ms.`)))
      }, OFFICECLI_TIMEOUT_MS)
    })
  } finally {
    release()
  }
}

function abortError(): Error {
  const error = new Error('OfficeCLI operation was cancelled.')
  error.name = 'AbortError'
  return error
}

async function acquireOfficeCliProcessSlot(): Promise<() => void> {
  if (activeOfficeCliProcesses >= OFFICECLI_MAX_CONCURRENCY) {
    await new Promise<void>((resolveWaiter) => officeCliProcessWaiters.push(resolveWaiter))
  }
  activeOfficeCliProcesses += 1
  return () => {
    activeOfficeCliProcesses = Math.max(0, activeOfficeCliProcesses - 1)
    officeCliProcessWaiters.shift()?.()
  }
}

function officeCliEnvironment(profileDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OFFICECLI_SKIP_UPDATE: '1',
    OFFICECLI_NO_AUTO_INSTALL: '1',
    OFFICECLI_NO_AUTO_RESIDENT: '1',
    OFFICECLI_RESIDENT_FLUSH: 'each',
    HOME: profileDir,
    USERPROFILE: profileDir,
    APPDATA: profileDir,
    LOCALAPPDATA: profileDir,
    XDG_CONFIG_HOME: profileDir
  }
}

export async function renderOfficeHtmlPreview(html: string): Promise<OfficeDocumentVisualPreview> {
  const previewRoot = join(tmpdir(), 'kun-office-preview')
  const previewId = randomUUID()
  const htmlPath = join(previewRoot, `${previewId}.html`)
  const sanitizedHtml = officeDocumentPreviewSrcDoc(sanitizeOfficeDocumentHtml(html))
  await mkdir(previewRoot, { recursive: true, mode: 0o700 })
  await writeFile(htmlPath, sanitizedHtml, { encoding: 'utf8', mode: 0o600 })
  const previewUrl = pathToFileURL(htmlPath).toString()
  const previewWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 960,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      partition: `office-preview-${previewId}`
    }
  })
  try {
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    previewWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    previewWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url === previewUrl ||
        (details.resourceType === 'image' && isSafeOfficeDocumentDataImage(details.url))
      callback({ cancel: !allowed })
    })
    await previewWindow.loadFile(htmlPath)
    previewWindow.webContents.on('will-navigate', (event) => event.preventDefault())
    const dimensions = await previewWindow.webContents.executeJavaScript(`
      Promise.resolve(document.fonts && document.fonts.ready).then(() => ({
        width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
      }))
    `) as { width?: number; height?: number }
    const width = Math.max(320, Math.min(VISUAL_PREVIEW_MAX_DIMENSION, Math.ceil(dimensions.width || 1280)))
    const height = Math.max(240, Math.min(VISUAL_PREVIEW_MAX_DIMENSION, Math.ceil(dimensions.height || 960)))
    previewWindow.setContentSize(width, height)
    const image = await previewWindow.webContents.capturePage()
    const prepared = await encodePreviewWithinLimit(image.toPNG(), width, height)
    return prepared
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
    await rm(htmlPath, { force: true }).catch(() => undefined)
  }
}

async function encodePreviewWithinLimit(
  png: Buffer,
  sourceWidth: number,
  sourceHeight: number
): Promise<OfficeDocumentVisualPreview> {
  let dimension = Math.min(VISUAL_PREVIEW_MAX_DIMENSION, Math.max(sourceWidth, sourceHeight))
  for (;;) {
    for (const quality of [82, 74, 66, 58, 50, 42, 34]) {
      const encoded = await sharp(png)
        .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true })
      if (encoded.data.length <= VISUAL_PREVIEW_MAX_BYTES) {
        return {
          dataBase64: encoded.data.toString('base64'),
          mimeType: 'image/webp',
          byteSize: encoded.data.length,
          width: encoded.info.width,
          height: encoded.info.height,
          wasCompressed: true
        }
      }
    }
    if (dimension <= 320) break
    dimension = Math.max(320, Math.floor(dimension * 0.8))
  }
  throw new Error(`Office preview exceeds ${VISUAL_PREVIEW_MAX_BYTES} bytes after compression.`)
}

async function readCachedOfficePreview(
  sourceSha256: string,
  page?: number,
  sheetIndex?: number
): Promise<OfficeDocumentVisualPreview | undefined> {
  const cachePath = officePreviewCachePath(sourceSha256, page, sheetIndex)
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as OfficeDocumentVisualPreview
    if (
      (parsed.mimeType !== 'image/png' && parsed.mimeType !== 'image/webp') ||
      typeof parsed.dataBase64 !== 'string' ||
      typeof parsed.byteSize !== 'number' ||
      parsed.byteSize <= 0 ||
      parsed.byteSize > VISUAL_PREVIEW_MAX_BYTES ||
      Buffer.byteLength(parsed.dataBase64, 'base64') !== parsed.byteSize
    ) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

async function writeCachedOfficePreview(
  sourceSha256: string,
  preview: OfficeDocumentVisualPreview,
  page?: number,
  sheetIndex?: number
): Promise<void> {
  const cachePath = officePreviewCachePath(sourceSha256, page, sheetIndex)
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`
  try {
    await mkdir(join(app.getPath('userData'), 'cache', 'office-preview'), {
      recursive: true,
      mode: 0o700
    })
    await writeFile(temporaryPath, JSON.stringify(preview), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, cachePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function officePreviewCachePath(sourceSha256: string, page?: number, sheetIndex?: number): string {
  const selection = page || sheetIndex !== undefined
    ? `-p${page ?? 0}-s${sheetIndex ?? 0}`
    : ''
  return join(
    app.getPath('userData'),
    'cache',
    'office-preview',
    `${sourceSha256}${selection}-${OFFICECLI_VERSION}.json`
  )
}

function extractPageCount(raw: string, format: OfficeDocumentFormat): number | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    const preferredKeys = format === 'pptx'
      ? ['slides', 'slideCount', 'slide_count']
      : format === 'xlsx'
        ? ['sheets', 'sheetCount', 'sheet_count']
        : ['pages', 'pageCount', 'page_count']
    const found = findPositiveInteger(parsed, new Set(preferredKeys.map((key) => key.toLowerCase())))
    if (found) return found
  } catch {
    // Fall through to the bounded text pattern.
  }
  const label = format === 'pptx' ? 'slides?' : format === 'xlsx' ? 'sheets?' : 'pages?'
  const match = new RegExp(`${label}\\s*[:=]\\s*(\\d+)`, 'i').exec(raw)
  const count = match ? Number.parseInt(match[1] ?? '', 10) : 0
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

function findPositiveInteger(value: unknown, keys: Set<string>, depth = 0): number | undefined {
  if (depth > 5 || !value || typeof value !== 'object') return undefined
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key.toLowerCase()) && typeof item === 'number' && Number.isSafeInteger(item) && item > 0) {
      return item
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = findPositiveInteger(item, keys, depth + 1)
    if (found) return found
  }
  return undefined
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message
}
