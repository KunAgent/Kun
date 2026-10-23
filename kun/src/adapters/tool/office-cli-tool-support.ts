import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, stat } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { resolvePathThroughSymlinks, sameFilesystemPath } from './workspace-path.js'
import { repairPptxPresentationChildOrder } from './office-pptx-presentation-order.js'

export const OFFICECLI_MAX_OPERATIONS = 200
const OFFICECLI_FORMATS = new Set(['.docx', '.xlsx', '.pptx'])

export type OfficeCliRunResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type OfficeEditOperation = {
  type: 'set' | 'add' | 'remove' | 'move' | 'swap' | 'replace_text'
  target?: string
  parent?: string
  destination?: string
  with?: string
  elementType?: string
  props?: Record<string, string | number | boolean | null>
  before?: string
  after?: string
  find?: string
  replace?: string
  regex?: boolean
}

export type FileIdentity = {
  device: bigint
  inode: bigint
  size: bigint
  mtimeNs: bigint
  links: bigint
  parentDevice: bigint
  parentInode: bigint
  physicalPath: string
}

export function parseOfficeEditOperations(value: unknown): OfficeEditOperation[] {
  if (!Array.isArray(value) || value.length > OFFICECLI_MAX_OPERATIONS) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const type = stringArgument(record.type)
    if (!isOfficeEditOperationType(type)) return []
    const props = scalarRecord(record.props)
    return [{
      type,
      target: optionalString(record.target),
      parent: optionalString(record.parent),
      destination: optionalString(record.destination),
      with: optionalString(record.with),
      elementType: optionalString(record.elementType),
      ...(props ? { props } : {}),
      before: optionalString(record.before),
      after: optionalString(record.after),
      find: optionalRawString(record.find),
      replace: optionalRawString(record.replace),
      ...(typeof record.regex === 'boolean' ? { regex: record.regex } : {})
    }]
  })
}

export function inspectCommand(
  filePath: string,
  action: 'summary' | 'text' | 'outline' | 'query' | 'issues' | 'validate',
  target: string,
  maxLines: number
): string[] {
  if (action === 'validate') return ['validate', filePath, '--json']
  if (action === 'query') {
    if (!target) throw new Error('query inspection requires target')
    return ['query', filePath, target, '--json']
  }
  if (action === 'issues') return ['view', filePath, 'issues', '--json']
  if (action === 'summary') return ['view', filePath, 'stats', '--json']
  if (action === 'text') return ['view', filePath, 'text', '--max-lines', String(maxLines)]
  return ['view', filePath, 'outline']
}

export function officeFormat(filePath: string): 'docx' | 'xlsx' | 'pptx' {
  const extension = extname(filePath).toLowerCase()
  if (!OFFICECLI_FORMATS.has(extension)) {
    throw new Error('Office tools support existing .docx, .xlsx, and .pptx files only.')
  }
  return extension.slice(1) as 'docx' | 'xlsx' | 'pptx'
}

export async function captureFileIdentity(filePath: string): Promise<FileIdentity> {
  const lexical = resolve(filePath)
  const linkInfo = await lstat(lexical, { bigint: true })
  if (linkInfo.isSymbolicLink()) throw new Error('Office edits do not follow symbolic links.')
  if (!linkInfo.isFile()) throw new Error('Office edit target is not a regular file.')
  if (linkInfo.nlink !== 1n) throw new Error('Office edit target must have exactly one hard link.')
  if (linkInfo.ino === 0n) throw new Error('Office edit target has no stable inode identity.')
  const physicalPath = await resolvePathThroughSymlinks(lexical)
  const parent = await stat(dirname(lexical), { bigint: true })
  if (!parent.isDirectory() || parent.ino === 0n) {
    throw new Error('Office edit target parent has no stable directory identity.')
  }
  return {
    device: linkInfo.dev,
    inode: linkInfo.ino,
    size: linkInfo.size,
    mtimeNs: linkInfo.mtimeNs,
    links: linkInfo.nlink,
    parentDevice: parent.dev,
    parentInode: parent.ino,
    physicalPath
  }
}

export async function assertFileIdentityUnchanged(filePath: string, expected: FileIdentity): Promise<void> {
  const current = await captureFileIdentity(filePath)
  if (
    current.device !== expected.device ||
    current.inode !== expected.inode ||
    current.size !== expected.size ||
    current.mtimeNs !== expected.mtimeNs ||
    current.links !== expected.links ||
    current.parentDevice !== expected.parentDevice ||
    current.parentInode !== expected.parentInode ||
    !sameFilesystemPath(current.physicalPath, expected.physicalPath)
  ) {
    throw new Error('Office document identity or parent directory changed while editing.')
  }
}

