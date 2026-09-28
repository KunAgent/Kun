/**
 * AcpRuntime plumbing helpers kept out of the runtime class: connection
 * acquisition (spawn → attach → exit marking → initialize), mediation-root
 * resolution, image decoding, the ensure-once workspace checkpoint gate, and
 * the session-binding commit.
 */
import type { Turn } from '../../contracts/turns.js'
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../../contracts/harness.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { TurnService } from '../../services/turn-service.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { TurnHandoff } from '../../handoff/turn-handoff.js'
import { buildHarnessEnv } from '../../harness/harness-env.js'
import { resolvePathThroughSymlinks } from '../../adapters/tool/workspace-path.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import { AcpConnection } from './acp-connection.js'
import type {
  AcpConnectionLease,
  AcpConnectionPool
} from './acp-connection-pool.js'
import type { AcpClientHost } from './acp-client-host.js'
import type { AcpSessionManager, AcpSessionHandle } from './acp-session-manager.js'
import { filterGoalContextsForGoalKey } from '../../loop/continuation-instructions.js'
import { startAcpProcess, type AcpSpawnFn } from './acp-process.js'
import { AcpError, type AcpInitializeResult } from './acp-schema.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import {
  capabilitiesFromAcp,
  type AcpSessionFacts
} from './acp-capabilities.js'
import { acpLegacyCapabilities } from './acp-runtime-support.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'

export type AcpLifecycleDeps = {
  binaryPath?: (harnessId: HarnessId) => string | undefined
  /** Extra env keys to strip from the harness child beyond the shared denylist. */
  stripEnv?: readonly string[]
  spawn?: AcpSpawnFn
  debug?: AcpDebugLog
}

/**
 * Pool-acquire a connection: spawn the launch command, attach the client-host
 * handlers, register exit marking so hosted bindings rebase on process death,
 * and run the initialize handshake. Non-retriable startup failures close the
 * connection before they reach the caller.
 */
export async function acquireAcpConnection(
  deps: AcpLifecycleDeps,
  pool: AcpConnectionPool,
  host: AcpClientHost,
  sessions: AcpSessionManager,
  input: {
    poolKey: string
    definition: HarnessDefinition
    credentialEnv: Record<string, string>
    identity: string
    workspace: string
    signal: AbortSignal
  }
): Promise<AcpConnectionLease> {
  return pool.acquire(input.poolKey, async () => {
    const command =
      deps.binaryPath?.(input.definition.id) ?? input.definition.launch?.command ?? ''
    if (!command) {
      throw new Error(`harness ${input.definition.id} has no launch command`)
    }
    const process = await startAcpProcess({
      command,
      args: input.definition.launch?.args ?? [],
      env: input.definition.launch?.env ?? {},
      credentialEnv: input.credentialEnv,
      stripEnv: acpStripEnv(deps, input.definition, input.credentialEnv),
      cwd: input.workspace,
      spawn: deps.spawn
    })
    const conn = AcpConnection.start({
      process,
      identity: input.identity,
      debug: deps.debug
    })
    host.attach(conn)
    // Hosted bindings must be rebased if this process dies (§4.3).
    const detachExit = pool.onExit(input.poolKey, () => {
      detachExit()
      void sessions
        .handleConnectionExit(conn, input.definition.id)
        .catch(() => undefined)
    })
    if (input.signal.aborted) {
      await conn.close().catch(() => undefined)
      throw new AcpError('request_aborted', 'turn aborted before initialize')
    }
    try {
      await conn.initialize()
    } catch (error) {
      await conn.close().catch(() => undefined)
      throw error
    }
    return conn
  })
}

/**
 * Strip keys for an ACP child (spawn or mediated terminal). In gateway mode
 * the child must not inherit provider secrets the generated config replaces.
 */
function acpStripEnv(
  deps: Pick<AcpLifecycleDeps, 'stripEnv'>,
  definition: HarnessDefinition,
  credentialEnv: Record<string, string>
): readonly string[] {
  return [
    ...(deps.stripEnv ?? []),
    ...(Object.keys(credentialEnv).length > 0
      ? (definition.gateway?.stripEnv ?? [])
      : [])
  ]
}

/** The scoped env a mediated terminal sees — identical to the agent's. */
export function acpChildEnv(
  deps: Pick<AcpLifecycleDeps, 'stripEnv'>,
  definition: HarnessDefinition,
  credentialEnv: Record<string, string>
): NodeJS.ProcessEnv {
  return buildHarnessEnv({
    base: process.env,
    strip: acpStripEnv(deps, definition, credentialEnv),
    add: { ...(definition.launch?.env ?? {}), ...credentialEnv }
  }) as NodeJS.ProcessEnv
}

/**
 * Physical mediation roots. `allowed` replaces the set for delegated child
 * scopes — a child with restricted paths sees only those roots, so a scoped
 * agent can never mediate outside its declared boundary.
 */
