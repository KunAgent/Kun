import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionMediaHandleService,
  fileIdentityFromStat,
  identifiesSameFile,
  matchesFileIdentity,
  ExtensionMediaHandleError,
  type CompletedMediaOutputRecovery,
  type MediaOutputCompletionTransaction,
  type MediaHandleProjection,
  type PendingMediaOutputTransaction,
  type ResolvedMediaHandle
} from './extension-media-handle-service.js'
import {
  EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
  EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
  ExtensionMediaProcessError,
  ExtensionMediaProcessService
} from './extension-media-process-service.js'

const BINDING_NAME = /^[a-z][a-z0-9_-]{0,63}$/u
const PLACEHOLDER = /^\{\{(input|output):([a-z][a-z0-9_-]{0,63})\}\}$/u
const FORBIDDEN_OPTION_BASES = new Set([
  '-attach',
  '-dump_attachment',
  '-filter_complex_script',
  '-filter_script',
  '-format_whitelist',
  '-init_hw_device',
  '-pass',
  '-passlogfile',
  '-progress',
  '-protocol_whitelist',
  '-report',
  '-sdp_file',
  '-vstats_file',
  '-y'
])
const SAFE_FLAG_OPTIONS = new Set([
  '-accurate_seek',
  '-an',
  '-autorotate',
  '-copyts',
  '-dn',
  '-noaccurate_seek',
  '-noautorotate',
  '-nostdin',
  '-re',
  '-shortest',
  '-sn',
  '-start_at_zero',
  '-vn'
])
const SAFE_VALUE_OPTION_BASES = new Set([
  '-ac',
  '-afade',
  '-ar',
  '-aspect',
  '-b',
  '-bf',
  '-brand',
  '-bufsize',
  '-c',
  '-channel_layout',
  '-codec',
  '-coder',
  '-context',
  '-crf',
  '-disposition',
  '-filter_complex_threads',
  '-filter_threads',
  '-frames',
  '-framerate',
  '-g',
  '-itsscale',
  '-itsoffset',
  '-keyint_min',
  '-level',
  '-map',
  '-map_chapters',
  '-map_metadata',
  '-maxrate',
  '-minrate',
  '-movflags',
  '-pix_fmt',
  '-preset',
  '-profile',
  '-q',
  '-qp',
  '-qscale',
  '-r',
  '-refs',
  '-s',
  '-sample_fmt',
  '-sc_threshold',
  '-sseof',
  '-ss',
  '-stream_loop',
  '-t',
  '-tag',
  '-threads',
  '-to',
  '-tune',
  '-vframes',
  '-aframes',
  '-vsync'
])
const FILTER_OPTION_BASES = new Set(['-af', '-filter', '-filter_complex', '-vf'])
const SAFE_EXPLICIT_FORMATS = new Set([
  'aac',
  'adts',
  'aiff',
  'avi',
  'flac',
  'gif',
  'image2',
  'image2pipe',
  'matroska',
  'mjpeg',
  'mov',
  'mp3',
  'mp4',
  'null',
  'ogg',
  'opus',
  'wav',
  'webm',
  'webp'
])
const SAFE_FILTERS = new Set([
  'adelay',
  'afade',
  'amix',
  'anull',
  'aresample',
  'asetpts',
  'atrim',
  'color',
  'colorchannelmixer',
  'concat',
  'crop',
  'drawtext',
  'eq',
  'fade',
  'format',
  'fps',
  'loudnorm',
  'null',
  'overlay',
  'pad',
  'rotate',
  'scale',
  'setdar',
  'setpts',
  'setsar',
  'settb',
  'showwavespic',
  'tile',
  'transpose',
  'trim',
  'volume',
  'boxblur',
  'colorbalance',
  'unsharp',
  'vignette'
])
const SAFE_DRAWTEXT_OPTIONS = new Set([
  'alpha',
  'bordercolor',
  'borderw',
  'box',
  'boxborderw',
  'boxcolor',
  'enable',
  'expansion',
  'fix_bounds',
  'font',
  'fontcolor',
  'fontsize',
  'line_spacing',
  'shadowcolor',
  'shadowx',
  'shadowy',
  'start_number',
  'tabsize',
  'text',
  'text_align',
  'x',
  'y',
  'y_align'
])
const SAFE_TEXT_OUTPUT_MIME_TYPES = new Set([
  'application/x-subrip',
  'application/x-otio+json',
  'text/vtt'
])
const MAX_SUBTITLE_TEXT_OUTPUT_BYTES = 192 * 1024
const MAX_TEXT_OUTPUT_BYTES = 2 * 1024 * 1024

export type ExtensionFfmpegRequest = {
  arguments: string[]
  inputs: Record<string, string>
  outputs: Record<string, string>
  textOutputs?: Record<string, {
    handleId: string
    mimeType: 'application/x-subrip' | 'application/x-otio+json' | 'text/vtt'
    content: string
  }>
}

export type ExtensionFfmpegProgress = {
  outTimeMicros?: number
  outputBytes?: number
  speed?: number
  frame?: number
  terminal: boolean
}

export type ExtensionFfmpegResult = {
  generatedMedia: MediaHandleProjection[]
}

/** Core-only output transaction retained until the durable job terminal fence. */
export type ExtensionFfmpegOutputTransaction = ExtensionFfmpegResult & {
  commit(): Promise<void>
  rollback(): Promise<void>
}

export class ExtensionMediaFfmpegError extends Error {
  constructor(
    readonly code:
      | 'permission_denied'
      | 'invalid_argument'
      | 'output_alias'
      | 'output_limit'
      | 'invalid_output'
      | 'process_failed',
    message: string
  ) {
    super(message)
  }
}

