import {
  ExtensionApiError,
  type JsonObject,
  type WorkspaceApi
} from '@kun/extension-api'
import {
  MAX_OPERATION_RECEIPTS,
  MAX_PRESENTATION_HTML_BYTES,
  MAX_PRESENTATION_OPERATIONS,
  PresentationOperationError,
  applyPresentationOperations,
  createPresentationProject,
  digestStableValue,
  digestUtf8Text,
  parsePresentationHtml,
  serializePresentationHtml,
  stableStringify,
  validatePresentationProject,
  type PresentationOperation,
  type PresentationProject,
  type PresentationValidationIssue
} from '../shared/presentation.js'

const MAX_OPERATION_BATCH_BYTES = 256_000
const PRESENTATION_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.kun-ppt\.html$/

export interface ServiceProgress {
  readonly message: string
  readonly fraction: number
}

export interface ServiceControl {
  readonly isCancellationRequested?: () => boolean
  readonly reportProgress?: (progress: ServiceProgress) => void | Promise<void>
}

export interface PresentationReadResult {
  readonly path: string
  readonly project: PresentationProject
  readonly htmlBytes: number
  readonly contentSha256: string
}

export interface PresentationApplyResult extends PresentationReadResult {
  readonly resultingRevision: number
  readonly currentRevision: number
  readonly changedIds: string[]
  readonly warnings: PresentationValidationIssue[]
  readonly idempotentReplay: boolean
}

export interface PresentationExportResult {
  readonly sourcePath: string
  readonly destinationPath: string
  readonly revision: number
  readonly bytes: number
  readonly contentSha256: string
  readonly idempotentReplay: boolean
}

interface RawPresentationFile {
  readonly path: string
  readonly content: string
  readonly htmlBytes: number
}

type WritePrecondition =
  | { readonly kind: 'absent' }
  | { readonly kind: 'content'; readonly html: string }

export class PresentationProjectService {
  readonly #queues = new Map<string, Promise<void>>()

  constructor(private readonly workspace: WorkspaceApi) {}