export function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    const onAbort = (): void => {
      stream.destroy(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      rejectHash(error)
    })
    stream.once('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolveHash(hash.digest('hex'))
    })
  })
}

export function officeCliEnvironment(profileDir: string): NodeJS.ProcessEnv {
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

export function assertOfficeCliSuccess(result: OfficeCliRunResult, fallback: string): void {
  if (result.exitCode === 0) return
  const detail = result.stderr.trim() || result.stdout.trim()
  throw new Error(detail ? `${fallback}: ${detail}` : fallback)
}

export function parseOfficeCliOutput(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function scalarRecord(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const output: Record<string, string | number | boolean | null> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean' &&
      item !== null
    ) {
      return undefined
    }
    output[key] = item
  }
  return output
}

export function stringArgument(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  const text = stringArgument(value)
  return text || undefined
}

function optionalRawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function integerArgument(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined
}

export function isInspectAction(
  value: string
): value is 'summary' | 'text' | 'outline' | 'query' | 'issues' | 'validate' {
  return ['summary', 'text', 'outline', 'query', 'issues', 'validate'].includes(value)
}

function isOfficeEditOperationType(value: string): value is OfficeEditOperation['type'] {
  return ['set', 'add', 'remove', 'move', 'swap', 'replace_text'].includes(value)
}

export function abortError(): Error {
  const error = new Error('OfficeCLI operation aborted.')
  error.name = 'AbortError'
  return error
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `officecli validate` reports failures in its JSON payload; older builds still
 * exit non-zero, but the payload is the contract that must not be ignored.
 */
export function assertOfficeCliValidationSuccess(
  result: OfficeCliRunResult,
  fallback: string
): void {
  assertOfficeCliSuccess(result, fallback)
  const parsed = parseOfficeCliOutput(result.stdout)
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as Record<string, unknown>).success === false
  ) {
    throw new Error(`${fallback}: ${officeCliFailureDetail(result)}`)
  }
}

export function officeCliFailureDetail(result: OfficeCliRunResult): string {
  const messages = officeCliDiagnosticMessages(parseOfficeCliOutput(result.stdout))
  if (messages.length > 0) return messages.join(' | ')
  return truncateDetail(result.stderr.trim() || result.stdout.trim()) || 'no diagnostic output'
}

const MAX_DIAGNOSTIC_MESSAGES = 5
const MAX_DIAGNOSTIC_CHARS = 400
const MAX_DIAGNOSTIC_FIELD_CHARS = 200

/**
 * OfficeCLI reports the same failure shape in two places depending on the
 * build: top-level `warnings` (older) and `data.errors` (current). Both are
 * bounded here so a large validation report cannot flood the tool result.
 */
function officeCliDiagnosticMessages(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const messages: string[] = []
  const push = (item: unknown): void => {
    if (messages.length >= MAX_DIAGNOSTIC_MESSAGES) return
    if (typeof item === 'string') {
      const text = truncateDetail(item)
      if (text) messages.push(text)
      return
    }
    if (!item || typeof item !== 'object') return
    const entry = item as Record<string, unknown>
    const text = truncateDetail(
      [entry.message, entry.description, entry.path, entry.part]
        .filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
        // Each field is clipped before joining so a long description cannot
        // push the part and path - the actionable part of the report - out.
        .map((field) => truncateDetail(field, MAX_DIAGNOSTIC_FIELD_CHARS))
        .join(' ')
    )
    if (text) messages.push(text)
  }
  push(record.message)
  const sources = [record, record.data]
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['warnings', 'errors']) {
      const list = (source as Record<string, unknown>)[key]
      if (Array.isArray(list)) list.forEach(push)
    }
  }
  return messages
}

function truncateDetail(value: string, limit = MAX_DIAGNOSTIC_CHARS): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

/**
 * Repairs known, schema-only defects that block every edit of an existing deck.
 * Unknown structures stay untouched and fail the edit instead of being guessed.
 */
export async function repairOfficeSourceStructure(
  filePath: string,
  format: 'docx' | 'xlsx' | 'pptx'
): Promise<string[]> {
  if (format !== 'pptx') return []
  try {
    const repairs = await repairPptxPresentationChildOrder(filePath)
    return repairs.map((repair) => `${repair.action} in ${repair.part}`)
  } catch (error) {
    throw new Error(
      `Office source document has an unsupported structure and was not edited: ${errorMessage(error)}`
    )
  }
}

export function boundedLogValue(value: string): string {
  return value.replace(/\s+/g, '_').slice(0, 160) || 'unknown'
}
