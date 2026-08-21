import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type {
  WorkspaceSpreadsheetConvertResult,
  WorkspaceSpreadsheetMutation,
  WorkspaceSpreadsheetSaveResult
} from '../../shared/workspace-spreadsheet'
import { MAX_RUNTIME_DOCUMENT_SOURCE_BYTES } from '../../shared/office-document'
import { assertOoxmlPackageType } from './office-document-ooxml'
import {
  convertLegacyOfficeDocument,
  OfficeDocumentConversionError,
  type LegacyOfficeDocumentConversionDependencies
} from './office-document-legacy'
import {
  runOfficeCli,
  type OfficeCliResult
} from './office-document-service'

type FileIdentity = {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
  nlink: bigint
}

export type WorkspaceSpreadsheetServiceDependencies = {
  binaryPath?: string
  signal?: AbortSignal
  runOfficeCli?: (args: string[]) => Promise<OfficeCliResult>
  beforeReplace?: () => Promise<void> | void
  convertLegacyDocument?: typeof convertLegacyOfficeDocument
  logSave?: (entry: WorkspaceSpreadsheetSaveDiagnostic) => void
} & Pick<
  LegacyOfficeDocumentConversionDependencies,
  'resolveLibreOfficeBinary' | 'runLibreOffice' | 'temporaryDirectory'
>

export type WorkspaceSpreadsheetSaveDiagnostic = {
  stage: 'preflight' | 'batch' | 'validation' | 'replace' | 'complete'
  status: 'succeeded' | 'failed'
  fileName: string
  mutationCount: number
  expectedSha256Prefix: string
  currentSha256Prefix?: string
  code?: Extract<WorkspaceSpreadsheetSaveResult, { ok: false }>['code']
}

export async function saveWorkspaceSpreadsheet(
  input: {
    path: string
    expectedSha256: string
    mutations: WorkspaceSpreadsheetMutation[]
  },
  dependencies: WorkspaceSpreadsheetServiceDependencies = {}
): Promise<WorkspaceSpreadsheetSaveResult> {
  const filePath = input.path.trim()
  let stage: WorkspaceSpreadsheetSaveDiagnostic['stage'] = 'preflight'
  const logSave = (
    status: WorkspaceSpreadsheetSaveDiagnostic['status'],
    code?: Extract<WorkspaceSpreadsheetSaveResult, { ok: false }>['code'],
    currentSha256?: string
  ): void => dependencies.logSave?.({
    stage,
    status,
    fileName: basename(filePath),
    mutationCount: input.mutations.length,
    expectedSha256Prefix: input.expectedSha256.slice(0, 12).toLowerCase(),
    ...(currentSha256 ? { currentSha256Prefix: currentSha256.slice(0, 12) } : {}),
    ...(code ? { code } : {})
  })
  if (extname(filePath).toLowerCase() !== '.xlsx') {
    logSave('failed', 'unsupported_type')
    return failure('unsupported_type', 'Editable spreadsheet saves require an .xlsx file.')
  }
  if (!dependencies.binaryPath && !dependencies.runOfficeCli) {
    logSave('failed', 'officecli_unavailable')
    return failure('officecli_unavailable', 'Spreadsheet saving is unavailable because OfficeCLI was not found.')
  }

  const extension = extname(filePath)
  const stem = basename(filePath, extension)
  const temporaryPath = join(dirname(filePath), `.${stem}.kun-sheet-${randomUUID()}${extension}`)
  const commandPath = join(dirname(filePath), `.${stem}.kun-sheet-${randomUUID()}.json`)
  try {
    const identity = await captureIdentity(filePath)
    assertSupportedSourceSize(identity)
    const beforeSha256 = await sha256File(filePath)
    if (beforeSha256 !== input.expectedSha256.toLowerCase()) {
      logSave('failed', 'source_changed', beforeSha256)
      return failure('source_changed', 'The spreadsheet changed after it was opened. Reload it before saving.')
    }
    const commands = spreadsheetMutationsToOfficeCliBatch(input.mutations)
    await copyFile(filePath, temporaryPath, constants.COPYFILE_EXCL)
    await writeFile(commandPath, JSON.stringify(commands), { encoding: 'utf8', mode: 0o600, flag: 'wx' })

    const run = dependencies.runOfficeCli ?? ((args: string[]) =>
      runOfficeCli(dependencies.binaryPath!, args, dependencies.signal))
    stage = 'batch'
    const batch = await run(['batch', temporaryPath, '--input', commandPath, '--json'])
    assertOfficeCliSuccess(batch, 'Spreadsheet edit batch failed')
    await assertOoxmlPackageType(temporaryPath, 'xlsx')
    stage = 'validation'
    const validation = await run(['validate', temporaryPath, '--json'])
    assertOfficeCliSuccess(validation, 'Edited spreadsheet failed OpenXML validation')
    await dependencies.beforeReplace?.()
    await assertIdentityUnchanged(filePath, identity)
    const currentSha256 = await sha256File(filePath)
    if (currentSha256 !== beforeSha256) {
      return failure('source_changed', 'The spreadsheet changed while the save was being prepared.')
    }

    stage = 'replace'
    await rename(temporaryPath, filePath)
    const saved = await stat(filePath)
    const sourceSha256 = await sha256File(filePath)
    stage = 'complete'
    logSave('succeeded', undefined, sourceSha256)
    return {
      ok: true,
      path: filePath,
      sourceSha256,
      size: saved.size,
      mtimeMs: saved.mtimeMs,
      appliedMutations: input.mutations.length
    }
  } catch (error) {
    const code = isSourceChangeError(error) ? 'source_changed' : 'mutation_failed'
    logSave('failed', code)
    return failure(code, errorMessage(error))
  } finally {
    await Promise.all([
      rm(temporaryPath, { force: true }).catch(() => undefined),
      rm(commandPath, { force: true }).catch(() => undefined)
    ])
  }
}