  async create(
    input: { path: string; title?: string },
    control?: ServiceControl
  ): Promise<PresentationReadResult> {
    const path = validatePresentationPath(input.path)
    const title = validateTitle(input.title ?? titleFromPath(path))
    return this.#enqueue(path, async () => {
      await this.#checkpoint(control, 'Checking the destination path', 0.1)
      if (await this.#readOptional(path)) {
        throw conflict(`Presentation already exists: ${path}`, { path })
      }
      const digest = await digestStableValue({ path })
      const project = createPresentationProject({
        id: `deck-${digest.slice(0, 16)}`,
        title,
        firstSlideId: 'slide-1'
      })
      const html = serializePresentationHtml(project)
      await this.#writeAndVerify(path, html, project, { kind: 'absent' }, control)
      return {
        path,
        project,
        htmlBytes: byteLength(html),
        contentSha256: await digestUtf8Text(html)
      }
    })
  }

  async read(pathInput: string, control?: ServiceControl): Promise<PresentationReadResult> {
    const path = validatePresentationPath(pathInput)
    return this.#enqueue(path, async () => {
      await this.#checkpoint(control, `Reading ${path}`, 0.2)
      const loaded = await this.#readRequired(path)
      await this.#report(control, 'Presentation loaded', 1)
      return loaded
    })
  }

  async apply(
    input: {
      path: string
      expectedRevision: number
      operations: PresentationOperation[]
      operationId?: string
    },
    control?: ServiceControl
  ): Promise<PresentationApplyResult> {
    const path = validatePresentationPath(input.path)
    const expectedRevision = validateRevision(input.expectedRevision)
    const operations = validateOperations(input.operations)
    const operationId = input.operationId === undefined
      ? undefined
      : validateOperationId(input.operationId)
    const digest = operationId === undefined
      ? undefined
      : await digestStableValue({ expectedRevision, operations })

    return this.#enqueue(path, async () => {
      await this.#checkpoint(control, `Reading revision ${expectedRevision}`, 0.1)
      const current = await this.#readRequired(path)
      if (operationId && digest) {
        const receipt = current.project.operationReceipts.find(
          (candidate) => candidate.operationId === operationId
        )
        if (receipt) {
          if (receipt.digest !== digest) {
            throw conflict(`operationId ${operationId} was already used with a different payload`, {
              path,
              operationId,
              recordedRevision: receipt.resultingRevision
            })
          }
          await this.#report(control, 'Previously committed operation replayed', 1)
          return {
            ...current,
            resultingRevision: receipt.resultingRevision,
            currentRevision: current.project.revision,
            changedIds: [],
            warnings: validatePresentationProject(current.project).warnings,
            idempotentReplay: true
          }
        }
      }
      assertExpectedRevision(path, current.project.revision, expectedRevision)
      await this.#checkpoint(control, 'Applying typed presentation operations', 0.35)
      let applied: ReturnType<typeof applyPresentationOperations>
      try {
        applied = applyPresentationOperations(current.project, operations)
      } catch (error) {
        const operationIndex = error instanceof PresentationOperationError
          ? error.operationIndex
          : -1
        throw validationFailure('Presentation operations could not be applied', [{
          code: 'operation_failed',
          path: operationIndex >= 0 ? `$operations[${operationIndex}]` : '$operations',
          message: error instanceof Error ? error.message.slice(0, 4096) : 'Operation batch failed'
        }])
      }
      const resultingRevision = current.project.revision + 1
      const receipts = operationId && digest
        ? [
            ...applied.project.operationReceipts,
            { operationId, digest, resultingRevision }
          ].slice(-MAX_OPERATION_RECEIPTS)
        : applied.project.operationReceipts
      const nextProject: PresentationProject = {
        ...applied.project,
        revision: resultingRevision,
        operationReceipts: receipts
      }
      const validation = validatePresentationProject(nextProject)
      if (!validation.ok || !validation.project) {
        throw validationFailure('Operation batch produced an invalid presentation', validation.errors)
      }
      let html: string
      try {
        html = serializePresentationHtml(validation.project)
      } catch (error) {
        throw validationFailure(
          'Operation batch cannot be rendered within presentation limits',
          issuesFrom(error, 'render_failed', '$html', 'Presentation could not be rendered')
        )
      }
      await this.#writeAndVerify(
        path,
        html,
        validation.project,
        { kind: 'content', html: serializePresentationHtml(current.project) },
        control
      )
      return {
        path,
        project: validation.project,
        htmlBytes: byteLength(html),
        contentSha256: await digestUtf8Text(html),
        resultingRevision,
        currentRevision: resultingRevision,
        changedIds: applied.changedIds,
        warnings: validation.warnings,
        idempotentReplay: false
      }
    })
  }

  async validate(pathInput: string, control?: ServiceControl): Promise<{
    path: string
    revision: number | null
    valid: boolean
    errors: PresentationValidationIssue[]
    warnings: PresentationValidationIssue[]
  }> {
    const path = validatePresentationPath(pathInput)
    return this.#enqueue(path, async () => {
      await this.#checkpoint(control, `Validating ${path}`, 0.2)
      const raw = await this.#readRawRequired(path)
      let project: PresentationProject
      try {
        project = parsePresentationHtml(raw.content)
      } catch (error) {
        await this.#report(control, 'Presentation validation completed', 1)
        return {
          path,
          revision: null,
          valid: false,
          errors: issuesFrom(error, 'invalid_presentation', '$html', 'Presentation model could not be parsed'),
          warnings: []
        }
      }
      let canonical: string
      try {
        canonical = serializePresentationHtml(project)
      } catch (error) {
        await this.#report(control, 'Presentation validation completed', 1)
        return {
          path,
          revision: project.revision,
          valid: false,
          errors: issuesFrom(error, 'render_failed', '$html', 'Presentation could not be rendered'),
          warnings: []
        }
      }
      if (raw.content !== canonical) {
        await this.#report(control, 'Presentation validation completed', 1)
        return {
          path,
          revision: project.revision,
          valid: false,
          errors: [nonCanonicalHtmlIssue()],
          warnings: []
        }
      }
      const result = validatePresentationProject(project)
      await this.#report(control, 'Presentation validation completed', 1)
      return {
        path,
        revision: project.revision,
        valid: result.ok,
        errors: result.errors,
        warnings: result.warnings
      }
    })
  }

  async exportCopy(
    input: { path: string; destinationPath: string; expectedRevision: number },
    control?: ServiceControl
  ): Promise<PresentationExportResult> {
    const path = validatePresentationPath(input.path)
    const destinationPath = validatePresentationPath(input.destinationPath)
    const expectedRevision = validateRevision(input.expectedRevision)
    if (path.toLowerCase() === destinationPath.toLowerCase()) {
      throw invalidArgument('Export destination must differ from the source path', { path })
    }
    return this.#enqueueMany([path, destinationPath], async () => {
      await this.#checkpoint(control, `Reading ${path}`, 0.1)
      const source = await this.#readRequired(path)
      assertExpectedRevision(path, source.project.revision, expectedRevision)
      const sourceHtml = serializePresentationHtml(source.project)
      const contentSha256 = await digestUtf8Text(sourceHtml)
      const existing = await this.#readOptional(destinationPath)
      if (existing) {
        const existingHtml = serializePresentationHtml(existing.project)
        if (existingHtml !== sourceHtml) {
          throw conflict(`Export destination already contains a different presentation: ${destinationPath}`, {
            path: destinationPath
          })
        }
        await this.#report(control, 'Existing identical export verified', 1)
        return {
          sourcePath: path,
          destinationPath,
          revision: source.project.revision,
          bytes: byteLength(sourceHtml),
          contentSha256,
          idempotentReplay: true
        }
      }
      const sourceBeforeWrite = await this.#readRequired(path)
      if (serializePresentationHtml(sourceBeforeWrite.project) !== sourceHtml) {
        throw conflict(`Presentation changed before export: ${path}`, { path })
      }
      await this.#writeAndVerify(
        destinationPath,
        sourceHtml,
        source.project,
        { kind: 'absent' },
        control
      )
      return {
        sourcePath: path,
        destinationPath,
        revision: source.project.revision,
        bytes: byteLength(sourceHtml),
        contentSha256,
        idempotentReplay: false
      }
    })
  }

  async #readRequired(path: string): Promise<PresentationReadResult> {
    const result = await this.#readOptional(path)
    if (!result) {
      throw new ExtensionApiError({
        code: 'NOT_FOUND',
        message: `Presentation was not found: ${path}`,
        operation: 'presentation.read',
        retryable: false,
        details: { path }
      })
    }
    return result
  }

  async #readOptional(path: string): Promise<PresentationReadResult | undefined> {
    const raw = await this.#readRawOptional(path)
    if (!raw) return undefined
    try {
      const project = parsePresentationHtml(raw.content)
      if (raw.content !== serializePresentationHtml(project)) {
        throw validationFailure(
          `Presentation HTML is not the canonical safe projection: ${path}`,
          [nonCanonicalHtmlIssue()]
        )
      }
      return {
        path,
        project,
        htmlBytes: raw.htmlBytes,
        contentSha256: await digestUtf8Text(raw.content)
      }
    } catch (error) {
      if (error instanceof ExtensionApiError) throw error
      throw validationFailure(
        `Presentation is not a valid .kun-ppt.html file: ${path}`,
        issuesFrom(error, 'invalid_presentation', '$html', 'Presentation model could not be parsed')
      )
    }
  }

  async #readRawRequired(path: string): Promise<RawPresentationFile> {
    const result = await this.#readRawOptional(path)
    if (!result) {
      throw new ExtensionApiError({
        code: 'NOT_FOUND',
        message: `Presentation was not found: ${path}`,
        operation: 'presentation.read',
        retryable: false,
        details: { path }
      })
    }
    return result
  }

  async #readRawOptional(path: string): Promise<RawPresentationFile | undefined> {
    let info: JsonObject
    try {
      info = await this.workspace.stat(path)
    } catch {
      const entries = await this.workspace.list('.')
      const foldedPath = path.toLowerCase()
      const aliases = entries.filter((candidate) =>
        entryName(candidate).toLowerCase() === foldedPath
      )
      if (aliases.length > 0) {
        throw conflict(`Presentation path could not be resolved without an ambiguous case alias: ${path}`, {
          path,
          aliases: aliases.slice(0, 8).map(entryName)
        })
      }
      // The public broker caps list results at 10,000. A failed exact stat plus
      // a saturated listing cannot prove that a create-only destination is free.
      if (entries.length >= 10_000) {
        throw conflict('Workspace root listing reached its limit; file absence cannot be verified', {
          path,
          entryCount: entries.length
        })
      }
      return undefined
    }
    if (info.type !== 'file') {
      throw validationFailure(`Presentation path is not a regular file: ${path}`)
    }

    // Serialize case aliases through the same queue and fail closed when the
    // broker exposes an alias in the bounded root listing.
    const entries = await this.workspace.list('.')
    const foldedPath = path.toLowerCase()
    const exactEntry = entries.find((candidate) => entryName(candidate) === path)
    if (!exactEntry) {
      throw conflict(`Workspace listing could not verify the exact presentation entry: ${path}`, {
        path,
        entryCount: entries.length
      })
    }
    if (exactEntry.type !== 'file') {
      throw validationFailure(`Presentation path must be a regular non-symlink file: ${path}`)
    }
    const alias = entries.find((candidate) => {
      const name = entryName(candidate)
      return name !== path && name.toLowerCase() === foldedPath
    })
    if (alias) {
      throw conflict(`Presentation path differs only by case from an existing entry: ${path}`, {
        path,
        existingPath: entryName(alias)
      })
    }

    const file = await this.workspace.readFile(path, 'utf8')
    if (file.encoding !== 'utf8') {
      throw validationFailure(`Presentation must be UTF-8 text: ${path}`)
    }
    const htmlBytes = byteLength(file.content)
    assertHtmlSize(path, htmlBytes)
    return { path, content: file.content, htmlBytes }
  }

  async #writeAndVerify(
    path: string,
    html: string,
    project: PresentationProject,
    precondition: WritePrecondition,
    control?: ServiceControl
  ): Promise<void> {
    const bytes = byteLength(html)
    assertHtmlSize(path, bytes)
    await this.#checkpoint(control, `Rechecking ${path} before persistence`, 0.65)
    if (precondition.kind === 'absent') {
      if (await this.#readRawOptional(path)) {
        throw conflict(`Presentation appeared before it could be created: ${path}`, { path })
      }
    } else {
      const current = await this.#readRawRequired(path)
      if (current.content !== precondition.html) {
        throw conflict(`Presentation changed before it could be saved: ${path}`, { path })
      }
    }
    await this.#checkpoint(control, `Writing ${path}`, 0.75)
    await this.workspace.writeFile({ path, content: html, encoding: 'utf8' })
    // Once the write starts, verification is a commit-critical section. A late
    // cancellation must not turn a durable mutation into an ambiguous failure.
    const verified = await this.workspace.readFile(path, 'utf8')
    if (verified.encoding !== 'utf8' || verified.content !== html) {
      throw unknownWriteOutcome(`Post-write verification failed for ${path}`, {
        path,
        expectedBytes: bytes
      })
    }
    let verifiedProject: PresentationProject
    try {
      verifiedProject = parsePresentationHtml(verified.content)
    } catch (error) {
      throw unknownWriteOutcome(
        `Written presentation could not be parsed: ${path}`,
        {
          path,
          issues: issuesFrom(error, 'invalid_presentation', '$html', 'Written model could not be parsed')
        }
      )
    }
    if (stableStringify(verifiedProject) !== stableStringify(project)) {
      throw unknownWriteOutcome(`Post-write model verification failed for ${path}`, { path })
    }
    await this.#report(control, 'Write verified', 1)
  }

  async #checkpoint(
    control: ServiceControl | undefined,
    message: string,
    fraction: number
  ): Promise<void> {
    if (control?.isCancellationRequested?.()) {
      throw new ExtensionApiError({
        code: 'CANCELLED',
        message: 'Presentation operation was cancelled before persistence',
        operation: 'presentation.workspace',
        retryable: false
      })
    }
    await this.#report(control, message, fraction)
  }

  async #report(
    control: ServiceControl | undefined,
    message: string,
    fraction: number
  ): Promise<void> {
    try {
      await control?.reportProgress?.({ message, fraction })
    } catch {
      // Progress transport is advisory and cannot invalidate workspace state.
    }
  }

  #enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
    const queueKey = path.toLowerCase()
    const previous = this.#queues.get(queueKey) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(task)
    const tail = result.then(() => undefined, () => undefined)
    this.#queues.set(queueKey, tail)
    return result.finally(() => {
      if (this.#queues.get(queueKey) === tail) this.#queues.delete(queueKey)
    })
  }

  #enqueueMany<T>(paths: string[], task: () => Promise<T>): Promise<T> {
    const unique = [...new Set(paths.map((path) => path.toLowerCase()))].sort()
    const acquire = (index: number): Promise<T> =>
      index >= unique.length
        ? task()
        : this.#enqueue(unique[index], () => acquire(index + 1))
    return acquire(0)
  }
}

