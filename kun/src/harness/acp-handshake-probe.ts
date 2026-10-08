/**
 * ACP handshake probe for `POST /v1/harnesses/:id/test` (docs/ade/impl/p4
 * §3.5, P4-10): unlike the readiness verdict (`acp-readiness-probe.ts`),
 * this keeps the `initialize` result so the Agent Center can show the
 * agent's name, version, capabilities, and auth methods.
 *
 * A failure names the protocol step that failed and keeps the JSON-RPC error
 * data. Engines that hide their causes (OpenCode's "Internal service
 * failure") get a clean-configuration retry and their own log evidence
 * through the provider module's `acp.isolationEnv` and `explainFailure`.
 */
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AcpConnection } from '../runtime/acp/acp-connection.js'
import { AcpClientHost } from '../runtime/acp/acp-client-host.js'
import {
  startAcpProcess,
  type AcpProcess,
  type AcpSpawnFn
} from '../runtime/acp/acp-process.js'
import { ACP_AGENT_METHODS, AcpError, AcpNewSessionResultSchema } from '../runtime/acp/acp-schema.js'
import { acpSessionCatalog } from './acp-model-catalog.js'
import type { HarnessModelCatalog } from '../contracts/harness-models.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { HarnessTestHandshake } from '../contracts/harness-test.js'
import {
  resolveHarnessSecretEnv,
  type HarnessSecretRefResolver
} from './harness-secret-env.js'
import { ACP_READINESS_TIMEOUT_MS } from './acp-readiness-probe.js'
import { raceProbeAbort } from './probe-abort.js'
import { nativeAgentLaunchEnv } from './native-agent-network.js'
import { providerModuleFor } from './providers/registry.js'
import type { AgentProviderModule, ProviderFailureContext } from './providers/provider-module.js'
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

