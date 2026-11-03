import { z, type ZodType } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  ApprovalDecisionResponse,
  AttachmentReleaseResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  BackgroundShellListResponse,
  BackgroundShellRecord,
  BackgroundShellStopResponse,
  ClearThreadGoalResponse,
  ClearThreadTodosResponse,
  CompactResponse,
  ClaudeSdkInstallStatusSchema,
  CreateThreadRequest,
  DeleteThreadResponse,
  ForkThreadRequest,
  GraphRunStatusSchema,
  GraphRunV1Schema,
  ListThreadsResponse,
  ModelConnectionConnectRequestSchema,
  ModelConnectionCliAuthRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionOAuthStartRequestSchema,
  ModelConnectionOAuthStatusSchema,
  ModelConnectionOAuthSubmitRequestSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  ModelConnectionSnapshotSchema,
  McpServerConfig,
  MemoryCreateRequest,
  MemoryRecord,
  MemoryUpdateRequest,
  RuntimeInfoResponse,
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse,
  ReplaceSteeringRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  StartTurnRequest,
  StartTurnResponse,
  SteeringQueueResponse,
  ThreadGoalResponse,
  ThreadSchema,
  ThreadTodosResponse,
  ThreadUsageResponseSchema,
  ProviderQuotaListResponseSchema,
  UpdateThreadRequest,
  UserInputAnswerSchema,
  type ApprovalDecisionRequest,
  type CreateThreadRequest as CreateThreadRequestValue,
  type RuntimeEvent as RuntimeEventValue,
  type StartTurnRequest as StartTurnRequestValue,
  type ThreadRecord,
  type ThreadSummary
} from '../contracts/index.js'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../server/approval-consent.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import { readRuntimeDiscovery, type RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { runtimeDiscoveryDirectory } from '../cli/shared-runtime.js'
import {
  startClientOwnedRuntime,
  type ClientOwnedRuntimeHandle
} from '../cli/client-owned-runtime.js'
import {
  allowsDevelopmentManagerBootstrap,
  runtimeBuildIdForFlavor
} from '../cli/runtime-flavor.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import type { TuiOptions } from './options.js'
import { defaultKunControlDir } from '../manager/manager-discovery.js'
import { ensureServiceManager } from '../manager/manager-client.js'
import { IncrementalSseParser, parseRuntimeEventFrame } from './sse.js'
import { TuiClientError, type TuiConnection } from './client-types.js'
import { KunTuiClient } from './kun-tui-client.js'
import { createOwnedServiceManagerSession } from '../manager/owned-service-manager-session.js'
import { shutdownOwnedProcesses } from '../process/owned-process.js'

export async function resolveTuiConnection(
  options: TuiOptions,
  fetchImpl: typeof fetch = fetch,
  deps?: {
    expectedBuildId?: string
    startOwnedRuntime?: typeof startClientOwnedRuntime
  }
): Promise<TuiConnection> {
  if (options.url) {
    return validateConnection({
      baseUrl: options.url,
      runtimeToken: options.runtimeToken,
      discovered: false
    }, fetchImpl)
  }

  const runtimeFlavor = options.runtimeFlavor ?? 'production'
  const sourceBuildId = deps?.expectedBuildId ?? await readRuntimeBuildIdForEntry(import.meta.url)
  const expectedBuildId = runtimeBuildIdForFlavor(
    sourceBuildId,
    runtimeFlavor
  )
  const startOwnedRuntime = deps?.startOwnedRuntime ?? startClientOwnedRuntime
  const controlDir = process.env.KUN_MANAGER_CONTROL_DIR?.trim() || defaultKunControlDir()
  const managerSettingsPath = process.env.KUN_MANAGER_SETTINGS_PATH?.trim()
  const startExpectedRuntime = async (): Promise<TuiConnection> => {
    const managerSession = deps?.startOwnedRuntime ? undefined : createOwnedServiceManagerSession({ ownerKind: 'tui' })
    try {
      const manager = deps?.startOwnedRuntime
        ? undefined
        : await managerSession!.ensure({
            flavor: runtimeFlavor,
            allowDevelopmentBootstrap: allowsDevelopmentManagerBootstrap({
              flavor: runtimeFlavor,
              env: process.env
            }),
            controlDir,
            dataDir: options.dataDir,
            ...(managerSettingsPath ? { settingsPath: managerSettingsPath } : {}),
            fetch: fetchImpl
          })
      const owned: ClientOwnedRuntimeHandle = await startOwnedRuntime({
        dataDir: options.dataDir,
        ownerKind: 'tui',
        fetch: fetchImpl,
        runtimeFlavor,
        controlDir,
        ...(manager ? { manager } : {}),
        ...(sourceBuildId ? { expectedBuildId: sourceBuildId } : {})
      })
      const started = owned.connection
      return {
        baseUrl: started.discovery.baseUrl,
        runtimeToken: started.discovery.runtimeToken,
        runtimeInfo: started.info,
        discovered: true,
        ownedRuntime: managerSession ? {
          ...owned,
          stop: async () => {
            const stopped = await owned.stop()
            if (!stopped) throw new Error('TUI-owned Runtime did not exit; preserving Manager ownership')
            await managerSession.close()
            await shutdownOwnedProcesses({ timeoutMs: 5_000 })
            return true
          }
        } : owned
      }
    } catch (error) {
      await managerSession?.close()
      if (managerSession) await shutdownOwnedProcesses({ timeoutMs: 5_000 })
      throw error
    }
  }
  const discoveryDir = runtimeDiscoveryDirectory(options.dataDir, runtimeFlavor, controlDir)
  /** Attach to the Runtime named by discovery, requiring the same application build. */
  const attachToDiscovered = async (discovery: RuntimeDiscoveryRecord): Promise<TuiConnection> => {
    const connection = await validateConnection({
      baseUrl: discovery.baseUrl.replace(/\/$/, ''),
      runtimeToken: options.runtimeToken || discovery.runtimeToken,
      discovered: true,
      discovery
    }, fetchImpl)
    const buildMatches = !expectedBuildId || (
      discovery.buildId === expectedBuildId &&
      connection.runtimeInfo.buildId === expectedBuildId
    )
    if (buildMatches) return connection
    throw new TuiClientError(
      'Kun runtime discovery belongs to a different application build; restart the owning client.',
      undefined,
      'runtime_build_mismatch'
    )
  }
  const discovery = await readRuntimeDiscovery(discoveryDir, runtimeFlavor).catch(() => null)
  if (discovery) {
    assertSafeDiscovery(discovery)
    if (!options.noStart) return startOrAttachToOwner(startExpectedRuntime, async () => {
      const current = await readRuntimeDiscovery(discoveryDir, runtimeFlavor).catch(() => null)
      if (!current) return undefined
      assertSafeDiscovery(current)
      return {
        ownerKind: current.clientOwnerKind,
        pid: current.pid,
        connect: async () => ({
          ...(await attachToDiscovered(current)),
          attached: { ...(current.clientOwnerKind ? { ownerKind: current.clientOwnerKind } : {}), pid: current.pid }
        })
      }
    })
    try {
      return await attachToDiscovered(discovery)
    } catch (error) {
      if (error instanceof TuiClientError && error.code === 'runtime_build_mismatch') {
        throw error
      }
      throw new TuiClientError(
        `Kun runtime discovery is stale or unavailable in ${options.dataDir}; restart the owning client or remove --no-start to start a TUI-owned Runtime.`,
        error instanceof TuiClientError ? error.status : undefined,
        'stale_runtime_discovery'
      )
    }
  }
  if (options.noStart) {
    throw new TuiClientError(
      `No reachable Kun runtime was found in ${options.dataDir}; the client that owned it may have exited. Restart kun without --no-start, or run kun serve.`,
      undefined,
      'runtime_unavailable'
    )
  }
  return startOrAttachToOwner(startExpectedRuntime, async () => undefined)
}

const OWNER_BUSY_CODES = new Set(['app_session_owner_busy', 'client_runtime_owner_busy'])

/**
 * Start a TUI-owned Runtime; when another live client already owns the
 * profile, use that client's Runtime instead of failing. Only an ownership
 * refusal triggers the fallback, and only a verified live Runtime of the same
 * build qualifies, so every other failure keeps its original error. The
 * attached Runtime stays owned by its client: the TUI neither stops nor
 * replaces it.
 */
async function startOrAttachToOwner(
  start: () => Promise<TuiConnection>,
  findOwner: () => Promise<{ ownerKind?: string; pid: number; connect(): Promise<TuiConnection> } | undefined>
): Promise<TuiConnection> {
  try {
    return await start()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code !== 'string' || !OWNER_BUSY_CODES.has(code)) throw error
    const owner = await findOwner().catch(() => undefined)
    if (!owner) throw error
    try {
      return await owner.connect()
    } catch (attachError) {
      const reason = attachError instanceof TuiClientError && attachError.code === 'runtime_build_mismatch'
        ? ' Its Runtime is a different application build, so the TUI cannot attach to it.'
        : ' Its Runtime did not answer, so the TUI cannot attach to it.'
      throw new TuiClientError(
        `${error instanceof Error ? error.message : String(error)}${reason}`,
        undefined,
        attachError instanceof TuiClientError && attachError.code === 'runtime_build_mismatch'
          ? 'runtime_build_mismatch'
          : 'runtime_owner_unreachable'
      )
    }
  }
}

