import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createWriteStream, type WriteStream } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { applyPosixMode } from '../security/posix-permissions.js'
import {
  backgroundShellActiveMarkerPath,
  enforceBackgroundShellOutputRetention
} from './background-shell-output-retention.js'

/** Shared per-thread folder for all background shell logs (alongside messages.jsonl). */
export const BACKGROUND_SHELL_OUTPUT_SUBDIR = 'background-shells'
export const DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS = 10_000
export const DEFAULT_BACKGROUND_SHELL_OUTPUT_MAX_BYTES = 10 * 1024 * 1024
export const BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE =
  '\n[background shell output truncated; use output_file for the full log]'
export const BACKGROUND_SHELL_OUTPUT_EXPIRED_NOTICE =
  '[background shell output expired by retention policy]'

export type BackgroundShellOutputPaths = {
  outputDir: string
  outputFilePath: string
}

export type BackgroundShellOutputSummary = {
  summary: string
  truncated: boolean
  totalChars: number
}

export function resolveBackgroundShellOutputDir(dataDir: string, threadId: string): string {
  return join(resolve(dataDir, 'threads', threadId), BACKGROUND_SHELL_OUTPUT_SUBDIR)
}

export function resolveBackgroundShellOutputPaths(
  dataDir: string,
  threadId: string,
  sessionId: string
): BackgroundShellOutputPaths {
  const outputDir = resolveBackgroundShellOutputDir(dataDir, threadId)
  const outputFilePath = resolve(outputDir, `${sessionId}.output`)
  return { outputDir, outputFilePath }
}

export function isBackgroundShellOutputPath(
  absolutePath: string,
  options: { runtimeDataDir?: string; threadId?: string }
): boolean {
  const dataDir = options.runtimeDataDir?.trim()
  if (!dataDir) return false
  const normalized = resolve(absolutePath)
  const threadId = options.threadId?.trim()
  if (threadId) {
    const dir = resolveBackgroundShellOutputDir(dataDir, threadId)
    if (!normalized.startsWith(`${dir}${sep}`) && normalized !== dir) return false
    return normalized.endsWith('.output')
  }
  const threadsRoot = resolve(dataDir, 'threads')
  const rel = relative(threadsRoot, normalized)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  const parts = rel.split(sep)
  return parts.length === 3 && parts[1] === BACKGROUND_SHELL_OUTPUT_SUBDIR && parts[2]?.endsWith('.output') === true
}

export function summarizeBackgroundShellOutput(
  fullOutput: string,
  maxChars = DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS
): BackgroundShellOutputSummary {
  const chars = [...fullOutput]
  const totalChars = chars.length
  if (totalChars <= maxChars) {
    return { summary: fullOutput, truncated: false, totalChars }
  }
  const noticeChars = [...BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE].length
  const bodyBudget = Math.max(1, maxChars - noticeChars)
  const body = chars.slice(-bodyBudget).join('')
  return {
    summary: `${body}${BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE}`,
    truncated: true,
    totalChars
  }
}

export async function readBackgroundShellOutputSummary(
  outputFilePath: string,
  maxChars = DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS
): Promise<BackgroundShellOutputSummary> {
  try {
    const full = await readFile(outputFilePath, 'utf-8')
    return summarizeBackgroundShellOutput(full, maxChars)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        summary: BACKGROUND_SHELL_OUTPUT_EXPIRED_NOTICE,
        truncated: true,
        totalChars: 0
      }
    }
    return { summary: '', truncated: false, totalChars: 0 }
  }
}

export class BackgroundShellOutputWriter {
  private stream: WriteStream | undefined
  private closed = false
  private bytesWritten = 0
  private storageTruncated = false
  private markerCreated = false

  readonly paths: BackgroundShellOutputPaths

  constructor(
    private readonly dataDir: string,
    threadId: string,
    sessionId: string,
    private readonly maxBytes = DEFAULT_BACKGROUND_SHELL_OUTPUT_MAX_BYTES
  ) {
    this.paths = resolveBackgroundShellOutputPaths(dataDir, threadId, sessionId)
  }

  async open(): Promise<void> {
    await this.ensureOutputDir()
    await writeFile(this.paths.outputFilePath, '', { encoding: 'utf-8', mode: 0o600 })
    await applyPosixMode(this.paths.outputFilePath, 0o600)
    await writeFile(backgroundShellActiveMarkerPath(this.paths.outputFilePath), JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString()
    }), { encoding: 'utf8', mode: 0o600 })
    this.markerCreated = true
    this.stream = createWriteStream(this.paths.outputFilePath, { flags: 'a', mode: 0o600 })
  }

  append(chunk: Buffer | string): void {
    if (this.closed) return
    if (!this.stream) {
      throw new Error('background shell output writer is not open')
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = Math.max(0, this.maxBytes - this.bytesWritten)
    if (remaining === 0) {
      this.storageTruncated = true
      return
    }
    const written = buffer.subarray(0, remaining)
    this.bytesWritten += written.byteLength
    if (written.byteLength < buffer.byteLength) this.storageTruncated = true
    this.stream.write(written)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (!this.stream) {
      await this.ensureOutputDir()
      await writeFile(this.paths.outputFilePath, '', { encoding: 'utf-8', mode: 0o600 })
      await applyPosixMode(this.paths.outputFilePath, 0o600)
      await this.finishRetention()
      return
    }
    const stream = this.stream
    this.stream = undefined
    try {
      await new Promise<void>((resolvePromise, reject) => {
        stream.once('finish', resolvePromise)
        stream.once('error', reject)
        stream.end()
      })
    } finally {
      await this.finishRetention()
    }
  }

  async buildReturnFields(
    maxChars = DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS
  ): Promise<BackgroundShellOutputSummary & { output_file: string }> {
    const stream = this.stream
    if (stream) {
      await new Promise<void>((resolvePromise, reject) => {
        stream.write('', (error) => {
          if (error) reject(error)
          else resolvePromise()
        })
      })
    }
    const summary = await readBackgroundShellOutputSummary(this.paths.outputFilePath, maxChars)
    return {
      ...summary,
      truncated: summary.truncated || this.storageTruncated,
      output_file: this.paths.outputFilePath
    }
  }

  private async ensureOutputDir(): Promise<void> {
    await mkdir(this.paths.outputDir, { recursive: true, mode: 0o700 })
    await applyPosixMode(this.paths.outputDir, 0o700)
  }

  private async finishRetention(): Promise<void> {
    if (this.markerCreated) {
      this.markerCreated = false
      await rm(backgroundShellActiveMarkerPath(this.paths.outputFilePath), { force: true })
    }
    await enforceBackgroundShellOutputRetention(
      this.dataDir,
      this.paths.outputFilePath
    ).catch(() => undefined)
  }
}