type PreparedOutput = {
  name: string
  handleId: string
  target: ResolvedMediaHandle
  stagingDirectory: string
  stagingPath: string
  backupPath: string
  source: 'ffmpeg' | 'text'
  textContent?: string
}

type PromotedOutput = PreparedOutput & { hadTarget: boolean; promoted: boolean }

export class ExtensionMediaFfmpegService {
  private readonly maxOutputBytes: number
  private readonly maxInputs: number
  private readonly maxOutputs: number

  constructor(private readonly options: {
    handleService: ExtensionMediaHandleService
    processService: ExtensionMediaProcessService
    maxOutputBytes?: number
    maxInputs?: number
    maxOutputs?: number
  }) {
    this.maxOutputBytes = boundedInteger(
      options.maxOutputBytes,
      20 * 1024 * 1024 * 1024,
      1024,
      Number.MAX_SAFE_INTEGER
    )
    this.maxInputs = boundedInteger(options.maxInputs, 16, 1, 64)
    this.maxOutputs = boundedInteger(options.maxOutputs, 8, 1, 16)
  }

  async execute(
    principal: ExtensionPrincipal,
    request: ExtensionFfmpegRequest,
    options: {
      operationId?: string
      signal?: AbortSignal
      onProgress?: (progress: ExtensionFfmpegProgress) => void
    } = {}
  ): Promise<ExtensionFfmpegResult> {
    const transaction = await this.executeTransaction(principal, request, options)
    await transaction.commit()
    return { generatedMedia: transaction.generatedMedia }
  }

  /**
   * Runs and atomically promotes all outputs while keeping their prior target
   * bytes and handle state reversible. The durable media-job adapter commits
   * this transaction only after semantic probe/artifact validation wins its
   * terminal fence; every other outcome rolls it back.
   */
  async executeTransaction(
    principal: ExtensionPrincipal,
    request: ExtensionFfmpegRequest,
    options: {
      operationId?: string
      signal?: AbortSignal
      onProgress?: (progress: ExtensionFfmpegProgress) => void
    } = {}
  ): Promise<ExtensionFfmpegOutputTransaction> {
    requirePermissions(principal)
    const operationId = options.operationId ?? `ffmpeg_${randomUUID()}`
    const prepared = await this.prepare(principal, request, operationId)
    const controller = new AbortController()
    const cancelFromCaller = () => controller.abort()
    options.signal?.addEventListener('abort', cancelFromCaller, { once: true })
    if (options.signal?.aborted) controller.abort(options.signal.reason)
    let quotaExceeded = false
    let quotaCheckRunning = false
    const quotaTimer = setInterval(() => {
      if (quotaCheckRunning) return
      quotaCheckRunning = true
      void Promise.all(prepared.outputs.map(async (output) => {
        try {
          const bytes = await stagingDirectoryBytes(output.stagingDirectory, this.maxOutputBytes)
          if (bytes > this.maxOutputBytes) {
            quotaExceeded = true
            controller.abort()
          }
        } catch {
          // Missing staging outputs are normal while ffmpeg is starting.
        }
      })).finally(() => {
        quotaCheckRunning = false
      })
    }, 250)
    quotaTimer.unref?.()
    const progress = new FfmpegProgressParser(options.onProgress)
    let promotion: PromotedOutput[] | undefined
    let completion: MediaOutputCompletionTransaction | undefined
    let handedOff = false
    let preserveBackups = false
    try {
      assertNotCancelled(controller.signal)
      if (prepared.runFfmpeg) {
        const run = await this.options.processService.runFfmpegForCore(
          principal,
          prepared.arguments,
          { signal: controller.signal, onProgressChunk: (chunk) => progress.push(chunk) }
        )
        assertNotCancelled(controller.signal)
        progress.finish()
        if (run.exitCode !== 0) {
          throw new ExtensionMediaFfmpegError('process_failed', 'Media export failed')
        }
      }
      assertNotCancelled(controller.signal)
      await this.writeTextOutputs(prepared.outputs)
      await this.validateStagingOutputs(prepared.outputs)
      await this.reauthorizeOutputs(principal, prepared.outputs)
      assertNotCancelled(controller.signal)
      promotion = await promoteAll(prepared.outputs)
      assertNotCancelled(controller.signal)
      completion = await this.options.handleService.completeOutputsReversibly(
        principal,
        prepared.outputs.map((output) => ({
          handleId: output.handleId,
          reservationId: operationId
        })),
        { signal: controller.signal }
      )
      assertNotCancelled(controller.signal)
      const transaction = outputTransaction({
        principal,
        operationId,
        outputs: prepared.outputs,
        promotion,
        completion,
        handleService: this.options.handleService
      })
      handedOff = true
      return transaction
    } catch (error) {
      if (promotion !== undefined && !handedOff && !preserveBackups &&
        promotion.some((output) => output.promoted || output.hadTarget)) {
        const rolledBack = await rollbackPromotion(promotion)
        preserveBackups = !rolledBack
        if (!rolledBack) {
          throw new ExtensionMediaFfmpegError(
            'invalid_output',
            'Media export could not safely roll back its promoted outputs'
          )
        }
        if (completion !== undefined) await completion.rollback()
      }
      if (error instanceof PromotionRollbackError) {
        preserveBackups = true
        throw new ExtensionMediaFfmpegError(
          'invalid_output',
          'Media export could not safely roll back its promoted outputs'
        )
      }
      if (quotaExceeded) {
        throw new ExtensionMediaFfmpegError('output_limit', 'Media output exceeded its byte limit')
      }
      if (error instanceof ExtensionMediaProcessError && error.code === 'output_limit') {
        throw new ExtensionMediaFfmpegError('output_limit', 'Media process output exceeded its limit')
      }
      throw error
    } finally {
      clearInterval(quotaTimer)
      options.signal?.removeEventListener('abort', cancelFromCaller)
      await cleanupStaging(prepared.outputs)
      if (!handedOff) {
        if (!preserveBackups) await cleanupBackups(prepared.outputs)
        await Promise.all(prepared.outputs.map((output) =>
          this.options.handleService.releaseOutputReservation(principal, output.handleId, operationId)
        ))
      }
    }
  }

