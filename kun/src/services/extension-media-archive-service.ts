import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import {
  MediaArchiveJobResultSchema,
  type MediaArchiveJobResult,
  type ParsedMediaStartArchiveJobRequest
} from '@kun/extension-api'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaHandleError,
  ExtensionMediaHandleService,
  fileIdentityFromStat,
  identifiesSameFile,
  matchesFileIdentity,
  type CompletedMediaOutputRecovery,
  type MediaHandleProjection,
  type MediaOutputCompletionTransaction,
  type PendingMediaOutputTransaction,
  type ResolvedMediaHandle
} from './extension-media-handle-service.js'

const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')
const DEFAULT_MAX_INPUT_BYTES = 100 * 1024 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024 * 1024

export type ExtensionMediaArchiveOutputTransaction = {
  result: MediaArchiveJobResult
  commit(): Promise<void>
  rollback(): Promise<void>
}

type PreparedArchive = {
  request: ParsedMediaStartArchiveJobRequest
  inputs: Array<
    | { kind: 'media'; archivePath: string; source: ResolvedMediaHandle; byteSize: number }
    | { kind: 'inline-text'; archivePath: string; content: Buffer; byteSize: number }
  >
  inputBytes: number
  output: ResolvedMediaHandle
  stagingDirectory: string
  stagingPath: string
  backupPath: string
}

type PromotedArchive = PreparedArchive & { hadTarget: boolean; promoted: boolean }

export class ExtensionMediaArchiveError extends Error {
  constructor(
    readonly code:
      | 'permission_denied'
      | 'invalid_argument'
      | 'output_alias'
      | 'output_limit'
      | 'invalid_output',
    message: string
  ) {
    super(message)
  }
}

/**
 * Core-only deterministic ZIP writer. Public extensions supply opaque media
 * handles and virtual archive paths; absolute source/output paths never cross
 * the broker boundary. Promotion and handle completion remain reversible until
 * the durable job wins its terminal commit fence.
 */
export class ExtensionMediaArchiveService {
  private readonly maxInputBytes: number
  private readonly maxArchiveBytes: number

  constructor(private readonly options: {
    handles: ExtensionMediaHandleService
    maxInputBytes?: number
    maxArchiveBytes?: number
  }) {
    this.maxInputBytes = boundedBytes(options.maxInputBytes, DEFAULT_MAX_INPUT_BYTES)
    this.maxArchiveBytes = boundedBytes(options.maxArchiveBytes, DEFAULT_MAX_ARCHIVE_BYTES)
  }

  async preflight(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest
  ): Promise<void> {
    requirePermissions(principal)
    const inputs = await this.resolveInputs(principal, request)
    const output = await this.options.handles.resolve(principal, request.outputHandleId, 'write')
    assertOutputMime(output)
    assertNoAlias(inputs.flatMap((entry) => entry.kind === 'media' ? [entry.source] : []), output)
  }

