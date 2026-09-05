import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, extname, win32 as win32Path } from 'node:path'

export const UPDATE_HEALTH_INTERNAL_TIMEOUT_MS = 120_000

export type UpdateHealthProgressDetail = Record<
  string,
  string | number | boolean | null | undefined
>

export function updateHealthDiagnosticBasePath(resultPath: string): string {
  const extension = extname(resultPath)
  return extension ? resultPath.slice(0, -extension.length) : resultPath
}

export function appendUpdateHealthProgress(input: {
  detail?: UpdateHealthProgressDetail
  phase: string
  resultPath: string
  startedAt: string
  target: string
}): void {
  if (!input.resultPath) return
  const progressPath = `${updateHealthDiagnosticBasePath(input.resultPath)}.progress.jsonl`
  mkdirSync(dirname(progressPath), { recursive: true })
  appendFileSync(progressPath, `${JSON.stringify({
    schemaVersion: 1,
    pid: process.pid,
    parentPid: process.ppid,
    executablePath: process.execPath,
    target: input.target,
    startedAt: input.startedAt,
    phase: input.phase,
    at: new Date().toISOString(),
    ...input.detail
  })}\n`, 'utf8')
}

export function writeUpdateHealthBootstrapFailure(input: {
  argv: string[]
  error: unknown
  executablePath: string
  resultPath: string
  startedAt?: string
  target: string
  token: string
  version: string
}): void {
  if (!input.resultPath) return
  // The probe writes its own precise terminal failure before rejecting. Do not
  // replace that result with the less-specific dynamic-import fallback.
  if (existsSync(input.resultPath)) return
  const message = input.error instanceof Error ? input.error.message : String(input.error)
  const safeArgv = input.argv.map((value) => value.replace(
    /--kun-update-health-token=(?:"[^"]*"|'[^']*'|\S+)/gu,
    '--kun-update-health-token=<redacted>'
  ))
  appendUpdateHealthProgress({
    resultPath: input.resultPath,
    target: input.target,
    startedAt: input.startedAt ?? new Date().toISOString(),
    phase: 'failed',
    detail: { message: `Update health bootstrap failed: ${message}` }
  })
  mkdirSync(dirname(input.resultPath), { recursive: true })
  const temporary = `${input.resultPath}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    token: input.token,
    installDir: win32Path.dirname(input.executablePath),
    version: input.version,
    message: `Update health bootstrap failed: ${message}; argv=${JSON.stringify(safeArgv)}; target=${input.target}`,
    at: new Date().toISOString()
  })}\n`, 'utf8')
  renameSync(temporary, input.resultPath)
}
