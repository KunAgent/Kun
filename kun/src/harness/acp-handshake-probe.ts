/**
 * ACP handshake probe for `POST /v1/harnesses/:id/test` (docs/ade/impl/p4
 * §3.5, P4-10): unlike the readiness verdict (`acp-readiness-probe.ts`),
 * this keeps the `initialize` result so the Agent Center can show the
 * agent's name, version, capabilities, and auth methods.
 */
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
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
import { nativeAgentLaunchEnv } from './native-agent-network.js'
import { applyDevinSessionPermission } from '../runtime/acp/devin-session-permissions.js'
import { acpPermissionModeUnoffered, applyAcpSessionPermission } from '../runtime/acp/acp-session-permissions.js'
import { applyAcpSessionModel, parseAcpLegacyModels } from '../runtime/acp/acp-legacy-models.js'
import { isAcpAuthenticationRequired } from '../runtime/acp/acp-authentication.js'

export type AcpHandshakeProbeDeps = {
  spawn?: AcpSpawnFn
  timeoutMs?: number
  signal?: AbortSignal
  /** Resolved selected-profile environment; overrides definition secrets. */
  env?: Record<string, string>
  /** Optional local session metadata; never sends a prompt or authenticates. */
  includeModels?: boolean
  /** Exercise the same pre-prompt model/mode setup as a real turn, without inference. */
  session?: { model?: string; permissionMode?: string }
  /** Resolves `launch.secretEnv` refs so the probe sees the real env (P4-12). */
  resolveSecretEnv?: HarnessSecretRefResolver
}

/**
 * OpenCode 1 refuses a shared opencode.db that OpenCode2 created first (it has
 * session_v2 but no session table). Only the user may move that file.
 */
function knownStartupFailure(message: string): string | undefined {
  return /has no session table/i.test(message)
    ? 'OpenCode cannot open its database: opencode.db in its data directory (usually ~/.local/share/opencode) was created by OpenCode2 without the session table OpenCode needs. Back it up, move it out of that directory together with its -wal and -shm files, then check again; OpenCode recreates it and OpenCode2 can use the new file.'
    : undefined
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
      // Same network fill as the real turn, so readiness and turns agree.
      env: nativeAgentLaunchEnv(definition, { ...secretEnv, ...deps.env }),
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
      detail: knownStartupFailure(errorMessage(error)) ?? `spawn failed: ${errorMessage(error)}`
    }
  }
  const conn = AcpConnection.start({ process, identity: 'handshake-probe' })
  let workspace: string | undefined
  // Fail-closed mediation: client requests during the handshake get a
  // sessionUnavailable reply instead of touching a real workspace.
  new AcpClientHost().attach(conn)
  try {
    const init = await raceProbeAbort(conn.initialize({ timeoutMs }), signal)
    signal.throwIfAborted()
    let models: string[] | undefined
    let detail: string | undefined
    if (deps.includeModels || deps.session) {
      workspace = await mkdtemp(join(tmpdir(), 'kun-acp-readiness-'))
      const raw = await raceProbeAbort(conn.rpc.request(ACP_AGENT_METHODS.sessionNew,
        { cwd: workspace, mcpServers: [] }, { timeoutMs }), signal)
      signal.throwIfAborted()
      const session = AcpNewSessionResultSchema.parse(raw)
      if (deps.includeModels) models = acpModelCatalog({ harnessId: definition.id, ...session }).models
      if (deps.session) {
        await raceProbeAbort(applyAcpSessionModel(conn, { ...session, models: parseAcpLegacyModels(session.models) }, deps.session.model), signal)
        const agentsOnly = definition.nativeAgents === 'session-modes' && Boolean(deps.session.permissionMode) &&
          acpPermissionModeUnoffered(session, deps.session.permissionMode!, definition.acpPermission)
        if (definition.id === 'devin') await raceProbeAbort(applyDevinSessionPermission(conn, session, deps.session.permissionMode), signal)
        // The session still works through an explicitly picked native Agent;
        // Auto turns keep failing closed in applyAcpSessionPermission.
        else if (agentsOnly) detail = 'The Agent replaced its permission modes with its own Agents; pick one in the composer'
        else await raceProbeAbort(applyAcpSessionPermission(conn, session, deps.session.permissionMode, definition.acpPermission), signal)
      }
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
      ...(detail ? { detail } : {}),
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
    // Gemini CLI 0.52 reports Google's retirement of the individual Code
    // Assist tier with the auth-required code; signing in cannot fix that.
    const retired = isAcpAuthenticationRequired(error) && /no longer supported/i.test(errorMessage(error))
    const authRequired = isAcpAuthenticationRequired(error) && !retired
    const startupFailure = knownStartupFailure(detail)
    return {
      ok: false,
      supported: true,
      protocol: 'acp',
      ...(authRequired ? { authRequired: true, authentication: 'missing' as const } : {}),
      detail:
        retired
          ? `The Agent's service no longer supports this client; signing in will not help: ${errorMessage(error).slice(0, 240)}`
          : authRequired
          ? 'The Agent requires login. Sign in with its native CLI, then check and enable this profile again.'
          : startupFailure
          ? startupFailure
          : error instanceof AcpError && error.code === 'request_timeout'
          ? `probe timed out after ${timeoutMs}ms`
          : detail
    }
  } finally {
    await conn.close().catch(() => undefined)
    if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}