  async executeTransaction(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest,
    operationId: string,
    options: {
      signal?: AbortSignal
      report?(completed: number, total: number, message: string): Promise<void>
    } = {}
  ): Promise<ExtensionMediaArchiveOutputTransaction> {
    requirePermissions(principal)
    options.signal?.throwIfAborted()
    const prepared = await this.prepare(principal, request, operationId)
    let promotion: PromotedArchive | undefined
    let completion: MediaOutputCompletionTransaction | undefined
    try {
      await options.report?.(0, prepared.inputs.length + 2, 'Writing deterministic project package')
      await writeArchive(prepared, this.maxArchiveBytes, options.signal, async (completed) => {
        await options.report?.(
          completed,
          prepared.inputs.length + 2,
          `Archived ${completed} of ${prepared.inputs.length} entries`
        )
      })
      options.signal?.throwIfAborted()
      await validateArchive(prepared)
      const archiveInfo = await stat(prepared.stagingPath)
      if (archiveInfo.size <= 0 || archiveInfo.size > this.maxArchiveBytes) {
        throw new ExtensionMediaArchiveError('output_limit', 'Project package exceeded its byte limit')
      }
      const sha256 = await sha256File(prepared.stagingPath, options.signal)
      await options.report?.(
        prepared.inputs.length + 1,
        prepared.inputs.length + 2,
        'Promoting project package atomically'
      )
      promotion = await promoteArchive(prepared)
      completion = await this.options.handles.completeOutputsReversibly(
        principal,
        [{ handleId: request.outputHandleId, reservationId: operationId }],
        { signal: options.signal }
      )
      const generated = completion.generatedMedia[0]!
      const result = MediaArchiveJobResultSchema.parse({
        schemaVersion: 1,
        format: 'zip',
        entryCount: prepared.inputs.length,
        inputBytes: prepared.inputBytes,
        archiveBytes: archiveInfo.size,
        sha256,
        generatedMedia: publicMediaMetadata(generated)
      })
      await options.report?.(
        prepared.inputs.length + 2,
        prepared.inputs.length + 2,
        'Project package ready'
      )
      return archiveTransaction({
        principal,
        operationId,
        prepared,
        promotion,
        completion,
        handles: this.options.handles,
        result
      })
    } catch (error) {
      const cleanupErrors: unknown[] = []
      if (promotion) {
        try { await rollbackPromotion(promotion) } catch (cleanupError) { cleanupErrors.push(cleanupError) }
      }
      if (completion) {
        try { await completion.rollback() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
      }
      try { await cleanupPrepared(prepared) } catch (cleanupError) { cleanupErrors.push(cleanupError) }
      try {
        await this.options.handles.releaseOutputReservation(
          principal,
          request.outputHandleId,
          operationId
        )
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length > 0) {
        throw new ExtensionMediaArchiveError(
          'invalid_output',
          'Project package failed and its output transaction could not be rolled back safely'
        )
      }
      throw error
    }
  }

  async rollbackInterruptedTransaction(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest,
    operationId: string
  ): Promise<void> {
    requirePermissions(principal)
    let state: PendingMediaOutputTransaction
    try {
      state = await this.options.handles.inspectOutputTransaction(
        principal,
        request.outputHandleId,
        operationId
      )
    } catch (error) {
      if (error instanceof ExtensionMediaHandleError &&
        (error.code === 'handle_reserved' || error.code === 'not_found')) return
      throw error
    }
    const paths = transactionPaths(state.absolutePath, operationId, request.outputHandleId)
    await rollbackInterruptedOutput({ state, ...paths })
    await this.options.handles.rollbackOutputTransaction(
      principal,
      [request.outputHandleId],
      operationId
    )
  }

  async commitRecoveredTransaction(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest,
    operationId: string
  ): Promise<void> {
    requirePermissions(principal)
    let pending: PendingMediaOutputTransaction | undefined
    let completed: CompletedMediaOutputRecovery
    try {
      pending = await this.options.handles.inspectOutputTransaction(
        principal,
        request.outputHandleId,
        operationId
      )
      if (!pending.completed || !pending.completedIdentity) {
        throw new ExtensionMediaArchiveError(
          'invalid_output',
          'Completed archive job retained an unfinished output transaction'
        )
      }
      completed = {
        handleId: request.outputHandleId,
        absolutePath: pending.absolutePath,
        completedIdentity: pending.completedIdentity
      }
    } catch (error) {
      if (!(error instanceof ExtensionMediaHandleError) ||
        (error.code !== 'handle_reserved' && error.code !== 'not_found')) throw error
      try {
        completed = await this.options.handles.inspectCompletedOutput(principal, request.outputHandleId)
      } catch (completedError) {
        if (completedError instanceof ExtensionMediaHandleError &&
          (completedError.code === 'handle_consumed' || completedError.code === 'not_found')) return
        throw completedError
      }
    }
    const paths = transactionPaths(completed.absolutePath, operationId, request.outputHandleId)
    await commitRecoveredOutput({ completed, pending, ...paths })
    if (pending) {
      await this.options.handles.commitOutputTransaction(
        principal,
        [request.outputHandleId],
        operationId
      )
    }
  }

  private async prepare(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest,
    operationId: string
  ): Promise<PreparedArchive> {
    const inputs = await this.resolveInputs(principal, request)
    const inputBytes = inputs.reduce((total, entry) => total + entry.byteSize, 0)
    if (inputBytes > this.maxInputBytes) {
      throw new ExtensionMediaArchiveError('output_limit', 'Project package inputs exceed the byte limit')
    }
    const output = await this.options.handles.reserveOutput(
      principal,
      request.outputHandleId,
      operationId
    )
    try {
      assertOutputMime(output)
      assertNoAlias(inputs.flatMap((entry) => entry.kind === 'media' ? [entry.source] : []), output)
      const paths = transactionPaths(output.absolutePath, operationId, request.outputHandleId)
      await mkdir(paths.stagingDirectory, { mode: 0o700 })
      return {
        request,
        inputs,
        inputBytes,
        output,
        ...paths,
        stagingPath: join(paths.stagingDirectory, 'project-package.zip')
      }
    } catch (error) {
      await this.options.handles.releaseOutputReservation(
        principal,
        request.outputHandleId,
        operationId
      )
      throw error
    }
  }

  private async resolveInputs(
    principal: ExtensionPrincipal,
    request: ParsedMediaStartArchiveJobRequest
  ): Promise<PreparedArchive['inputs']> {
    const inputs: PreparedArchive['inputs'] = []
    for (const entry of [...request.entries].sort((left, right) =>
      left.archivePath.localeCompare(right.archivePath)
    )) {
      if (entry.kind === 'inline-text') {
        const content = Buffer.from(entry.content, 'utf8')
        inputs.push({
          kind: 'inline-text',
          archivePath: entry.archivePath,
          content,
          byteSize: content.byteLength
        })
        continue
      }
      const source = await this.options.handles.resolve(principal, entry.inputHandleId, 'read')
      const info = await lstat(source.absolutePath)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new ExtensionMediaArchiveError(
          'invalid_argument',
          'Archive media inputs must be regular files'
        )
      }
      inputs.push({ kind: 'media', archivePath: entry.archivePath, source, byteSize: info.size })
    }
    return inputs
  }
}

