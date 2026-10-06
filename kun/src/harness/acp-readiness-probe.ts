/**
 * ACP readiness probe (docs/ade impl P3-11, relaxed in P4-03): after
 * `--version` proves the binary exists, a real `initialize` handshake
 * decides whether the agent can actually serve turns.
 *
 * Verdicts are tiered:
 * - `yes` — the handshake completed.
 * - `no` — the process crashed, could not spawn, or answered with an
 *   unsupported protocol; the harness genuinely cannot serve turns.
 * - `unknown` — the handshake timed out (slow cold start, loaded host);
 *   the UI should offer a retry instead of pinning the harness disabled.
 */
import { tmpdir } from 'node:os'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import {
  startAcpProcess,
  type AcpProcess,
  type AcpSpawnFn
} from '../runtime/acp/acp-process.js'
import { AcpError } from '../runtime/acp/acp-schema.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'

// P4-03: 10s misjudged cold ACP starts (Gemini needed ~8.6s alone, worse
// under parallel probes). OpenCode bootstraps its config directory on the
// first run after an install or upgrade (~32s measured on 1.1.47), so allow
// a full minute; checks run in the background and never block the list.
export const ACP_READINESS_TIMEOUT_MS = 60_000

export type AcpReadiness = { ready: 'yes' | 'no' | 'unknown'; detail?: string }

export type AcpReadinessProbeDeps = {
  spawn?: AcpSpawnFn
  timeoutMs?: number
  /** Resolves `launch.secretEnv` refs so the probe sees the real env (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
}

/** Never throws: every failure mode maps to a verdict + a short detail. */
export async function probeAcpReadiness(
  definition: HarnessDefinition,
  command: string,
  deps: AcpReadinessProbeDeps = {}
): Promise<AcpReadiness> {
  const timeoutMs = deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS
  let process: AcpProcess
  try {
    const secretEnv = await resolveHarnessSecretEnv(definition, deps.resolveSecretEnv)
    process = await startAcpProcess({
      harnessId: definition.id,
      command,
      args: definition.launch?.args ?? [],
      // No credential env: the handshake must reflect install health, not
      // the selected credential mode; auth requirements surface separately.
      env: definition.launch?.env ?? {},
      secretEnv,
      cwd: tmpdir(),
      spawn: deps.spawn
    })
  } catch (error) {
    return { ready: 'no', detail: `spawn failed: ${errorMessage(error)}` }
  }
  const conn = AcpConnection.start({ process, identity: 'readiness' })
  // Fail-closed mediation: any client request during the handshake gets a
  // sessionUnavailable reply instead of touching the real workspace.
  new AcpClientHost().attach(conn)
  try {
    await conn.initialize({ timeoutMs })
    return { ready: 'yes' }
  } catch (error) {
    const parts = [errorMessage(error)]
    const stderr = process.sanitizedStderrTail()
    if (stderr) parts.push(`stderr: ${stderr}`)
    const detail = parts.join(' — ').slice(0, 400)
    // A timeout means "no answer yet", not "cannot answer" — a heavy cold
    // start under parallel probes must not mark the harness unavailable.
    if (error instanceof AcpError && error.code === 'request_timeout') {
      return { ready: 'unknown', detail: `probe timed out after ${timeoutMs}ms` }
    }
    return { ready: 'no', detail }
  } finally {
    await conn.close().catch(() => undefined)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