export function validatePresentationPath(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 240 ||
    !PRESENTATION_PATH_PATTERN.test(value)
  ) {
    throw invalidArgument(
      'Presentation path must be one root-level ASCII filename ending in .kun-ppt.html',
      { path: typeof value === 'string' ? value.slice(0, 240) : '' }
    )
  }
  return value
}

function validateTitle(value: string): string {
  // eslint-disable-next-line no-control-regex -- explicit rejection of unsafe ASCII controls
  if (value.trim().length === 0 || value.length > 160 || /[\u0000-\u001F]/.test(value)) {
    throw invalidArgument('Presentation title must contain 1 to 160 printable characters')
  }
  return value
}

function validateRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidArgument('expectedRevision must be a positive safe integer')
  }
  return value
}

function validateOperationId(value: string): string {
  // eslint-disable-next-line no-control-regex -- explicit rejection of unsafe ASCII controls
  if (value.trim().length === 0 || value.length > 128 || /[\u0000-\u001F]/.test(value)) {
    throw invalidArgument('operationId must contain 1 to 128 printable characters')
  }
  return value
}

function validateOperations(value: PresentationOperation[]): PresentationOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PRESENTATION_OPERATIONS) {
    throw invalidArgument(`operations must contain 1 to ${MAX_PRESENTATION_OPERATIONS} entries`)
  }
  let bytes: number
  try {
    bytes = byteLength(stableStringify(value))
  } catch {
    throw invalidArgument('operations must be bounded JSON values')
  }
  if (bytes > MAX_OPERATION_BATCH_BYTES) {
    throw new ExtensionApiError({
      code: 'RESOURCE_LIMIT',
      message: `Operation batch exceeds ${MAX_OPERATION_BATCH_BYTES} bytes`,
      operation: 'presentation.apply',
      retryable: false,
      details: { bytes, limit: MAX_OPERATION_BATCH_BYTES }
    })
  }
  return value
}

