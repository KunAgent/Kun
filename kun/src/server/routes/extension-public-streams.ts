import { createHash, randomUUID } from 'node:crypto'
import { basename, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  AccountSchema,
  AgentCreateRunRequestSchema,
  AgentRunEventSchema,
  AgentRunSchema,
  AgentSteerRequestSchema,
  ExtensionContributionsSchema,
  ExtensionIdSchema,
  EXTENSION_VIEW_SAFE_METHODS,
  HostMessageSchema,
  JsonValueSchema,
  LocaleSchema,
  MANIFEST_CONTRIBUTION_PERMISSION_REQUIREMENTS,
  ManifestLocaleTagSchema,
  MediaMetadataSchema,
  ProviderBindingSchema,
  ThemeSchema,
  hasPermission,
  resolveExtensionManifestLocale,
  type AgentRun,
  type AgentRunEvent,
  type ExtensionContributions,
  type ExtensionManifest,
  type JsonValue,
  type ModelProviderDeclaration,
  type ProviderModel
} from '@kun/extension-api'
import { redactSecretText } from '../../config/secret-redaction.js'
import type { ExtensionProviderDefinition } from '../../contracts/extension-providers.js'
import type {
  DevelopmentExtensionRecord,
  ExtensionRegistryEntry,
  InstalledExtensionVersion
} from '../../extensions/index.js'
import {
  extensionProviderBindingScope,
  extensionProviderId
} from '../../services/extension-provider-account-store.js'
import { requiredExtensionBrokerPermission } from '../../services/extension-host-broker.js'
import { ExtensionConfigurationConflictError } from '../../services/extension-configuration-service.js'
import {
  ExtensionMediaHandleError,
  type MediaHandleProjection
} from '../../services/extension-media-handle-service.js'
import {
  ExtensionBrokerError,
  type ExtensionAgentEvent,
  type ExtensionAgentRun,
  type ExtensionAgentSubscription,
  type ExtensionOwnedThread,
  type ExtensionPrincipal
} from '../../services/extension-agent-service.js'
import {
  ExtensionViewSessionError,
  type ExtensionViewSessionEvent,
  type ExtensionViewSessionTarget
} from '../../services/extension-view-session-service.js'
import { bearerToken, isRuntimeTokenAuthorized } from '../auth.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { Router, type RouteContext, type RouteHandler } from '../router.js'
import type { ExtensionPlatformRuntime, ServerRuntime } from './server-runtime.js'
import { ERRORS } from './runtime-error.js'
import {
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER,
  MAX_EXTENSION_VIEW_BODY_BYTES,
  MAX_EXTENSION_AGENT_BODY_BYTES,
  DEFAULT_EVENT_LIMIT,
  MAX_EVENT_LIMIT,
  HEARTBEAT_INTERVAL_MS,
  SessionIdSchema,
  RunIdSchema,
  ThreadIdSchema,
  ProviderIdSchema,
  LocalProviderIdSchema,
  AccountIdSchema,
  WorkspaceRootSchema,
  CreateViewSessionSchema,
  QualifiedSettingContributionSchema,
  ConfigurationSnapshotRequestSchema,
  ConfigurationUpdateRequestSchema,
  WorkbenchEnvironmentSchema,
  ViewBrokerRequestSchema,
  ViewRequestIdSchema,
  InvokeExtensionCommandSchema,
  ManagedAccountSessionSchema,
  ManagedProviderCatalogQuerySchema,
  ManagedProviderModelsQuerySchema,
  ManagedProviderBindingSchema,
  ManagedAccountSessionActionSchema,
  ManagedAccountSessionCompletionSchema,
  ManagedApiKeyAccountSchema,
  ManagedDeleteAccountSchema,
  ManagedRenameAccountSchema,
  ManagedReplaceApiKeyAccountSchema,
  SecretRevealDecisionSchema,
  WorkbenchNotificationResponseSchema,
  WorkbenchNotificationIdSchema,
  ProtectedMediaViewBindingSchema,
  ProtectedMediaSelectionRegistrationSchema,
  ProtectedMediaLeaseResolutionSchema,
  ProtectedArtifactResolutionSchema,
  VIEW_BROKER_METHODS,
  ProviderProbeSchema,
  WORKBENCH_CONTRIBUTION_KEYS,
  VIEW_CONTRIBUTION_KEYS,
  SelectedExtension
} from './extension-public-schemas.js'
import { safeErrorBody } from './extension-public-common.js'
import {
  agentCursorAfterSubscription,
  projectAgentEvent
} from './extension-public-projections.js'