async function validateConnection(
  input: {
    baseUrl: string
    runtimeToken: string
    discovered: boolean
    discovery?: RuntimeDiscoveryRecord
  },
  fetchImpl: typeof fetch
): Promise<TuiConnection> {
  const client = new KunTuiClient({
    baseUrl: input.baseUrl,
    runtimeToken: input.runtimeToken,
    fetch: fetchImpl
  })
  const runtimeInfo = await client.runtimeInfo()
  if (input.discovery) {
    if (runtimeInfo.pid !== undefined && runtimeInfo.pid !== input.discovery.pid) {
      throw new TuiClientError('discovered runtime process does not match the live server')
    }
    if (runtimeInfo.startedAt !== input.discovery.startedAt) {
      throw new TuiClientError('discovered runtime start time does not match the live server')
    }
    if (runtimeInfo.instanceId !== input.discovery.instanceId) {
      throw new TuiClientError('discovered runtime instance does not match the live server')
    }
  }
  return {
    baseUrl: input.baseUrl,
    runtimeToken: input.runtimeToken,
    runtimeInfo,
    discovered: input.discovered
  }
}

function assertSafeDiscovery(record: RuntimeDiscoveryRecord): void {
  let url: URL
  try {
    url = new URL(record.baseUrl)
  } catch {
    throw new TuiClientError('runtime discovery contains an invalid URL', undefined, 'unsafe_runtime_discovery')
  }
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new TuiClientError('runtime discovery must reference a loopback HTTP endpoint', undefined, 'unsafe_runtime_discovery')
  }
}