  /**
   * Reconciles filesystem and handle state left by an FFmpeg attempt whose
   * process disappeared with the prior Kun runtime. Paths are derived from the
   * persisted job id and output handles, so recovery never scans or guesses at
   * sibling files.
   */
  async rollbackInterruptedTransaction(
    principal: ExtensionPrincipal,
    request: ExtensionFfmpegRequest,
    operationId: string
  ): Promise<void> {
    requirePermissions(principal)
    const outputHandleIds = recoveryOutputHandleIds(request, this.maxInputs, this.maxOutputs)
    const pending: Array<{
      state: PendingMediaOutputTransaction
      stagingDirectory: string
      backupPath: string
    }> = []
    for (const handleId of outputHandleIds) {
      try {
        const state = await this.options.handleService.inspectOutputTransaction(
          principal,
          handleId,
          operationId
        )
        const paths = transactionPaths(state.absolutePath, operationId, handleId)
        pending.push({ state, ...paths })
      } catch (error) {
        if (error instanceof ExtensionMediaHandleError &&
          (error.code === 'handle_reserved' || error.code === 'not_found')) {
          continue
        }
        throw error
      }
    }
    if (pending.length === 0) return
    for (const output of pending) await rollbackInterruptedOutput(output)
    await this.options.handleService.rollbackOutputTransaction(
      principal,
      pending.map(({ state }) => state.handleId),
      operationId
    )
  }

  /** Finishes core-private output state after a completed job survives restart. */
  async commitRecoveredTransaction(
    principal: ExtensionPrincipal,
    request: ExtensionFfmpegRequest,
    operationId: string
  ): Promise<void> {
    requirePermissions(principal)
    const outputHandleIds = recoveryOutputHandleIds(request, this.maxInputs, this.maxOutputs)
    const provisionalHandleIds: string[] = []
    for (const handleId of outputHandleIds) {
      let pending: PendingMediaOutputTransaction | undefined
      let completed: CompletedMediaOutputRecovery
      try {
        pending = await this.options.handleService.inspectOutputTransaction(
          principal,
          handleId,
          operationId
        )
        if (!pending.completed || pending.completedIdentity === undefined) {
          throw new ExtensionMediaFfmpegError(
            'invalid_output',
            'Completed media job retained an unfinished output transaction'
          )
        }
        completed = {
          handleId,
          absolutePath: pending.absolutePath,
          completedIdentity: pending.completedIdentity
        }
        provisionalHandleIds.push(handleId)
      } catch (error) {
        if (!(error instanceof ExtensionMediaHandleError) ||
          (error.code !== 'handle_reserved' && error.code !== 'not_found')) {
          throw error
        }
        try {
          completed = await this.options.handleService.inspectCompletedOutput(principal, handleId)
        } catch (completedError) {
          if (completedError instanceof ExtensionMediaHandleError &&
            (completedError.code === 'handle_consumed' || completedError.code === 'not_found')) {
            continue
          }
          throw completedError
        }
      }
      const paths = transactionPaths(completed.absolutePath, operationId, handleId)
      await commitRecoveredOutput({ completed, pending, ...paths })
    }
    if (provisionalHandleIds.length > 0) {
      await this.options.handleService.commitOutputTransaction(
        principal,
        provisionalHandleIds,
        operationId
      )
    }
  }

  private async prepare(
    principal: ExtensionPrincipal,
    request: ExtensionFfmpegRequest,
    operationId: string
  ): Promise<{ arguments: string[]; outputs: PreparedOutput[]; runFfmpeg: boolean }> {
    const textOutputs = validateTextOutputs(request.textOutputs, this.maxOutputs)
    const runFfmpeg = validateRequestShape(
      request,
      textOutputs,
      this.maxInputs,
      this.maxOutputs
    )
    const inputs = new Map<string, ResolvedMediaHandle>()
    for (const [name, handleId] of Object.entries(request.inputs)) {
      const input = await this.options.handleService.resolve(principal, handleId, 'read')
      if (input.absolutePath.includes('%')) {
        throw invalidArgument('Media input names cannot contain FFmpeg pattern syntax')
      }
      inputs.set(name, input)
    }
    const outputs: PreparedOutput[] = []
    try {
      const allOutputBindings = [
        ...Object.entries(request.outputs).map(([name, handleId]) => ({
          name,
          handleId,
          source: 'ffmpeg' as const
        })),
        ...textOutputs.map((output) => ({ ...output, source: 'text' as const }))
      ]
      for (const binding of allOutputBindings) {
        const { name, handleId } = binding
        const target = await this.options.handleService.reserveOutput(principal, handleId, operationId)
        let extension: string
        try {
          extension = safeStagingExtension(target.absolutePath)
        } catch (error) {
          await this.options.handleService.releaseOutputReservation(principal, handleId, operationId)
          throw error
        }
        const paths = transactionPaths(target.absolutePath, operationId, handleId)
        outputs.push({
          name,
          handleId,
          target,
          stagingDirectory: paths.stagingDirectory,
          stagingPath: join(paths.stagingDirectory, `output${extension}`),
          backupPath: paths.backupPath,
          source: binding.source,
          ...(binding.source === 'text'
            ? { textContent: binding.content }
            : {})
        })
        if (binding.source === 'text' && target.mimeType !== binding.mimeType) {
          throw invalidArgument('Text output MIME type does not match its export target')
        }
        await mkdir(paths.stagingDirectory, { mode: 0o700 })
      }
      assertNoAliases([...inputs.values()], outputs.map((output) => output.target))
      const inputPaths = Object.fromEntries([...inputs].map(([name, handle]) => [name, handle.absolutePath]))
      const outputPaths = Object.fromEntries(outputs
        .filter((output) => output.source === 'ffmpeg')
        .map((output) => [output.name, output.stagingPath]))
      const substituted = runFfmpeg
        ? validateAndSubstituteFfmpegArguments(request.arguments, inputPaths, outputPaths)
        : []
      return {
        arguments: runFfmpeg
          ? [
              '-nostdin',
              '-hide_banner',
              '-nostats',
              '-progress', 'pipe:1',
              '-y',
              ...substituted
            ]
          : [],
        outputs,
        runFfmpeg
      }
    } catch (error) {
      await cleanupStaging(outputs)
      await Promise.all(outputs.map((output) =>
        this.options.handleService.releaseOutputReservation(principal, output.handleId, operationId)
      ))
      throw error
    }
  }