export function buildViewEventStream(
  platform: ExtensionPlatformRuntime,
  request: Request,
  sessionId: string,
  cursor: number,
  limit: number
): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closeStream: (() => void) | undefined
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let highWater = cursor
      let replaying = true
      const live: ExtensionViewSessionEvent[] = []
      const close = () => {
        if (closed) return
        closed = true
        request.signal.removeEventListener('abort', close)
        unsubscribe?.()
        unsubscribe = undefined
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        try { controller.close() } catch { /* already closed */ }
      }
      closeStream = close
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) return close()
      const deliver = (event: ExtensionViewSessionEvent) => {
        if (closed || event.sequence <= highWater) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
        highWater = event.sequence
        controller.enqueue(encoder.encode(encodeSse(event.sequence, event.type, event)))
      }
      unsubscribe = platform.viewSessions.subscribe(sessionId, (event) => {
        if (replaying) live.push(event)
        else deliver(event)
      })
      const replay = platform.viewSessions.replay(sessionId, cursor, limit)
      if (replay.cursorExpired) {
        controller.enqueue(encoder.encode(encodeSse(
          replay.oldestAvailableCursor,
          'error',
          { code: 'cursor_expired', oldestAvailableCursor: replay.oldestAvailableCursor }
        )))
        return close()
      }
      for (const event of replay.events) deliver(event)
      if (replay.hasMore) return close()
      for (const event of live.sort((left, right) => left.sequence - right.sequence)) deliver(event)
      replaying = false
      heartbeat = setInterval(() => {
        if (closed) return
        if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
        controller.enqueue(encoder.encode(encodeSse(highWater, 'heartbeat', { cursor: highWater })))
      }, HEARTBEAT_INTERVAL_MS)
      heartbeat.unref?.()
    },
    cancel() {
      closed = true
      if (closeStream) request.signal.removeEventListener('abort', closeStream)
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    }
  })
  return sseResponse(stream)
}

export function buildAgentEventStream(
  platform: ExtensionPlatformRuntime,
  principal: ExtensionPrincipal,
  request: Request,
  runId: string,
  cursor: number,
  limit: number
): Response {
  const encoder = new TextEncoder()
  let subscription: ExtensionAgentSubscription | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closeStream: (() => void) | undefined
  let closed = false
  let delivered = 0
  let highWater = cursor
  const afterSeq = cursor - 1
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        request.signal.removeEventListener('abort', close)
        subscription?.close()
        subscription = undefined
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
        try { controller.close() } catch { /* already closed */ }
      }
      closeStream = close
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) return close()
      try {
        subscription = await platform.agent.subscribe(principal, {
          runId,
          afterSeq
        }, (internal) => {
          if (closed || delivered >= limit) return
          const event = projectAgentEvent(internal)
          if (!event) return
          if (event.sequence <= highWater) return
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
          highWater = event.sequence
          delivered += 1
          controller.enqueue(encoder.encode(encodeSse(event.sequence, event.type, event)))
          if (event.type === 'terminal' || delivered >= limit) close()
        })
        // ExtensionAgentService consumes private event sequences without
        // invoking this listener. Preserve that cursor for reconnects and
        // heartbeat frames without exposing the private event itself.
        highWater = agentCursorAfterSubscription(highWater, afterSeq, subscription.lastDeliveredSeq)
        if (closed) {
          subscription.close()
          subscription = undefined
          return
        }
        heartbeat = setInterval(() => {
          if (closed) return
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return close()
          if (subscription) {
            highWater = agentCursorAfterSubscription(
              highWater,
              afterSeq,
              subscription.lastDeliveredSeq
            )
          }
          controller.enqueue(encoder.encode(encodeSse(highWater, 'heartbeat', { cursor: highWater })))
        }, HEARTBEAT_INTERVAL_MS)
        heartbeat.unref?.()
      } catch (error) {
        if (!closed) {
          controller.enqueue(encoder.encode(encodeSse(highWater, 'error', safeErrorBody(error))))
          close()
        }
      }
    },
    cancel() {
      closed = true
      if (closeStream) request.signal.removeEventListener('abort', closeStream)
      subscription?.close()
      if (heartbeat) clearInterval(heartbeat)
    }
  })
  return sseResponse(stream)
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  })
}

export function encodeSse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function parseEventQuery(
  request: Request
): { ok: true; cursor: number; limit: number } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const unknown = [...url.searchParams.keys()].filter((key) => key !== 'cursor' && key !== 'limit')
  if (unknown.length > 0) {
    return { ok: false, response: ERRORS.validation('invalid extension event query', { unknown }) }
  }
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    return { ok: false, response: ERRORS.validation('duplicate extension event query parameter') }
  }
  const parsed = z.strictObject({
    cursor: z.coerce.number().int().min(0).safe().default(0),
    limit: z.coerce.number().int().min(1).max(MAX_EVENT_LIMIT).default(DEFAULT_EVENT_LIMIT)
  }).safeParse({
    cursor: url.searchParams.get('cursor') ?? request.headers.get('last-event-id') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined
  })
  if (!parsed.success) {
    return { ok: false, response: ERRORS.validation('invalid extension event query', parsed.error.issues) }
  }
  return { ok: true, cursor: parsed.data.cursor, limit: parsed.data.limit }
}

export function acceptsSse(request: Request): boolean {
  return request.headers.get('accept')?.split(',').some((value) => value.trim().startsWith('text/event-stream')) ?? false
}
