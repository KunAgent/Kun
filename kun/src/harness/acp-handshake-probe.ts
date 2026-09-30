/**
 * ACP handshake probe for `POST /v1/harnesses/:id/test` (docs/ade/impl/p4
 * §3.5, P4-10): unlike the readiness verdict (`acp-readiness-probe.ts`),
 * this keeps the `initialize` result so the Agent Center can show the
 * agent's name, version, capabilities, and auth methods.
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
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'
import { ACP_READINESS_TIMEOUT_MS } from './acp-readiness-probe.js'
import { raceProbeAbort } from './probe-abort.js'

export type AcpHandshakeProbeDeps = {
  spawn?: AcpSpawnFn
  timeoutMs?: number
  signal?: AbortSignal
  /** Resolves `launch.secretEnv` refs so the probe sees the real env (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never throws: every failure mode maps to `ok:false` + a short detail. */
export async function probeAcpHandshake(
  definition: HarnessDefinition,
  command: string,
  deps: AcpHandshakeProbeDeps = {}
): Promise<Omit<HarnessTestHandshake, 'durationMs'>> {
  const timeoutMs = deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS
  let process: AcpProcess
  try {
    const secretEnv = await resolveHarnessSecretEnv(definition, deps.resolveSecretEnv)
    process = await startAcpProcess({
      command,
      args: definition.launch?.args ?? [],
      // Same rule as the readiness probe: no credential env. The handshake
      // reports install health and available login methods, not account state.
      env: definition.launch?.env ?? {},
      secretEnv,
      cwd: tmpdir(),
      spawn: deps.spawn
    })
  } catch (error) {
    return {
      ok: false,
      supported: true,
      protocol: 'acp',
      detail: `spawn failed: ${errorMessage(error)}`
    }
  }
  const conn = AcpConnection.start({ process, identity: 'handshake-probe' })
  // Fail-closed mediation: client requests during the handshake get a
  // sessionUnavailable reply instead of touching a real workspace.
  new AcpClientHost().attach(conn)
  try {
    const init = await raceProbeAbort(conn.initialize({ timeoutMs }), deps.signal)
    const caps = init.agentCapabilities
    const mcpTransports = [
      ...(caps?.mcpCapabilities?.stdio ? ['stdio'] : []),
      ...(caps?.mcpCapabilities?.http ? ['http'] : [])
    ]
    return {
      ok: true,
      supported: true,
      protocol: 'acp',
      protocolVersion: init.protocolVersion,
      ...(init.agentInfo?.name || init.agentInfo?.version
        ? {
            agent: {
              ...(init.agentInfo.name ? { name: init.agentInfo.name } : {}),
              ...(init.agentInfo.version ? { version: init.agentInfo.version } : {})
            }
          }
        : {}),
      capabilities: {
        ...(caps?.loadSession !== undefined ? { sessionResume: caps.loadSession } : {}),
        ...(caps?.promptCapabilities?.image !== undefined
          ? { imageInput: caps.promptCapabilities.image }
          : {}),
        ...(mcpTransports.length > 0 ? { mcpTransports } : {})
      },
      ...(init.authMethods?.length
        ? {
            authMethods: init.authMethods.map((method) => ({
              id: method.id,
              ...(method.name ? { name: method.name } : {})
            }))
          }
        : {})
    }
  } catch (error) {
    const parts = [errorMessage(error)]
    const stderr = process.sanitizedStderrTail()
    if (stderr) parts.push(`stderr: ${stderr}`)
    const detail = parts.join(' — ').slice(0, 400)
    return {
      ok: false,
      supported: true,
      protocol: 'acp',
      detail:
        error instanceof AcpError && error.code === 'request_timeout'
          ? `probe timed out after ${timeoutMs}ms`
          : detail
    }
  } finally {
    await conn.close().catch(() => undefined)
  }
}