export async function convertWorkspaceSpreadsheet(
  input: { path: string; expectedSha256: string },
  dependencies: WorkspaceSpreadsheetServiceDependencies = {}
): Promise<WorkspaceSpreadsheetConvertResult> {
  const sourcePath = input.path.trim()
  if (extname(sourcePath).toLowerCase() !== '.xls') {
    return conversionFailure('unsupported_type', 'Only legacy .xls files require conversion.')
  }
  let cleanup: (() => Promise<void>) | undefined
  try {
    const identity = await captureIdentity(sourcePath)
    assertSupportedSourceSize(identity)
    if (await sha256File(sourcePath) !== input.expectedSha256.toLowerCase()) {
      return conversionFailure('source_changed', 'The XLS file changed after it was opened. Reload it before converting.')
    }
    const converted = await (dependencies.convertLegacyDocument ?? convertLegacyOfficeDocument)(
      sourcePath,
      'xls',
      {
        resolveLibreOfficeBinary: dependencies.resolveLibreOfficeBinary,
        runLibreOffice: dependencies.runLibreOffice,
        temporaryDirectory: dependencies.temporaryDirectory,
        signal: dependencies.signal
      }
    )
    cleanup = converted.cleanup
    await assertOoxmlPackageType(converted.path, 'xlsx')
    await assertIdentityUnchanged(sourcePath, identity)
    const targetPath = await publishConvertedWorkbook(converted.path, sourcePath)
    const targetStat = await stat(targetPath)
    return {
      ok: true,
      path: targetPath,
      name: basename(targetPath),
      sourceSha256: await sha256File(targetPath),
      size: targetStat.size,
      mtimeMs: targetStat.mtimeMs
    }
  } catch (error) {
    if (error instanceof OfficeDocumentConversionError) {
      return conversionFailure(
        error.code === 'libreoffice_unavailable' ? 'libreoffice_unavailable' : 'conversion_failed',
        error.message
      )
    }
    return conversionFailure(
      isSourceChangeError(error) ? 'source_changed' : 'conversion_failed',
      errorMessage(error)
    )
  } finally {
    await cleanup?.().catch(() => undefined)
  }
}

export function spreadsheetMutationsToOfficeCliBatch(
  mutations: WorkspaceSpreadsheetMutation[]
): Array<Record<string, unknown>> {
  return mutations.map((mutation) => {
    const sheetPath = `/${mutation.sheetName}`
    if (mutation.kind === 'merge') {
      const anchor = mutation.range.split(':')[0]
      return {
        command: 'set',
        path: `${sheetPath}/${anchor}`,
        props: { merge: mutation.merged ? mutation.range : false }
      }
    }
    if (mutation.kind === 'row' || mutation.kind === 'column') {
      const path = mutation.kind === 'row'
        ? `${sheetPath}/row[${mutation.index}]`
        : `${sheetPath}/col[${columnLabel(mutation.index - 1)}]`
      return {
        command: 'set',
        path,
        props: {
          ...(Object.prototype.hasOwnProperty.call(mutation, 'size')
            ? { [mutation.kind === 'row' ? 'height' : 'width']: mutation.size ?? defaultDimensionSize(mutation.kind) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(mutation, 'hidden')
            ? { hidden: mutation.hidden ?? false }
            : {})
        }
      }
    }
    if (mutation.kind !== 'cell') throw new Error(`Unsupported spreadsheet mutation: ${mutation.kind}`)
    const props: Record<string, string | number | boolean | null> = {}
    const hasValue = Object.prototype.hasOwnProperty.call(mutation, 'value')
    const hasFormula = Object.prototype.hasOwnProperty.call(mutation, 'formula')
    if (hasValue || hasFormula) props.clear = true
    if (hasFormula && mutation.formula) props.formula = mutation.formula.replace(/^=/, '')
    if (hasValue && mutation.value !== null && mutation.value !== undefined) {
      props.value = mutation.value
      props.type = typeof mutation.value === 'string'
        ? 'string'
        : typeof mutation.value === 'number'
          ? 'number'
          : 'boolean'
    }
    Object.assign(props, styleToOfficeCliProps(mutation.style))
    return { command: 'set', path: `${sheetPath}/${mutation.address}`, props }
  })
}

function styleToOfficeCliProps(
  style: Extract<WorkspaceSpreadsheetMutation, { kind: 'cell' }>['style']
): Record<string, string | number | boolean> {
  if (!style) return {}
  const props: Record<string, string | number | boolean> = {}
  assignNullable(props, 'font.name', style, 'fontFamily', 'Calibri')
  assignNullable(props, 'font.size', style, 'fontSize', 11)
  assignNullable(props, 'font.bold', style, 'bold', false)
  assignNullable(props, 'font.italic', style, 'italic', false)
  assignNullable(props, 'underline', style, 'underline', 'none')
  assignNullable(props, 'strike', style, 'strike', false)
  assignNullable(props, 'font.color', style, 'fontColor', '000000')
  assignNullable(props, 'fill', style, 'fillColor', 'FFFFFF')
  assignNullable(props, 'alignment.horizontal', style, 'horizontalAlignment', 'left')
  assignNullable(props, 'alignment.vertical', style, 'verticalAlignment', 'bottom')
  assignNullable(props, 'alignment.wrapText', style, 'wrap', false)
  assignNullable(props, 'numberformat', style, 'numberFormat', 'General')
  assignNullable(props, 'alignment.textRotation', style, 'textRotation', 0)
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (!style.borders || !Object.prototype.hasOwnProperty.call(style.borders, side)) continue
    const border = style.borders[side]
    props[`border.${side}`] = border?.style ?? 'none'
    if (border?.color) props[`border.${side}.color`] = border.color
  }
  return props
}

