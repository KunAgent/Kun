/**
 * Pi rpc handshake probe for `POST /v1/harnesses/:id/test` (P6-11): pi has no
 * protocol `initialize`; the `get_state` response doubles as the handshake —
 * it proves the rpc channel is alive and reports the active session/model.
 */
import { tmpdir } from 'node:os'
import { startHarnessProcess } from '../session/harness-process.js'
import type { HarnessSpawnFn } from '../session/harness-session.js'
import { PiClient } from '../runtime/pi/pi-client.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'
import { ACP_READINESS_TIMEOUT_MS } from './acp-readiness-probe.js'
import { raceProbeAbort } from './probe-abort.js'

export type PiHandshakeProbeDeps = {
  spawn?: HarnessSpawnFn
  timeoutMs?: number
  signal?: AbortSignal
  env?: Record<string, string>
  /** Read the locally available model catalog without sending a prompt. */
  includeModels?: boolean
  resolveSecretEnv?: HarnessSecretRefResolver
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never throws: every failure mode maps to `ok:false` + a short detail. */
export async function probePiHandshake(
  definition: HarnessDefinition,
  command: string,
  deps: PiHandshakeProbeDeps = {}
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  const timeoutMs = deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS
  const signal = AbortSignal.any([
    ...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(timeoutMs)
  ])
  let process
  let pending: ReturnType<typeof startHarnessProcess> | undefined
  try {
    signal.throwIfAborted()
    const secretEnv = await raceProbeAbort(resolveHarnessSecretEnv(definition, deps.resolveSecretEnv), signal)
    signal.throwIfAborted()
    // No bridge extension or prompt: get_state only checks protocol health.
    pending = startHarnessProcess({
      signal,
      command,
      args: ['--mode', 'rpc', '--no-extensions'],
      env: definition.launch?.env ?? {},
      secretEnv,
      credentialEnv: deps.env,
      cwd: tmpdir(),
      ...(deps.spawn ? { spawn: deps.spawn } : {})
    })
    process = await raceProbeAbort(pending, signal)
    signal.throwIfAborted()
  } catch (error) {
    // The launcher can settle after cancellation. Reclaim that late child too.
    void pending?.then((child) => child.stop(0).catch(() => undefined), () => undefined)
    return {
      ok: false,
      supported: true,
      protocol: 'pi-rpc',
      detail: `spawn failed: ${errorMessage(error)}`
    }
  }
  const client = new PiClient(process)
  let operation = 'get_state'
  try {
    const state = await raceProbeAbort(client.getState(timeoutMs), signal)
    signal.throwIfAborted()
    let models: string[] | undefined
    if (deps.includeModels) {
      operation = 'get_available_models'
      const available = await raceProbeAbort(client.getAvailableModels(), signal)
      signal.throwIfAborted()
      models = [...new Set(available.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
        const id = typeof entry.id === 'string' ? entry.id.trim() : ''
        return provider && id ? [`${provider}/${id}`] : []
      }))]
    }
    const model = state.model
    const detail =
      [
        state.sessionId ? `session ${state.sessionId}` : undefined,
        model?.id ? `model ${model.provider ?? ''}/${model.id}` : undefined
      ]
        .filter(Boolean)
        .join(', ') || 'rpc channel answered'
    return { ok: true, supported: true, protocol: 'pi-rpc', authentication: 'unverified',
      ...(models ? { models } : {}), detail }
  } catch (error) {
    const stderr = process.sanitizedStderrTail()
    const stderrLine =
      stderr
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /error|EACCES|ENOENT|denied|failed/i.test(line)) ??
      stderr.trim().split('\n').pop()
    return {
      ok: false,
      supported: true,
      protocol: 'pi-rpc',
      detail:
        `${operation} failed: ${errorMessage(error)}` +
        (stderrLine ? ` — stderr: ${stderrLine.slice(0, 200)}` : '')
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}
