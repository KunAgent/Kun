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

export type PiHandshakeProbeDeps = {
  spawn?: HarnessSpawnFn
  timeoutMs?: number
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
  let process
  try {
    const secretEnv = await resolveHarnessSecretEnv(definition, deps.resolveSecretEnv)
    // No credential env and no Kun bridge extension: the handshake proves the
    // binary speaks rpc, it does not run tools (no tool_call risk here).
    process = await startHarnessProcess({
      command,
      args: ['--mode', 'rpc', '--no-extensions'],
      env: definition.launch?.env ?? {},
      secretEnv,
      cwd: tmpdir(),
      ...(deps.spawn ? { spawn: deps.spawn } : {})
    })
  } catch (error) {
    return {
      ok: false,
      supported: true,
      protocol: 'pi-rpc',
      detail: `spawn failed: ${errorMessage(error)}`
    }
  }
  const client = new PiClient(process)
  try {
    const state = await client.getState(timeoutMs)
    const model = state.model
    const detail =
      [
        state.sessionId ? `session ${state.sessionId}` : undefined,
        model?.id ? `model ${model.provider ?? ''}/${model.id}` : undefined
      ]
        .filter(Boolean)
        .join(', ') || 'rpc channel answered'
    return { ok: true, supported: true, protocol: 'pi-rpc', detail }
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
        `get_state failed: ${errorMessage(error)}` +
        (stderrLine ? ` — stderr: ${stderrLine.slice(0, 200)}` : '')
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}