function assertExpectedRevision(path: string, actual: number, expected: number): void {
  if (actual === expected) return
  throw conflict(
    `Revision conflict for ${path}: expected revision ${expected}, current revision is ${actual}`,
    { path, expectedRevision: expected, currentRevision: actual }
  )
}

function assertHtmlSize(path: string, bytes: number): void {
  if (bytes <= MAX_PRESENTATION_HTML_BYTES) return
  throw new ExtensionApiError({
    code: 'RESOURCE_LIMIT',
    message: `Presentation ${path} exceeds ${MAX_PRESENTATION_HTML_BYTES} bytes`,
    operation: 'presentation.workspace',
    retryable: false,
    details: { path, bytes, limit: MAX_PRESENTATION_HTML_BYTES }
  })
}

function titleFromPath(path: string): string {
  return path.slice(0, -'.kun-ppt.html'.length).replaceAll(/[-_]+/g, ' ').trim() || 'Untitled presentation'
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function issuesFrom(
  error: unknown,
  fallbackCode: string,
  fallbackPath: string,
  fallbackMessage: string
): PresentationValidationIssue[] {
  if (
    typeof error === 'object' && error !== null &&
    'issues' in error && Array.isArray((error as { issues?: unknown }).issues)
  ) {
    const issues = (error as { issues: PresentationValidationIssue[] }).issues.slice(0, 1024)
    if (issues.length > 0) return issues
  }
  return [{ code: fallbackCode, path: fallbackPath, message: fallbackMessage }]
}

function entryName(entry: JsonObject): string {
  const value = entry.name ?? entry.path
  return typeof value === 'string' ? value : ''
}

function nonCanonicalHtmlIssue(): PresentationValidationIssue {
  return {
    code: 'non_canonical_html',
    path: '$html',
    message: 'HTML outside the embedded model must match the deterministic script-free projection'
  }
}

function invalidArgument(message: string, details?: JsonObject): ExtensionApiError {
  return new ExtensionApiError({
    code: 'INVALID_ARGUMENT',
    message,
    operation: 'presentation.input',
    retryable: false,
    ...(details ? { details } : {})
  })
}

function conflict(message: string, details?: JsonObject): ExtensionApiError {
  return new ExtensionApiError({
    code: 'CONFLICT',
    message,
    operation: 'presentation.workspace',
    retryable: true,
    ...(details ? { details } : {})
  })
}

function validationFailure(
  message: string,
  issues: PresentationValidationIssue[] = []
): ExtensionApiError {
  return new ExtensionApiError({
    code: 'VALIDATION_FAILED',
    message,
    operation: 'presentation.parse',
    retryable: false,
    details: { issues: issues.slice(0, 1024) }
  })
}

function unknownWriteOutcome(message: string, details: JsonObject): ExtensionApiError {
  return new ExtensionApiError({
    code: 'INTERNAL_ERROR',
    message,
    operation: 'presentation.workspace.write.verify',
    retryable: false,
    details
  })
}
