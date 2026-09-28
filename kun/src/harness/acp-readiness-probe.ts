/**
 * ACP readiness probe (docs/ade impl P3-11): after `--version` proves the
 * binary exists, a real `initialize` handshake decides whether the agent can
 * actually serve turns. A binary that crashes, hangs, or speaks a different
 * protocol version reports `ready: 'no'` with a sanitized stderr summary —
 * installed but not ready — instead of failing the first real turn.
 */
import { tmpdir } from 'node:os'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import {
  startAcpProcess,
  type AcpProcess,
  type AcpSpawnFn
} from '../runtime/acp/acp-process.js'
import type { HarnessDefinition } from '../contracts/harness.js'

export const ACP_READINESS_TIMEOUT_MS = 10_000

export type AcpReadiness = { ready: 'yes' | 'no'; detail?: string }

export type AcpReadinessProbeDeps = {
  spawn?: AcpSpawnFn
  timeoutMs?: number
}

/** Never throws: every failure mode maps to `ready: 'no'` + a short detail. */
export async function probeAcpReadiness(
  definition: HarnessDefinition,
  command: string,
  deps: AcpReadinessProbeDeps = {}
): Promise<AcpReadiness> {
  let process: AcpProcess
  try {
    process = await startAcpProcess({
      command,
      args: definition.launch?.args ?? [],
      // No credential env: the handshake must reflect install health, not
      // the selected credential mode; auth requirements surface separately.
      env: definition.launch?.env ?? {},
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
    await conn.initialize({ timeoutMs: deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS })
    return { ready: 'yes' }
  } catch (error) {
    const parts = [errorMessage(error)]
    const stderr = process.sanitizedStderrTail()
    if (stderr) parts.push(`stderr: ${stderr}`)
    return { ready: 'no', detail: parts.join(' — ').slice(0, 400) }
  } finally {
    await conn.close().catch(() => undefined)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