async function writeArchive(
  prepared: PreparedArchive,
  maxArchiveBytes: number,
  signal: AbortSignal | undefined,
  report: (completed: number) => Promise<void>
): Promise<void> {
  const zip = new yazl.ZipFile()
  let completed = 0
  for (const entry of prepared.inputs) {
    signal?.throwIfAborted()
    if (entry.kind === 'media') {
      zip.addFile(entry.source.absolutePath, entry.archivePath, {
        mtime: FIXED_ZIP_TIME,
        mode: 0o100644,
        compress: false
      })
    } else {
      zip.addBuffer(entry.content, entry.archivePath, {
        mtime: FIXED_ZIP_TIME,
        mode: 0o100644,
        compress: true
      })
    }
    completed += 1
    await report(completed)
  }
  zip.end()
  const output = createWriteStream(prepared.stagingPath, { flags: 'wx', mode: 0o600 })
  await pipeline(zip.outputStream, output, { signal })
  const info = await stat(prepared.stagingPath)
  if (info.size <= 0 || info.size > maxArchiveBytes) {
    throw new ExtensionMediaArchiveError('output_limit', 'Project package exceeded its byte limit')
  }
}

async function validateArchive(prepared: PreparedArchive): Promise<void> {
  const expected = prepared.inputs.map(({ archivePath }) => archivePath)
  const archive = await yauzl.openPromise(prepared.stagingPath, {
    autoClose: false,
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  })
  try {
    const observed: string[] = []
    for await (const entry of archive.eachEntry()) {
      if (/\/$/u.test(entry.fileName)) {
        throw new ExtensionMediaArchiveError('invalid_output', 'Project package contains a directory entry')
      }
      observed.push(entry.fileName)
    }
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Project package entries differ from the admitted manifest'
      )
    }
  } finally {
    archive.close()
  }
}

async function promoteArchive(prepared: PreparedArchive): Promise<PromotedArchive> {
  const promoted: PromotedArchive = { ...prepared, hadTarget: false, promoted: false }
  try {
    const target = await lstat(prepared.output.absolutePath)
    if (!target.isFile() || target.isSymbolicLink() || !prepared.output.identity ||
      !sameIdentity(target, prepared.output.identity)) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Project package target changed before atomic promotion'
      )
    }
    await rename(prepared.output.absolutePath, prepared.backupPath)
    promoted.hadTarget = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (prepared.output.identity) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Project package target disappeared before atomic promotion'
      )
    }
  }
  try {
    await rename(prepared.stagingPath, prepared.output.absolutePath)
    promoted.promoted = true
    return promoted
  } catch (error) {
    await rollbackPromotion(promoted)
    throw error
  }
}

