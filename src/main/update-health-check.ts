import { app } from 'electron'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, win32 as win32Path } from 'node:path'
import { runMinimalUpdateProbe } from './update-health-probe'
import type { UpdateHealthProbeProgress } from './update-health-probe'
import {
  UPDATE_HEALTH_PATH_ARG,
  UPDATE_HEALTH_TARGET_ARG,
  UPDATE_HEALTH_TOKEN_ARG,
  updateHealthArgumentValue
} from './update-health-argv'

type UpdateHealthRequest = {
  resultPath: string
  token: string
  target: string
}

export function readUpdateHealthRequest(argv = process.argv): UpdateHealthRequest | null {
  const resultPath = updateHealthArgumentValue(UPDATE_HEALTH_PATH_ARG, argv)
  if (!resultPath) return null
  const token = updateHealthArgumentValue(UPDATE_HEALTH_TOKEN_ARG, argv)
  const target = updateHealthArgumentValue(UPDATE_HEALTH_TARGET_ARG, argv)
  if (!token || !target) throw new Error('The update health request is incomplete.')
  return { resultPath, token, target }
}

async function writeHealthResult(
  request: UpdateHealthRequest,
  ok: boolean,
  message: string
): Promise<void> {
  await mkdir(dirname(request.resultPath), { recursive: true })
  const temporary = `${request.resultPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    ok,
    token: request.token,
    installDir: win32Path.dirname(process.execPath),
    version: app.getVersion(),
    message,
    at: new Date().toISOString()
  })}\n`, 'utf8')
  await rename(temporary, request.resultPath)
}

export async function runUpdateHealthCheck(
  request: UpdateHealthRequest,
  options: {
    deadlineAt?: number
    diagnosticBasePath?: string
    reportProgress?: UpdateHealthProbeProgress
  } = {}
): Promise<void> {
  const reportProgress = options.reportProgress ?? (() => undefined)
  try {
    if (process.platform !== 'win32') throw new Error('Update health checks require Windows.')
    const installDir = win32Path.dirname(process.execPath)
    if (win32Path.resolve(installDir).toLowerCase() !== win32Path.resolve(request.target).toLowerCase()) {
      throw new Error('The candidate executable is outside the committed install target.')
    }
    await runMinimalUpdateProbe(undefined, {
      deadlineAt: options.deadlineAt ?? Date.now() + 120_000,
      diagnosticBasePath: options.diagnosticBasePath ?? request.resultPath.replace(/\.json$/iu, ''),
      reportProgress
    })
    await writeHealthResult(request, true, 'Candidate application payload is healthy.')
    reportProgress('complete')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeHealthResult(request, false, message)
    reportProgress('failed', { message })
    throw error
  }
}
