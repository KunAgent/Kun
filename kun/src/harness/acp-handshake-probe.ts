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
import { ACP_AGENT_METHODS, AcpError, AcpNewSessionResultSchema } from '../runtime/acp/acp-schema.js'
import { acpModelCatalog } from './acp-model-catalog.js'
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
  /** Resolved selected-profile environment; overrides definition secrets. */
  env?: Record<string, string>
  /** Optional local session metadata; never sends a prompt or authenticates. */
  includeModels?: boolean
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
  const signal = AbortSignal.any([
    ...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(timeoutMs)
  ])
  let process: AcpProcess
  let pending: ReturnType<typeof startAcpProcess> | undefined
  try {
    signal.throwIfAborted()
    const secretEnv = await raceProbeAbort(resolveHarnessSecretEnv(definition, deps.resolveSecretEnv), signal)
    signal.throwIfAborted()
    pending = startAcpProcess({
      harnessId: definition.id,
      signal,
      command,
      args: definition.launch?.args ?? [],
      // Initialize reports protocol health, never authenticated account state.
      env: definition.launch?.env ?? {},
      secretEnv,
      credentialEnv: deps.env,
      cwd: tmpdir(),
      spawn: deps.spawn
    })
    process = await raceProbeAbort(pending, signal)
    signal.throwIfAborted()
  } catch (error) {
    // The launcher can settle after cancellation. Reclaim that late child too.
    void pending?.then((child) => child.stop(0).catch(() => undefined), () => undefined)
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
    const init = await raceProbeAbort(conn.initialize({ timeoutMs }), signal)
    signal.throwIfAborted()
    let models: string[] | undefined
    if (deps.includeModels) {
      const raw = await raceProbeAbort(conn.rpc.request(ACP_AGENT_METHODS.sessionNew,
        { cwd: tmpdir(), mcpServers: [] }, { timeoutMs }), signal)
      signal.throwIfAborted()
      const session = AcpNewSessionResultSchema.parse(raw)
      models = acpModelCatalog({ harnessId: definition.id, ...session }).models
    }
    const caps = init.agentCapabilities
    const mcpTransports = [
      ...(caps?.mcpCapabilities?.stdio ? ['stdio'] : []),
      ...(caps?.mcpCapabilities?.http ? ['http'] : [])
    ]
    return {
      ok: true,
      supported: true,
      protocol: 'acp',
      authentication: 'unverified',
      ...(models ? { models } : {}),
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