function archiveTransaction(input: {
  principal: ExtensionPrincipal
  operationId: string
  prepared: PreparedArchive
  promotion: PromotedArchive
  completion: MediaOutputCompletionTransaction
  handles: ExtensionMediaHandleService
  result: MediaArchiveJobResult
}): ExtensionMediaArchiveOutputTransaction {
  let state: 'pending' | 'committed' | 'rolled-back' = 'pending'
  let transition = Promise.resolve()
  const serialize = async (
    target: 'committed' | 'rolled-back',
    operation: () => Promise<void>
  ): Promise<void> => {
    const prior = transition
    let release!: () => void
    transition = new Promise<void>((resolve) => { release = resolve })
    await prior
    try {
      if (state === target) return
      if (state !== 'pending') {
        throw new ExtensionMediaArchiveError(
          'invalid_output',
          'Project package transaction already reached another terminal state'
        )
      }
      await operation()
      state = target
    } finally {
      release()
    }
  }
  return {
    result: input.result,
    commit: () => serialize('committed', async () => {
      await input.completion.commit()
      await rm(input.prepared.backupPath, { force: true }).catch(() => undefined)
      await rm(input.prepared.stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    }),
    rollback: () => serialize('rolled-back', async () => {
      await rollbackPromotion(input.promotion)
      await input.completion.rollback()
      await cleanupPrepared(input.prepared)
      await input.handles.releaseOutputReservation(
        input.principal,
        input.prepared.request.outputHandleId,
        input.operationId
      )
    })
  }
}

async function rollbackPromotion(output: PromotedArchive): Promise<void> {
  if (output.promoted) {
    await rm(output.output.absolutePath, { force: true })
    output.promoted = false
  }
  if (output.hadTarget) {
    await rename(output.backupPath, output.output.absolutePath)
    output.hadTarget = false
  }
}

async function cleanupPrepared(prepared: PreparedArchive): Promise<void> {
  await rm(prepared.stagingDirectory, { recursive: true, force: true })
}

function transactionPaths(
  absolutePath: string,
  operationId: string,
  handleId: string
): { stagingDirectory: string; backupPath: string } {
  const token = createHash('sha256')
    .update('kun-media-archive\0', 'utf8')
    .update(operationId, 'utf8')
    .update('\0', 'utf8')
    .update(handleId, 'utf8')
    .digest('hex')
    .slice(0, 32)
  return {
    stagingDirectory: join(dirname(absolutePath), `.kun-archive-${token}.kun-stage`),
    backupPath: join(dirname(absolutePath), `.${basename(absolutePath)}.${token}.kun-backup`)
  }
}

async function rollbackInterruptedOutput(output: {
  state: PendingMediaOutputTransaction
  stagingDirectory: string
  backupPath: string
}): Promise<void> {
  const backup = await lstatIfPresent(output.backupPath)
  const target = await lstatIfPresent(output.state.absolutePath)
  if (backup) {
    if (!output.state.hadTarget || !backup.isFile() || backup.isSymbolicLink() ||
      !output.state.originalIdentity || !sameStatIdentity(backup, output.state.originalIdentity)) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Interrupted project package backup could not be authenticated'
      )
    }
    if (target) {
      if (!target.isFile() || target.isSymbolicLink()) {
        throw new ExtensionMediaArchiveError(
          'invalid_output',
          'Interrupted project package target could not be restored safely'
        )
      }
      await rm(output.state.absolutePath)
    }
    await rename(output.backupPath, output.state.absolutePath)
  } else if (output.state.hadTarget) {
    if (!target || !target.isFile() || target.isSymbolicLink() ||
      !output.state.originalIdentity || !sameStatIdentity(target, output.state.originalIdentity)) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Interrupted project package lost its authenticated prior target'
      )
    }
  } else if (target) {
    if (!target.isFile() || target.isSymbolicLink() ||
      (output.state.completedIdentity && !sameStatIdentity(target, output.state.completedIdentity))) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Interrupted project package target could not be removed safely'
      )
    }
    await rm(output.state.absolutePath)
  }
  await rm(output.stagingDirectory, { recursive: true, force: true })
}