  private async validateStagingOutputs(outputs: PreparedOutput[]): Promise<void> {
    for (const output of outputs) {
      const entries = await readdir(output.stagingDirectory, { withFileTypes: true })
      if (entries.length !== 1 || entries[0]?.name !== basename(output.stagingPath) ||
        !entries[0].isFile() || entries[0].isSymbolicLink()) {
        throw new ExtensionMediaFfmpegError(
          'invalid_output',
          'Media export created undeclared output or sidecar files'
        )
      }
      let info
      try {
        info = await lstat(output.stagingPath)
      } catch {
        throw new ExtensionMediaFfmpegError('invalid_output', 'Media export did not create its declared output')
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
        throw new ExtensionMediaFfmpegError('invalid_output', 'Media export output is not a regular non-empty file')
      }
      if (info.size > this.maxOutputBytes) {
        throw new ExtensionMediaFfmpegError('output_limit', 'Media output exceeded its byte limit')
      }
      const parentInfo = await lstat(output.stagingDirectory)
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || parentInfo.dev !== info.dev) {
        throw new ExtensionMediaFfmpegError('invalid_output', 'Media output crossed its approved filesystem boundary')
      }
    }
  }

  private async writeTextOutputs(outputs: PreparedOutput[]): Promise<void> {
    await Promise.all(outputs.flatMap((output) => output.source === 'text'
      ? [writeFile(output.stagingPath, output.textContent!, { encoding: 'utf8', flag: 'wx', mode: 0o600 })]
      : []))
  }

  private async reauthorizeOutputs(
    principal: ExtensionPrincipal,
    outputs: PreparedOutput[]
  ): Promise<void> {
    for (const output of outputs) {
      const current = await this.options.handleService.resolve(principal, output.handleId, 'write')
      if (current.absolutePath !== output.target.absolutePath ||
        !sameIdentity(current.identity, output.target.identity)) {
        throw new ExtensionMediaFfmpegError('invalid_output', 'Media export target changed while processing')
      }
    }
  }
}

export function validateAndSubstituteFfmpegArguments(
  args: string[],
  inputs: Record<string, string>,
  outputs: Record<string, string>
): string[] {
  if (!Array.isArray(args) || args.length < 1 || args.length > 1024) {
    throw invalidArgument('FFmpeg arguments must contain between 1 and 1024 entries')
  }
  const usedInputs = new Set<string>()
  const usedOutputs = new Set<string>()
  const result: string[] = []
  for (let index = 0; index < args.length;) {
    const argument = args[index]!
    validateArgumentEntry(argument)
    const normalized = argument.toLowerCase()
    const base = optionBase(normalized)
    if (normalized === '-i') {
      const resource = args[index + 1]
      validateArgumentEntry(resource)
      const placeholder = PLACEHOLDER.exec(resource!)
      const name = placeholder?.[1] === 'input' ? placeholder[2] : undefined
      if (!name || !Object.hasOwn(inputs, name)) {
        throw invalidArgument('Input placeholders must be declared and immediately follow -i')
      }
      usedInputs.add(name)
      result.push(
        '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
        '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
        '-i', inputs[name]!
      )
      index += 2
      continue
    }
    if (argument.startsWith('-')) {
      if (FORBIDDEN_OPTION_BASES.has(normalized) || FORBIDDEN_OPTION_BASES.has(base)) {
        throw invalidArgument('FFmpeg argument uses a Host-reserved or unsafe option')
      }
      if (SAFE_FLAG_OPTIONS.has(normalized)) {
        result.push(argument)
        index += 1
        continue
      }
      const value = args[index + 1]
      if (base === '-f') {
        validateArgumentEntry(value)
        if (!SAFE_EXPLICIT_FORMATS.has(value!.toLowerCase())) {
          throw invalidArgument('FFmpeg format is not in the reviewed single-file allowlist')
        }
        result.push(argument, value!)
        index += 2
        continue
      }
      if (FILTER_OPTION_BASES.has(base)) {
        validateArgumentEntry(value)
        validateFilterGraph(value!)
        result.push(argument, value!)
        index += 2
        continue
      }
      if (SAFE_VALUE_OPTION_BASES.has(base)) {
        validateArgumentEntry(value)
        validateNonResourceValue(value!)
        result.push(argument, value!)
        index += 2
        continue
      }
      throw invalidArgument('FFmpeg option is not in the reviewed allowlist')
    }
    const placeholder = PLACEHOLDER.exec(argument)
    const name = placeholder?.[1] === 'output' ? placeholder[2] : undefined
    if (!name || !Object.hasOwn(outputs, name)) {
      if (argument.includes('{{') || argument.includes('}}')) {
        throw invalidArgument('Media placeholders must occupy a complete resource position')
      }
      throw invalidArgument('FFmpeg positional arguments must be declared output placeholders')
    }
    if (usedOutputs.has(name)) {
      throw invalidArgument('Each output placeholder may be used only once')
    }
    usedOutputs.add(name)
    result.push(outputs[name]!)
    index += 1
  }
  for (const name of Object.keys(inputs)) {
    if (!usedInputs.has(name)) throw invalidArgument('Every declared input must be used')
  }
  for (const name of Object.keys(outputs)) {
    if (!usedOutputs.has(name)) throw invalidArgument('Every declared output must be used exactly once')
  }
  return result
}