function assignNullable<
  Source extends Record<string, unknown>,
  Key extends keyof Source
>(
  target: Record<string, string | number | boolean>,
  targetKey: string,
  source: Source,
  sourceKey: Key,
  fallback: string | number | boolean
): void {
  if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) return
  const value = source[sourceKey]
  target[targetKey] = value == null ? fallback : value as string | number | boolean
}

async function publishConvertedWorkbook(convertedPath: string, sourcePath: string): Promise<string> {
  const directory = dirname(sourcePath)
  const stem = basename(sourcePath, extname(sourcePath))
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const name = suffix === 0 ? `${stem}.xlsx` : `${stem} converted${suffix === 1 ? '' : ` ${suffix}`}.xlsx`
    const targetPath = join(directory, name)
    try {
      await copyFile(convertedPath, targetPath, constants.COPYFILE_EXCL)
      return targetPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('Could not allocate a collision-safe XLSX file name.')
}

async function captureIdentity(path: string): Promise<FileIdentity> {
  const info = await lstat(path, { bigint: true })
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1n || info.ino === 0n) {
    throw new Error('Spreadsheet target must be one regular, non-linked file.')
  }
  return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, nlink: info.nlink }
}

function assertSupportedSourceSize(identity: FileIdentity): void {
  if (identity.size <= 0n) throw new Error('Spreadsheet is empty.')
  if (identity.size > BigInt(MAX_RUNTIME_DOCUMENT_SOURCE_BYTES)) {
    throw new Error(`Spreadsheet exceeds the ${MAX_RUNTIME_DOCUMENT_SOURCE_BYTES} byte limit.`)
  }
}

async function assertIdentityUnchanged(path: string, expected: FileIdentity): Promise<void> {
  const current = await captureIdentity(path)
  if (
    current.dev !== expected.dev || current.ino !== expected.ino ||
    current.size !== expected.size || current.mtimeNs !== expected.mtimeNs ||
    current.nlink !== expected.nlink
  ) throw new Error('Spreadsheet source identity changed during the operation.')
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function assertOfficeCliSuccess(result: OfficeCliResult, fallback: string): void {
  if (result.exitCode === 0) return
  const detail = result.stderr.trim() || result.stdout.trim()
  throw new Error(detail ? `${fallback}: ${detail}` : fallback)
}

function columnLabel(index: number): string {
  let value = index + 1
  let output = ''
  while (value > 0) {
    value -= 1
    output = String.fromCharCode(65 + value % 26) + output
    value = Math.floor(value / 26)
  }
  return output
}

function defaultDimensionSize(kind: 'row' | 'column'): number {
  return kind === 'row' ? 15 : 8.43
}

function isSourceChangeError(error: unknown): boolean {
  return /identity changed|source.*changed|changed during/i.test(errorMessage(error))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(
  code: Extract<WorkspaceSpreadsheetSaveResult, { ok: false }>['code'],
  message: string
): Extract<WorkspaceSpreadsheetSaveResult, { ok: false }> {
  return { ok: false, code, message }
}

function conversionFailure(
  code: Extract<WorkspaceSpreadsheetConvertResult, { ok: false }>['code'],
  message: string
): Extract<WorkspaceSpreadsheetConvertResult, { ok: false }> {
  return { ok: false, code, message }
}