export async function resolveAcpRoots(
  roots: readonly string[],
  allowed?: readonly string[]
): Promise<string[]> {
  if (allowed?.length) {
    const narrowed: string[] = []
    for (const path of allowed) {
      try {
        narrowed.push(await resolvePathThroughSymlinks(path))
      } catch {
        // Unresolvable child-scope roots contribute no coverage.
      }
    }
    return narrowed
  }
  const physical: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    try {
      const resolved = await resolvePathThroughSymlinks(root)
      if (!seen.has(resolved)) {
        seen.add(resolved)
        physical.push(resolved)
      }
    } catch {
      // Missing roots contribute no coverage rather than failing the turn.
    }
  }
  return physical
}

/** Image payloads for the prompt when the agent advertises image input. */
export async function resolveAcpImages(
  attachmentStore: AttachmentStore | undefined,
  threadId: string,
  workspace: string,
  attachmentIds: readonly string[],
  imageCapable: boolean
): Promise<{ mediaType: string; base64: string }[]> {
  if (!imageCapable || !attachmentStore || !attachmentIds.length) return []
  const images: { mediaType: string; base64: string }[] = []
  for (const id of attachmentIds) {
    try {
      const attachment = await attachmentStore.resolveContent(id, {
        threadId,
        workspace
      })
      if (attachment.mimeType?.startsWith('image/')) {
        images.push({
          mediaType: attachment.mimeType,
          base64: attachment.data.toString('base64')
        })
      }
    } catch {
      // Unresolvable attachments fall back to the path hint.
    }
  }
  return images
}

/** Ensure-once checkpoint gate for the first mutating mediated call. */
export function acpCheckpointGate(
  deps: {
    turns: Pick<TurnService, 'updateTurnMetadata' | 'updateItem'>
    awaitWorkspaceCheckpoint?: (
      checkpointRequestId: string,
      signal: AbortSignal
    ) => Promise<string | null>
  },
  threadId: string,
  turnId: string,
  turn: Turn,
  signal: AbortSignal
): (() => Promise<void>) | undefined {
  const requestId = turn.workspaceCheckpointRequestId?.trim()
  const awaitCheckpoint = deps.awaitWorkspaceCheckpoint
  if (!requestId || !awaitCheckpoint) return undefined
  let gate: Promise<void> | undefined
  return async () => {
    gate ??= (async () => {
      const checkpointId = await awaitCheckpoint(requestId, signal)
      if (!checkpointId) return
      await deps.turns.updateTurnMetadata(threadId, turnId, {
        workspaceCheckpointId: checkpointId
      })
      await deps.turns.updateItem(threadId, `item_${turnId}_user`, {
        workspaceCheckpointId: checkpointId
      })
    })()
    await gate
  }
}

/** Persist the session binding after the turn (best-effort; §5.1). */
export async function commitAcpSession(
  sessions: AcpSessionManager,
  sessionStore: Pick<SessionStore, 'loadItems'>,
  session: AcpSessionHandle,
  goalContextKeyForHistory: string | null | undefined,
  threadId: string,
  turnId: string,
  turnHandoff: TurnHandoff | undefined
): Promise<void> {
  try {
    await sessions.commit(session, {
      committedItems: filterGoalContextsForGoalKey(
        await sessionStore.loadItems(threadId),
        goalContextKeyForHistory
      ),
      lastCommittedTurnId: turnId,
      handoffBriefDigest: turnHandoff?.brief.digest
    })
  } catch {
    // Portable history stays authoritative if the binding cannot be saved.
  }
}

export function delegatedPhase(
  preparation: DelegatedSessionPreparation
): 'portable' | 'resumed' | 'rebased' {
  if (preparation.resumed) return 'resumed'
  return preparation.rebaseReason ? 'rebased' : 'portable'
}

/** Record the `delegated_runtime` event for an ACP turn (phase + caps v2). */
export async function recordAcpDelegatedRuntime(
  events: Pick<RuntimeEventRecorder, 'record'>,
  input: {
    threadId: string
    turnId: string
    harnessId: HarnessId
    preparation: DelegatedSessionPreparation
    initResult: AcpInitializeResult | undefined
    session: AcpSessionFacts
    sandbox: 'host' | 'native' | 'none'
  }
): Promise<void> {
  await events.record({
    kind: 'delegated_runtime',
    threadId: input.threadId,
    turnId: input.turnId,
    providerKind: 'acp',
    providerId: input.harnessId,
    harnessId: input.harnessId,
    phase: delegatedPhase(input.preparation),
    ...(input.preparation.rebaseReason
      ? { reason: input.preparation.rebaseReason }
      : {}),
    capabilities: {
      ...acpLegacyCapabilities(),
      // Legacy bag mirrors v2 honesty: only a delivered descriptor counts.
      kunTools:
        input.session.kunToolsDescriptor === 'http' ||
        input.session.kunToolsDescriptor === 'stdio'
    },
    capabilitiesV2: capabilitiesFromAcp(input.initResult, input.session, {
      sandbox: input.sandbox
    })
  })
}