function validateArgumentEntry(argument: string | undefined): asserts argument is string {
  if (typeof argument !== 'string' || argument.length < 1 || argument.length > 8192 ||
    containsAsciiControl(argument)) {
    throw invalidArgument('FFmpeg argument is invalid')
  }
}

function optionBase(option: string): string {
  const streamSpecifier = option.indexOf(':')
  return streamSpecifier < 0 ? option : option.slice(0, streamSpecifier)
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function validateNonResourceValue(argument: string): void {
  if (argument.startsWith('@') || argument.includes('{{') || argument.includes('}}')) {
    throw invalidArgument('FFmpeg option values cannot reference external resources')
  }
  if (isAbsolute(argument) || argument.startsWith('\\\\') || argument.startsWith('//') ||
    argument.includes(`..${sep}`) || argument.includes('../') || argument.includes('..\\') ||
    argument.includes('$') || argument.includes('%') || argument.includes('`')) {
    throw invalidArgument('FFmpeg arguments cannot contain filesystem paths or expansion syntax')
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(argument) || /^[a-z]:/iu.test(argument)) {
    throw invalidArgument('FFmpeg arguments cannot open protocols or devices')
  }
  if ((argument.includes('/') || argument.includes('\\')) && !/^\d{1,10}\/\d{1,10}$/u.test(argument)) {
    throw invalidArgument('FFmpeg arguments cannot contain raw paths')
  }
}

function validateFilterGraph(graph: string): void {
  const filters = splitFilterSyntax(graph, new Set([',', ';']))
  if (filters.length < 1) throw invalidArgument('FFmpeg filter graph is empty')
  for (const rawFilter of filters) {
    const filter = rawFilter.replace(/^(?:\s*\[[^\]\r\n]{1,128}\])+\s*/u, '')
    const match = /^([a-z][a-z0-9_]*)(?:@[a-z0-9_-]+)?(?:=(.*))?$/isu.exec(filter)
    const name = match?.[1]?.toLowerCase()
    if (!name || !SAFE_FILTERS.has(name)) {
      throw invalidArgument('FFmpeg filter is not in the reviewed allowlist')
    }
    if (name === 'drawtext') validateDrawtextOptions(match?.[2] ?? '')
  }
}

function validateDrawtextOptions(raw: string): void {
  // FFmpeg first removes the filtergraph escaping layer and only then parses
  // drawtext's colon-delimited options. Decode exactly that one layer so our
  // validator sees the same boundaries while preserving drawtext escapes.
  const options = splitFilterSyntax(unescapeFilterGraphLayer(raw), new Set([':']))
  const seen = new Map<string, string>()
  for (const option of options) {
    const separator = option.indexOf('=')
    if (separator <= 0) {
      throw invalidArgument('FFmpeg drawtext requires reviewed named inline options')
    }
    const name = option.slice(0, separator).trim().toLowerCase()
    if (!SAFE_DRAWTEXT_OPTIONS.has(name)) {
      throw invalidArgument('FFmpeg drawtext path-loading or unknown options are not supported')
    }
    const value = option.slice(separator + 1)
    if (name === 'font') validateDrawtextFontFamily(value)
    seen.set(name, value)
  }
  if (!seen.has('text') || seen.get('expansion')?.toLowerCase() !== 'none') {
    throw invalidArgument('FFmpeg drawtext requires inline text with expansion=none')
  }
}

function validateDrawtextFontFamily(value: string): void {
  if (value.length < 1 || value.length > 128 || containsAsciiControl(value) ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._+-]*$/u.test(value)) {
    throw invalidArgument('FFmpeg drawtext font must be a bounded inline font family')
  }
}

function unescapeFilterGraphLayer(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '\\' && index + 1 < value.length) {
      result += value[index + 1]!
      index += 1
    } else {
      result += character
    }
  }
  return result
}

function splitFilterSyntax(value: string, separators: Set<string>): string[] {
  const result: string[] = []
  let start = 0
  let quote: "'" | '"' | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (separators.has(character)) {
      const part = value.slice(start, index).trim()
      if (!part) throw invalidArgument('FFmpeg filter graph syntax is invalid')
      result.push(part)
      start = index + 1
    }
  }
  if (escaped || quote !== undefined) {
    throw invalidArgument('FFmpeg filter graph syntax is invalid')
  }
  const tail = value.slice(start).trim()
  if (!tail) throw invalidArgument('FFmpeg filter graph syntax is invalid')
  result.push(tail)
  return result
}

function validateBindings(
  bindings: Record<string, string>,
  kind: string,
  max: number,
  allowEmpty = false
): void {
  if (!bindings || Array.isArray(bindings) || typeof bindings !== 'object') {
    throw invalidArgument(`FFmpeg ${kind} bindings are invalid`)
  }
  const entries = Object.entries(bindings)
  if ((!allowEmpty && entries.length < 1) || entries.length > max) {
    throw invalidArgument(`FFmpeg ${kind} binding count is outside the allowed limit`)
  }
  for (const [name, handleId] of entries) {
    if (!BINDING_NAME.test(name) || typeof handleId !== 'string' || handleId.length < 16 || handleId.length > 512) {
      throw invalidArgument(`FFmpeg ${kind} binding is invalid`)
    }
  }
}

