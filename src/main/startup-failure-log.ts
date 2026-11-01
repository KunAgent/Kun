import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeStartupFailureMessage } from './startup-failure-content'
import type { StartupFailureLogTail } from './startup-failure-page'

const TAIL_BYTES = 24 * 1024
const TAIL_LINES = 30
const MAX_LINE_LENGTH = 400

// The diagnostic message names the log that explains the failure (for example
// the Service Manager log). Only paths that appear in the message are opened.
export function referencedStartupLogFile(message: string): string | undefined {
  const match = /(?:^|[\s'"(])((?:\/|[A-Za-z]:\\)[^\s'"()]+\.log)\b/.exec(message)
  return match?.[1]
}

function latestDesktopLog(logDir: string): string | undefined {
  try {
    const names = readdirSync(logDir).filter((name) => /^kun-.+\.log$/.test(name)).sort()
    const latest = names.at(-1)
    return latest ? join(logDir, latest) : undefined
  } catch {
    return undefined
  }
}

export function readStartupLogTail(path: string): StartupFailureLogTail | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split(/\r?\n/)
    if (size > length) lines.shift()
    return {
      path,
      lines: lines
        .filter((line) => line.trim().length > 0)
        .slice(-TAIL_LINES)
        .map((line) => sanitizeStartupFailureMessage(line).slice(0, MAX_LINE_LENGTH))
    }
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export type StartupLogSource = { path: string; referenced: boolean } | undefined

export function startupLogSource(message: string, logDir: string): StartupLogSource {
  const referenced = referencedStartupLogFile(message)
  if (referenced) return { path: referenced, referenced: true }
  const latest = latestDesktopLog(logDir)
  return latest ? { path: latest, referenced: false } : undefined
}

export function startupDiagnosticsReport(input: {
  title: string
  kind: string
  message: string
  appVersion: string
  execPath: string
  logDir: string
  logTail: StartupFailureLogTail | null | undefined
}): string {
  return [
    `Kun startup failure: ${input.title}`,
    `Kind: ${input.kind}`,
    `Version: ${input.appVersion}`,
    `Platform: ${process.platform} ${process.arch} (${process.getSystemVersion?.() ?? 'unknown'})`,
    `App path: ${input.execPath}`,
    `Log directory: ${input.logDir}`,
    '',
    'Error:',
    input.message,
    ...(input.logTail
      ? ['', `Log tail (${input.logTail.path}):`, ...(input.logTail.lines.length > 0 ? input.logTail.lines : ['(empty)'])]
      : [])
  ].join('\n')
}