async function commitRecoveredOutput(output: {
  completed: CompletedMediaOutputRecovery
  pending?: PendingMediaOutputTransaction
  stagingDirectory: string
  backupPath: string
}): Promise<void> {
  const target = await lstatIfPresent(output.completed.absolutePath)
  if (!target || !target.isFile() || target.isSymbolicLink() ||
    !sameStatIdentity(target, output.completed.completedIdentity)) {
    throw new ExtensionMediaArchiveError(
      'invalid_output',
      'Recovered project package no longer matches its recorded identity'
    )
  }
  const backup = await lstatIfPresent(output.backupPath)
  if (backup) {
    if (!backup.isFile() || backup.isSymbolicLink() ||
      (output.pending && (!output.pending.hadTarget || !output.pending.originalIdentity ||
        !sameStatIdentity(backup, output.pending.originalIdentity)))) {
      throw new ExtensionMediaArchiveError(
        'invalid_output',
        'Recovered project package backup could not be authenticated'
      )
    }
    await rm(output.backupPath)
  }
  await rm(output.stagingDirectory, { recursive: true, force: true })
}

function assertOutputMime(output: ResolvedMediaHandle): void {
  if (output.mimeType !== 'application/zip' && output.mimeType !== 'application/octet-stream') {
    throw new ExtensionMediaArchiveError(
      'invalid_argument',
      'Project package output target must use application/zip'
    )
  }
}

function assertNoAlias(inputs: ResolvedMediaHandle[], output: ResolvedMediaHandle): void {
  for (const input of inputs) {
    if (input.absolutePath === output.absolutePath ||
      Boolean(input.identity && output.identity &&
        identifiesSameFile(input.identity, output.identity))) {
      throw new ExtensionMediaArchiveError(
        'output_alias',
        'Project package output cannot alias an input'
      )
    }
  }
}

function sameIdentity(
  info: Awaited<ReturnType<typeof lstat>>,
  identity: NonNullable<ResolvedMediaHandle['identity']>
): boolean {
  return matchesFileIdentity(identity, fileIdentityFromStat(info))
}

function sameStatIdentity(
  info: Awaited<ReturnType<typeof lstat>>,
  identity: NonNullable<PendingMediaOutputTransaction['originalIdentity']>
): boolean {
  return matchesFileIdentity(identity, fileIdentityFromStat(info))
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash, { signal })
  return hash.digest('hex')
}

function publicMediaMetadata(handle: MediaHandleProjection) {
  return {
    handleId: handle.id,
    mode: 'read' as const,
    kind: 'data' as const,
    displayName: handle.displayName,
    mimeType: handle.mimeType,
    ...(handle.byteSize === undefined ? {} : { byteSize: handle.byteSize }),
    ...(handle.modifiedAt === undefined ? {} : { modifiedAt: handle.modifiedAt }),
    ...(handle.lastAccessedAt === undefined ? {} : { lastAccessedAt: handle.lastAccessedAt }),
    ...(handle.completionIdentity === undefined ? {} : {
      completionIdentity: handle.completionIdentity
    }),
    revoked: !handle.available
  }
}

function requirePermissions(principal: ExtensionPrincipal): void {
  if (!principal.workspaceTrusted || principal.workspaceRoots.length !== 1) {
    throw new ExtensionMediaArchiveError('permission_denied', 'Project package requires one trusted workspace')
  }
  for (const permission of ['jobs.manage', 'media.read', 'media.export', 'workspace.read', 'workspace.write']) {
    if (!principal.permissions.includes(permission)) {
      throw new ExtensionMediaArchiveError('permission_denied', `Missing permission: ${permission}`)
    }
  }
}

function boundedBytes(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > Number.MAX_SAFE_INTEGER) {
    throw new Error('Archive byte limit is invalid')
  }
  return candidate
}