function validateRequestShape(
  request: ExtensionFfmpegRequest,
  textOutputs: ReturnType<typeof validateTextOutputs>,
  maxInputs: number,
  maxOutputs: number
): boolean {
  if (!Array.isArray(request.arguments) || request.arguments.length > 1024) {
    throw invalidArgument('FFmpeg arguments must contain at most 1024 entries')
  }
  validateBindings(request.inputs, 'input', maxInputs, true)
  validateBindings(request.outputs, 'output', maxOutputs, true)
  const inputCount = Object.keys(request.inputs).length
  const ffmpegOutputCount = Object.keys(request.outputs).length
  if (ffmpegOutputCount + textOutputs.length > maxOutputs) {
    throw invalidArgument('FFmpeg output binding count is outside the allowed limit')
  }
  for (const output of textOutputs) {
    if (Object.hasOwn(request.outputs, output.name)) {
      throw invalidArgument('FFmpeg and text output binding names must be distinct')
    }
  }

  if (ffmpegOutputCount === 0) {
    if (textOutputs.length === 0) {
      throw invalidArgument('A text-only media job requires at least one text output')
    }
    if (inputCount !== 0 || request.arguments.length !== 0) {
      throw invalidArgument('A text-only media job cannot declare FFmpeg inputs or arguments')
    }
    return false
  }

  if (inputCount === 0 || request.arguments.length === 0) {
    throw invalidArgument('An FFmpeg media job requires input, output, and argument bindings')
  }
  return true
}

function validateTextOutputs(
  bindings: ExtensionFfmpegRequest['textOutputs'],
  max: number
): Array<{
    name: string
    handleId: string
    mimeType: 'application/x-subrip' | 'application/x-otio+json' | 'text/vtt'
    content: string
  }> {
  if (bindings === undefined) return []
  if (!bindings || Array.isArray(bindings) || typeof bindings !== 'object') {
    throw invalidArgument('FFmpeg text output bindings are invalid')
  }
  const entries = Object.entries(bindings)
  if (entries.length > max) {
    throw invalidArgument('FFmpeg text output binding count is outside the allowed limit')
  }
  let totalBytes = 0
  return entries.map(([name, binding]) => {
    if (!BINDING_NAME.test(name) || !binding || Array.isArray(binding) ||
      typeof binding !== 'object' || typeof binding.handleId !== 'string' ||
      binding.handleId.length < 16 || binding.handleId.length > 512 ||
      !SAFE_TEXT_OUTPUT_MIME_TYPES.has(binding.mimeType) || typeof binding.content !== 'string' ||
      binding.content.includes('\0')) {
      throw invalidArgument('FFmpeg text output binding is invalid')
    }
    const bytes = Buffer.byteLength(binding.content, 'utf8')
    totalBytes += bytes
    if (bytes < 1 || bytes > MAX_TEXT_OUTPUT_BYTES || totalBytes > MAX_TEXT_OUTPUT_BYTES) {
      throw invalidArgument('FFmpeg text outputs exceed their UTF-8 byte limit')
    }
    if (binding.mimeType !== 'application/x-otio+json' && bytes > MAX_SUBTITLE_TEXT_OUTPUT_BYTES) {
      throw invalidArgument('FFmpeg subtitle text output exceeds its UTF-8 byte limit')
    }
    if (binding.mimeType === 'application/x-otio+json') {
      validateOpenTimelineIoJson(binding.content)
    }
    return {
      name,
      handleId: binding.handleId,
      mimeType: binding.mimeType,
      content: binding.content
    }
  })
}

function validateOpenTimelineIoJson(content: string): void {
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    throw invalidArgument('OpenTimelineIO text output is not valid JSON')
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw invalidArgument('OpenTimelineIO text output root must be an object')
  }
  const schema = (root as Record<string, unknown>).OTIO_SCHEMA
  if (schema !== 'SerializableCollection.1' && schema !== 'Timeline.1') {
    throw invalidArgument('OpenTimelineIO text output root schema is unsupported')
  }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > 100_000 || current.depth > 64) {
      throw invalidArgument('OpenTimelineIO text output structure exceeds its bound')
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    if (!current.value || typeof current.value !== 'object') continue
    for (const [key, child] of Object.entries(current.value as Record<string, unknown>)) {
      if (key === 'target_url' && (
        typeof child !== 'string' ||
        !/^kun-media:\/\/[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(child)
      )) {
        throw invalidArgument('OpenTimelineIO media references must use opaque kun-media URLs')
      }
      pending.push({ value: child, depth: current.depth + 1 })
    }
  }
}

function recoveryOutputHandleIds(
  request: ExtensionFfmpegRequest,
  maxInputs: number,
  maxOutputs: number
): string[] {
  const textOutputs = validateTextOutputs(request.textOutputs, maxOutputs)
  validateRequestShape(request, textOutputs, maxInputs, maxOutputs)
  const handleIds = [
    ...Object.values(request.outputs),
    ...textOutputs.map(({ handleId }) => handleId)
  ]
  if (new Set(handleIds).size !== handleIds.length) {
    throw new ExtensionMediaFfmpegError('output_alias', 'Media outputs must be distinct')
  }
  return handleIds
}

