import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream, type WriteStream } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Shared per-thread folder for all background shell logs (alongside messages.jsonl). */
export const BACKGROUND_SHELL_OUTPUT_SUBDIR = 'background-shells'
export const DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS = 10_000
export const BACKGROUND_SHELL_OUTPUT_TRUNCATION_NOTICE =
  '\n[background shell output truncated; use output_file for the full log]'

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
  } catch {
    return { summary: '', truncated: false, totalChars: 0 }
  }
}

export class BackgroundShellOutputWriter {
  private stream: WriteStream | undefined
  private closed = false

  readonly paths: BackgroundShellOutputPaths

  constructor(dataDir: string, threadId: string, sessionId: string) {
    this.paths = resolveBackgroundShellOutputPaths(dataDir, threadId, sessionId)
  }

  async open(): Promise<void> {
    await mkdir(this.paths.outputDir, { recursive: true })
    await writeFile(this.paths.outputFilePath, '', 'utf-8')
    this.stream = createWriteStream(this.paths.outputFilePath, { flags: 'a' })
  }

  append(chunk: Buffer | string): void {
    if (this.closed) return
    if (!this.stream) {
      throw new Error('background shell output writer is not open')
    }
    this.stream.write(chunk)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (!this.stream) {
      await mkdir(this.paths.outputDir, { recursive: true })
      await writeFile(this.paths.outputFilePath, '', 'utf-8')
      return
    }
    const stream = this.stream
    this.stream = undefined
    await new Promise<void>((resolvePromise, reject) => {
      stream.once('finish', resolvePromise)
      stream.once('error', reject)
      stream.end()
    })
  }

  async buildReturnFields(
    maxChars = DEFAULT_BACKGROUND_SHELL_OUTPUT_SUMMARY_MAX_CHARS
  ): Promise<BackgroundShellOutputSummary & { output_file: string }> {
    const summary = await readBackgroundShellOutputSummary(this.paths.outputFilePath, maxChars)
    return {
      ...summary,
      output_file: this.paths.outputFilePath
    }
  }
}