type ProbeResult = Omit<HarnessTestHandshake, 'durationMs'> & { catalog?: HarnessModelCatalog }
type Stage = ProviderFailureContext['stage']
type Launch = {
  definition: HarnessDefinition
  command: string
  deps: AcpHandshakeProbeDeps
  signal: AbortSignal
  env: Record<string, string>
  secretEnv: Record<string, string>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** JSON-RPC error data is the only detail some engines attach; keep it short. */
function rpcErrorData(error: unknown): string {
  if (!(error instanceof AcpError) || !error.data || typeof error.data !== 'object') return ''
  if (Object.keys(error.data as object).length === 0) return ''
  return ` (data: ${JSON.stringify(error.data).slice(0, 160)})`
}

async function launchAcp(input: Launch): Promise<AcpProcess> {
  let pending: ReturnType<typeof startAcpProcess> | undefined
  try {
    input.signal.throwIfAborted()
    pending = startAcpProcess({
      harnessId: input.definition.id,
      signal: input.signal,
      command: input.command,
      args: input.definition.launch?.args ?? [],
      env: input.env,
      secretEnv: input.secretEnv,
      credentialEnv: input.deps.env,
      cwd: tmpdir(),
      spawn: input.deps.spawn
    })
    const child = await raceProbeAbort(pending, input.signal)
    input.signal.throwIfAborted()
    return child
  } catch (error) {
    // The launcher can settle after cancellation. Reclaim that late child too.
    void pending?.then((child) => child.stop(0).catch(() => undefined), () => undefined)
    throw error
  }
}

/**
 * Whether the engine can open a session without the user's configuration.
 * Only reached after a hidden failure; the verdict is advisory.
 */
async function isolatedSessionOutcome(
  launch: Launch,
  timeoutMs: number,
  message: string,
  isolationEnv: NonNullable<NonNullable<AgentProviderModule['acp']>['isolationEnv']>
): Promise<'passes' | 'fails' | undefined> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-acp-isolated-'))
  let conn: AcpConnection | undefined
  try {
    const overrides = isolationEnv({ dir, env: { ...process.env, ...launch.env }, message })
    if (!overrides) return undefined
    const workspace = join(dir, 'workspace')
    await mkdir(workspace)
    const child = await launchAcp({ ...launch, env: { ...launch.env, ...overrides } })
    conn = AcpConnection.start({ process: child, identity: 'handshake-probe-isolated' })
    new AcpClientHost().attach(conn)
    await raceProbeAbort(conn.initialize({ timeoutMs, fileWrites: launch.definition.acpClientWrites !== false }), launch.signal)
    await raceProbeAbort(conn.rpc.request(ACP_AGENT_METHODS.sessionNew, { cwd: workspace, mcpServers: [] }, { timeoutMs }), launch.signal)
    return 'passes'
  } catch (error) {
    if (launch.signal.aborted || (error instanceof AcpError && error.code === 'request_timeout')) return undefined
    return 'fails'
  } finally {
    await conn?.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function explainFailure(input: {
  launch: Launch
  timeoutMs: number
  startedAtMs: number
  stage: Stage
  error: unknown
  stderr: string | undefined
}): Promise<ProbeResult> {
  const { launch, stage, error } = input
  const module = providerModuleFor(launch.definition)
  const timedOut = error instanceof AcpError && error.code === 'request_timeout'
  const message = `${errorMessage(error)}${rpcErrorData(error)}`
  const parts = [stage === 'launch' ? `spawn failed: ${message}` : `${stage} failed: ${message}`]
  if (input.stderr) parts.push(`stderr: ${input.stderr}`)
  const detail = parts.join(' — ').slice(0, 400)
  const authRequired = isAcpAuthenticationRequired(error)
  const isolationEnv = module?.acp?.isolationEnv
  const isolated = isolationEnv && !authRequired && !timedOut && !launch.signal.aborted &&
    (stage === 'initialize' || stage === 'session/new')
    ? await isolatedSessionOutcome(launch, input.timeoutMs, message, isolationEnv)
    : undefined
  // An engine may know what a startup or auth error really means. The env
  // only locates its files; secrets never enter the explanation.
  const explained = module?.explainFailure?.(detail, authRequired, {
    stage, startedAtMs: input.startedAtMs, env: { ...process.env, ...(launch.definition.launch?.env ?? {}) },
    ...(isolated ? { isolated } : {})
  })
  const requiresLogin = explained ? explained.authRequired : authRequired
  return {
    ok: false,
    supported: true,
    protocol: 'acp',
    ...(requiresLogin ? { authRequired: true, authentication: 'missing' as const } : {}),
    detail: explained
      ? explained.detail
      : requiresLogin
        ? 'The Agent requires login. Sign in with its native CLI, then check and enable this profile again.'
        : timedOut
          ? `probe timed out after ${input.timeoutMs}ms`
          : detail
  }
}

/** Never throws: every failure mode maps to `ok:false` + a short detail. */
export async function probeAcpHandshake(
  definition: HarnessDefinition,
  command: string,
  deps: AcpHandshakeProbeDeps = {}
): Promise<ProbeResult> {
  const timeoutMs = deps.timeoutMs ?? ACP_READINESS_TIMEOUT_MS
  const signal = AbortSignal.any([
    ...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(timeoutMs)
  ])
  const startedAtMs = Date.now()
  const launch: Launch = { definition, command, deps, signal, env: {}, secretEnv: {} }
  let stage: Stage = 'launch'
  let child: AcpProcess | undefined
  let conn: AcpConnection | undefined
  let workspace: string | undefined
  try {
    signal.throwIfAborted()
    launch.secretEnv = await raceProbeAbort(resolveHarnessSecretEnv(definition, deps.resolveSecretEnv), signal)
    signal.throwIfAborted()
    // Initialize reports protocol health, never authenticated account state.
    // Same network fill as the real turn, so readiness and turns agree.
    launch.env = nativeAgentLaunchEnv(definition, { ...launch.secretEnv, ...deps.env })
    child = await launchAcp(launch)
    conn = AcpConnection.start({ process: child, identity: 'handshake-probe' })
    // Fail-closed mediation: client requests during the handshake get a
    // sessionUnavailable reply instead of touching a real workspace.
    new AcpClientHost().attach(conn)
    stage = 'initialize'
    const init = await raceProbeAbort(conn.initialize({ timeoutMs, fileWrites: definition.acpClientWrites !== false }), signal)
    signal.throwIfAborted()
    let models: string[] | undefined
    let catalog: HarnessModelCatalog | undefined
    let detail: string | undefined
    if (deps.includeModels || deps.session) {
      stage = 'session/new'
      workspace = await mkdtemp(join(tmpdir(), 'kun-acp-readiness-'))
      const raw = await raceProbeAbort(conn.rpc.request(ACP_AGENT_METHODS.sessionNew,
        { cwd: workspace, mcpServers: [] }, { timeoutMs }), signal)
      signal.throwIfAborted()
      const session = AcpNewSessionResultSchema.parse(raw)
      catalog = acpSessionCatalog(definition, session)
      if (deps.includeModels) models = catalog.models
      if (deps.session) {
        stage = 'model'
        await raceProbeAbort(applyAcpSessionModel(conn, { ...session, models: parseAcpLegacyModels(session.models) }, deps.session.model), signal)
        stage = 'permission'
        const agentsOnly = definition.nativeAgents === 'session-modes' && Boolean(deps.session.permissionMode) &&
          acpPermissionModeUnoffered(session, deps.session.permissionMode!, definition.acpPermission)
        const applyPermission = providerModuleFor(definition)?.acp?.applyPermission
        if (applyPermission) await raceProbeAbort(applyPermission(conn, session, deps.session.permissionMode), signal)
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
      ...(catalog ? { catalog } : {}),
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
    const stderr = child?.sanitizedStderrTail()
    // Close the failed engine before any diagnostic retry starts another one.
    await conn?.close().catch(() => undefined)
    conn = undefined
    return explainFailure({ launch, timeoutMs, startedAtMs, stage, error, stderr })
  } finally {
    await conn?.close().catch(() => undefined)
    if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}