function transactionPaths(
  absolutePath: string,
  operationId: string,
  handleId: string
): { stagingDirectory: string; backupPath: string } {
  const token = createHash('sha256')
    .update('kun-media-output\0', 'utf8')
    .update(operationId, 'utf8')
    .update('\0', 'utf8')
    .update(handleId, 'utf8')
    .digest('hex')
    .slice(0, 32)
  return {
    stagingDirectory: join(dirname(absolutePath), `.kun-media-${token}.kun-stage`),
    backupPath: join(dirname(absolutePath), `.${basename(absolutePath)}.${token}.kun-backup`)
  }
}

async function rollbackInterruptedOutput(output: {
  state: PendingMediaOutputTransaction
  stagingDirectory: string
  backupPath: string
}): Promise<void> {
  const { state } = output
  const backup = await lstatIfPresent(output.backupPath)
  const target = await lstatIfPresent(state.absolutePath)
  if (backup !== undefined) {
    if (!state.hadTarget || !backup.isFile() || backup.isSymbolicLink() ||
      state.originalIdentity === undefined || !sameStatIdentity(backup, state.originalIdentity)) {
      throw new ExtensionMediaFfmpegError(
        'invalid_output',
        'Interrupted media export backup could not be authenticated'
      )
    }
    if (target !== undefined) {
      if (!target.isFile() || target.isSymbolicLink()) {
        throw new ExtensionMediaFfmpegError(
          'invalid_output',
          'Interrupted media export target could not be restored safely'
        )
      }
      await rm(state.absolutePath)
    }
    await rename(output.backupPath, state.absolutePath)
  } else if (state.hadTarget) {
    if (target === undefined || !target.isFile() || target.isSymbolicLink() ||
      state.originalIdentity === undefined || !sameStatIdentity(target, state.originalIdentity)) {
      throw new ExtensionMediaFfmpegError(
        'invalid_output',
        'Interrupted media export lost its authenticated prior target'
      )
    }
  } else if (target !== undefined) {
    if (!target.isFile() || target.isSymbolicLink() ||
      (state.completedIdentity !== undefined &&
        !sameStatIdentity(target, state.completedIdentity))) {
      throw new ExtensionMediaFfmpegError(
        'invalid_output',
        'Interrupted media export target could not be removed safely'
      )
    }
    await rm(state.absolutePath)
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
  if (target === undefined || !target.isFile() || target.isSymbolicLink() ||
    !sameStatIdentity(target, output.completed.completedIdentity)) {
    throw new ExtensionMediaFfmpegError(
      'invalid_output',
      'Recovered completed media output no longer matches its recorded identity'
    )
  }
  const backup = await lstatIfPresent(output.backupPath)
  if (backup !== undefined) {
    if (!backup.isFile() || backup.isSymbolicLink() ||
      (output.pending !== undefined &&
        (!output.pending.hadTarget || output.pending.originalIdentity === undefined ||
          !sameStatIdentity(backup, output.pending.originalIdentity)))) {
      throw new ExtensionMediaFfmpegError(
        'invalid_output',
        'Recovered completed media backup could not be authenticated'
      )
    }
    await rm(output.backupPath)
  }
  await rm(output.stagingDirectory, { recursive: true, force: true })
}

async function lstatIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function sameStatIdentity(
  info: Awaited<ReturnType<typeof lstat>>,
  identity: NonNullable<PendingMediaOutputTransaction['originalIdentity']>
): boolean {
  return matchesFileIdentity(identity, fileIdentityFromStat(info))
}

function safeStagingExtension(path: string): string {
  const extension = extname(path)
  if (extension && !/^\.[a-z0-9]{1,12}$/iu.test(extension)) {
    throw invalidArgument('Media output extension contains unsupported pattern syntax')
  }
  return extension.toLowerCase()
}

function assertNoAliases(inputs: ResolvedMediaHandle[], outputs: ResolvedMediaHandle[]): void {
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!
    for (const input of inputs) {
      if (sameFile(input, output)) {
        throw new ExtensionMediaFfmpegError('output_alias', 'Media output cannot alias an input')
      }
    }
    for (const other of outputs.slice(0, index)) {
      if (sameFile(other, output)) {
        throw new ExtensionMediaFfmpegError('output_alias', 'Media outputs must be distinct')
      }
    }
  }
}

function sameFile(left: ResolvedMediaHandle, right: ResolvedMediaHandle): boolean {
  return left.absolutePath === right.absolutePath ||
    Boolean(left.identity && right.identity && identifiesSameFile(left.identity, right.identity))
}

function sameIdentity(
  left: ResolvedMediaHandle['identity'],
  right: ResolvedMediaHandle['identity']
): boolean {
  if (!left || !right) return left === right
  return matchesFileIdentity(left, right)
}

function outputTransaction(input: {
  principal: ExtensionPrincipal
  operationId: string
  outputs: PreparedOutput[]
  promotion: PromotedOutput[]
  completion: MediaOutputCompletionTransaction
  handleService: ExtensionMediaHandleService
}): ExtensionFfmpegOutputTransaction {
  let state: 'pending' | 'committed' | 'rolled-back' = 'pending'
  let transition = Promise.resolve()
  const serialize = async (
    target: 'committed' | 'rolled-back',
    operation: () => Promise<void>
  ): Promise<void> => {
    const prior = transition
    let release!: () => void
    transition = new Promise<void>((resolvePromise) => { release = resolvePromise })
    await prior
    try {
      if (state === target) return
      if (state !== 'pending') {
        throw new ExtensionMediaFfmpegError(
          'invalid_output',
          'Media output transaction already reached another terminal state'
        )
      }
      await operation()
      state = target
    } finally {
      release()
    }
  }
  const releaseReservations = async () => {
    await Promise.all(input.outputs.map((output) =>
      input.handleService.releaseOutputReservation(
        input.principal,
        output.handleId,
        input.operationId
      )
    ))
  }
  return {
    generatedMedia: input.completion.generatedMedia,
    commit: () => serialize('committed', async () => {
      await input.completion.commit()
      // A valid completed target is authoritative. Backup deletion failure is
      // safe (and recoverable cleanup), so it must not turn a completed export
      // into a failed job after the durable terminal fence has won.
      await cleanupBackups(input.outputs).catch(() => undefined)
    }),
    rollback: () => serialize('rolled-back', async () => {
      const restored = await rollbackPromotion(input.promotion)
      if (!restored) {
        throw new ExtensionMediaFfmpegError(
          'invalid_output',
          'Media export could not safely restore its prior targets'
        )
      }
      await input.completion.rollback()
      await releaseReservations()
      await cleanupBackups(input.outputs)
    })
  }
}

class PromotionRollbackError extends Error {}

async function promoteAll(outputs: PreparedOutput[]): Promise<PromotedOutput[]> {
  const prepared: PromotedOutput[] = []
  try {
    for (const output of outputs) {
      let hadTarget = false
      try {
        const target = await lstat(output.target.absolutePath)
        if (!target.isFile() || target.isSymbolicLink()) {
          throw new ExtensionMediaFfmpegError('invalid_output', 'Media export target is no longer a regular file')
        }
        if (!output.target.identity || !sameIdentity(
          output.target.identity,
          fileIdentityFromStat(target)
        )) {
          throw new ExtensionMediaFfmpegError('invalid_output', 'Media export target changed before promotion')
        }
        await rename(output.target.absolutePath, output.backupPath)
        hadTarget = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (output.target.identity) {
          throw new ExtensionMediaFfmpegError('invalid_output', 'Media export target disappeared before promotion')
        }
      }
      const item = { ...output, hadTarget, promoted: false }
      prepared.push(item)
      await rename(output.stagingPath, output.target.absolutePath)
      item.promoted = true
    }
    return prepared
  } catch (error) {
    if (!await rollbackPromotion(prepared)) {
      throw new PromotionRollbackError('Media export promotion could not be safely rolled back')
    }
    throw error
  }
}

async function rollbackPromotion(outputs: PromotedOutput[]): Promise<boolean> {
  let complete = true
  for (const output of [...outputs].reverse()) {
    if (output.promoted) {
      try {
        await rm(output.target.absolutePath, { force: true })
        output.promoted = false
      } catch {
        complete = false
        continue
      }
    }
    if (output.hadTarget) {
      try {
        await rename(output.backupPath, output.target.absolutePath)
        output.hadTarget = false
      } catch {
        complete = false
      }
    }
  }
  return complete
}

async function cleanupBackups(outputs: PreparedOutput[]): Promise<void> {
  await Promise.all(outputs.map((output) => rm(output.backupPath, { force: true })))
}

async function cleanupStaging(outputs: PreparedOutput[]): Promise<void> {
  await Promise.all(outputs.map((output) =>
    rm(output.stagingDirectory, { recursive: true, force: true })
  ))
}

async function stagingDirectoryBytes(path: string, limit: number): Promise<number> {
  const pending = [path]
  let bytes = 0
  let entriesSeen = 0
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entriesSeen += 1
      if (entriesSeen > 128) return limit + 1
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!entry.isFile() || entry.isSymbolicLink()) return limit + 1
      bytes += (await stat(entryPath)).size
      if (bytes > limit) return bytes
    }
  }
  return bytes
}

class FfmpegProgressParser {
  private buffer = ''
  private latest: Record<string, string> = {}
  private lastEmitAt = 0

  constructor(private readonly emit?: (progress: ExtensionFfmpegProgress) => void) {}

  push(chunk: Buffer): void {
    this.buffer = (this.buffer + chunk.toString('utf8')).slice(-16_384)
    const lines = this.buffer.split(/\r?\n/u)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const separator = line.indexOf('=')
      if (separator <= 0 || separator > 64 || line.length > 4096) continue
      this.latest[line.slice(0, separator)] = line.slice(separator + 1, 1024)
      if (line.startsWith('progress=')) this.flush(line === 'progress=end')
    }
  }

  finish(): void {
    this.flush(true)
  }

  private flush(terminal: boolean): void {
    const now = Date.now()
    if (!terminal && now - this.lastEmitAt < 100) return
    this.lastEmitAt = now
    this.emit?.({
      ...(integer(this.latest.out_time_us) !== undefined
        ? { outTimeMicros: integer(this.latest.out_time_us) }
        : {}),
      ...(integer(this.latest.total_size) !== undefined
        ? { outputBytes: integer(this.latest.total_size) }
        : {}),
      ...(integer(this.latest.frame) !== undefined ? { frame: integer(this.latest.frame) } : {}),
      ...(speed(this.latest.speed) !== undefined ? { speed: speed(this.latest.speed) } : {}),
      terminal
    })
  }
}

function integer(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function speed(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/x$/u, ''))
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : undefined
}

function requirePermissions(principal: ExtensionPrincipal): void {
  for (const permission of ['media.read', 'media.process', 'media.export', 'workspace.read', 'workspace.write']) {
    if (!principal.permissions.includes(permission)) {
      throw new ExtensionMediaFfmpegError('permission_denied', `Missing permission: ${permission}`)
    }
  }
  if (!principal.workspaceTrusted) {
    throw new ExtensionMediaFfmpegError('permission_denied', 'Workspace is not trusted')
  }
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ExtensionMediaProcessError('process_cancelled', 'Media process was cancelled')
  }
}

function invalidArgument(message: string): ExtensionMediaFfmpegError {
  return new ExtensionMediaFfmpegError('invalid_argument', message)
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value!)))
}
