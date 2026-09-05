import { z } from 'zod'
import {
  RuntimeFlavorSchema
} from '../contracts/runtime-flavor.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import { Router } from '../server/router.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import { KUN_VERSION } from '../version.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION
} from './manager-discovery.js'
import {
  ManagerSharedDataStore,
  type ManagerAttachmentStoreOperation,
  type ManagerArtifactStoreOperation,
  type ManagerGraphStoreOperation,
  type ManagerMemoryStoreOperation,
  type ManagerSessionStoreOperation
} from './shared-data-store.js'
import {
  RevisionConflictError,
  RevisionedDocumentStore
} from './revisioned-document-store.js'

import {
  ManagerResourceFenceSchema,
  RESOURCE_COMMIT_TTL_MS,
  RESOURCE_LEASE_TTL_MS
} from './resource-lease-state.js'
import {
  ArtifactStoreOperationSchema,
  AttachmentStoreOperationSchema,
  GraphStoreOperationSchema,
  KUN_MANAGER_CAPABILITIES,
  MAX_MANAGER_DATA_BODY_BYTES,
  MemoryStoreOperationSchema,
  RUNTIME_HEARTBEAT_TTL_MS,
  RuntimeRegistrationRequiredError,
  ServiceManagerState,
  SessionStoreOperationSchema,
  StaleTurnFenceError,
  THREAD_EXECUTION_LEASE_TTL_MS,
  ThreadLeaseBusyError,
  ThreadStoreOperationSchema
} from './service-manager-state.js'
import { ManagerDataRequestEnvelopeSchema } from './shared-data-store-contracts.js'
import { guardManagerDataTurnFence } from './service-manager-router-turn-fencing.js'
import {
  authorized,
  authorizedAsync,
  tokenMatches,
  validation
} from './service-manager-router-auth.js'
import { addHostPowerRoute } from './service-manager-router-host-power.js'
import { addRuntimeRegistrationRoute } from './service-manager-router-runtime-registration.js'
import {
  fencedAtomicJsonMutation,
  flushRenewal,
  isResourceFenceStale,
  resourceFenceStale
} from './service-manager-router-fenced-mutation.js'
import {
  isManagerPersistenceDegraded,
  managerPersistenceDegradedResponse
} from './service-manager-router-persistence.js'
import type { ManagerStateWriteQueueStats } from './service-manager-state-write-queue.js'
import {
  isUsageIndexUnavailable,
  usageIndexUnavailableResponse
} from './service-manager-usage-response.js'

export { authorized, authorizedAsync, tokenMatches, validation } from './service-manager-router-auth.js'
export { isUsageIndexUnavailable } from './service-manager-usage-response.js'

export function buildServiceManagerRouter(input: {
  managerToken: string
  instanceId: string
  startedAt: string
  buildId?: string
  state: ServiceManagerState
  sharedData?: ManagerSharedDataStore
  documents?: RevisionedDocumentStore
  requestShutdown?: () => void
  flushState?: () => Promise<void>
  /**
   * Renewal-only durability: responds as soon as the in-memory mutation is
   * queued, within the safe TTL window; falls back to a full flush once the
   * deferred window is exhausted so a persisted copy never lags the lease TTL.
   */
  flushStateForRenewal?: (ttlMs: number) => Promise<void>
  statePersistence?: () => {
    degraded: boolean
    durableLag: number
    stats?: ManagerStateWriteQueueStats
  }
}): Router {
  const router = new Router()
  const capabilities = input.sharedData
    ? KUN_MANAGER_CAPABILITIES
    : KUN_MANAGER_CAPABILITIES.filter((capability) =>
        capability !== 'shared-data-v1' &&
        capability !== 'artifact-memory-data-v1' &&
        capability !== 'atomic-json-v1'
      )
  router.add('GET', '/health', () => {
    const persistence = input.statePersistence?.()
    return jsonResponse({
      status: 'ok',
      service: 'kun-service-manager',
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: input.instanceId,
      pid: process.pid,
      startedAt: input.startedAt,
      serviceVersion: KUN_VERSION,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      capabilities,
      persistence: {
        state: persistence?.degraded ? 'degraded' : 'healthy',
        durableLag: persistence?.durableLag ?? 0
      }
    })
  })
  router.add('GET', '/v1/manager/status', (request) => authorized(request, input.managerToken, () => {
    const persistence = input.statePersistence?.()
    return jsonResponse({
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: input.instanceId,
      pid: process.pid,
      startedAt: input.startedAt,
      serviceVersion: KUN_VERSION,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      capabilities,
      slots: input.state.snapshot(),
      ...(persistence?.stats ? { statePersistence: persistence.stats } : {})
    })
  }))
  router.add('GET', '/v1/runtimes/:flavor', (request, context) => authorized(request, input.managerToken, () => {
    const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
    if (!flavor.success) return validation('invalid runtime flavor')
    return jsonResponse({ registration: input.state.registration(flavor.data) })
  }))
  addHostPowerRoute(router, input)
  router.add('GET', '/v1/leases/threads/:threadId', (request, context) => authorized(
    request,
    input.managerToken,
    () => jsonResponse({ lease: input.state.lease(context.params.threadId) })
  ))
  router.add('POST', '/v1/leases/threads/:threadId/acquire', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        turnId: z.string().min(1).max(256),
        ownerFlavor: RuntimeFlavorSchema,
        ownerInstanceId: z.string().min(1).max(256)
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid thread lease request', parsed.error.issues)
      try {
        const lease = input.state.acquireLease({
          threadId: context.params.threadId,
          ...parsed.data
        })
        await input.flushState?.()
        return jsonResponse({ lease })
      } catch (error) {
        if (error instanceof ThreadLeaseBusyError) {
          await input.flushState?.()
          return jsonResponse({
            code: 'thread_busy',
            message: error.message,
            owner: error.lease
          }, 409)
        }
        if (error instanceof RuntimeRegistrationRequiredError) {
          return jsonResponse({ code: 'runtime_not_registered', message: error.message }, 409)
        }
        throw error
      }
    }
  ))
  router.add('POST', '/v1/leases/threads/:threadId/renew', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = leaseOwnerBody(body.value)
      if (!parsed.success) return validation('invalid thread lease renewal', parsed.error.issues)
      const lease = input.state.renewLease({ threadId: context.params.threadId, ...parsed.data })
      if (lease) await flushRenewal(input, THREAD_EXECUTION_LEASE_TTL_MS)
      return lease
        ? jsonResponse({ lease })
        : jsonResponse({ code: 'thread_lease_lost', message: 'thread lease is no longer owned by this runtime' }, 409)
    }
  ))
  router.add('POST', '/v1/leases/threads/:threadId/release', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = leaseOwnerBody(body.value)
      if (!parsed.success) return validation('invalid thread lease release', parsed.error.issues)
      const released = input.state.releaseLease({
        threadId: context.params.threadId,
        ...parsed.data
      })
      if (released) await input.flushState?.()
      return jsonResponse({ released })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/acquire', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        ownerFlavor: RuntimeFlavorSchema,
        ownerInstanceId: z.string().min(1).max(256)
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid resource lease request', parsed.error.issues)
      const result = input.state.acquireResource({
        resource: context.params.resource,
        ...parsed.data
      })
      if (result.acquired) await input.flushState?.()
      return jsonResponse(result)
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/renew', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource lease renewal', parsed.error.issues)
      const lease = input.state.renewResource(parsed.data)
      if (lease) await flushRenewal(input, RESOURCE_LEASE_TTL_MS)
      return lease
        ? jsonResponse({ lease })
        : resourceFenceStale()
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/validate', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource lease validation', parsed.error.issues)
      return input.state.validateResource(parsed.data)
        ? jsonResponse({ valid: true })
        : resourceFenceStale()
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/commits/:commitId/begin', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource commit reservation', parsed.error.issues)
      const lease = input.state.beginResourceCommit(parsed.data, context.params.commitId)
      if (!lease) return resourceFenceStale()
      await input.flushState?.()
      return jsonResponse({ lease })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/commits/:commitId/renew', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource commit renewal', parsed.error.issues)
      const lease = input.state.renewResourceCommit(parsed.data, context.params.commitId)
      if (!lease) return resourceFenceStale()
      await flushRenewal(input, RESOURCE_COMMIT_TTL_MS)
      return jsonResponse({ lease })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/commits/:commitId/end', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource commit release', parsed.error.issues)
      const ended = input.state.endResourceCommit(parsed.data, context.params.commitId)
      if (ended) await input.flushState?.()
      return jsonResponse({ ended })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/release', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource lease release', parsed.error.issues)
      const released = input.state.releaseResource(parsed.data)
      if (released) await input.flushState?.()
      return jsonResponse({ released })
    }
  ))
  addRuntimeRegistrationRoute(router, input)
  router.add('POST', '/v1/runtimes/:flavor/heartbeat', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({ instanceId: z.string().min(1).max(256) }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid heartbeat', parsed.error.issues)
      if (!input.state.heartbeat(flavor.data, parsed.data.instanceId)) {
        return jsonResponse({ code: 'runtime_instance_changed', message: 'runtime slot owner changed' }, 409)
      }
      await flushRenewal(input, RUNTIME_HEARTBEAT_TTL_MS)
      return jsonResponse({ accepted: true })
    }
  ))
  router.add('DELETE', '/v1/runtimes/:flavor/:instanceId', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      const removed = input.state.unregister(flavor.data, context.params.instanceId)
      if (removed) await input.flushState?.()
      return jsonResponse({ removed })
    }
  ))
  router.add('POST', '/v1/manager/shutdown', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({ instanceId: z.literal(input.instanceId) }).strict().safeParse(body.value)
      if (!parsed.success) return jsonResponse({ code: 'manager_instance_changed' }, 409)
      input.requestShutdown?.()
      return jsonResponse({ accepted: true, instanceId: input.instanceId })
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/thread/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = ThreadStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid thread-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const envelope = ManagerDataRequestEnvelopeSchema.parse(body.value)
        const assertCurrent = guardManagerDataTurnFence(
          input.state, 'thread', operation.data, envelope
        )
        const result = await input.sharedData!.executeThread(
          operation.data,
          envelope.value,
          assertCurrent
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid thread-store request', error.issues)
        if (error instanceof StaleTurnFenceError) {
          return jsonResponse({ code: error.code, message: error.message }, 409)
        }
        if (isUsageIndexUnavailable(error)) return usageIndexUnavailableResponse(error)
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/session/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = SessionStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid session-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const envelope = ManagerDataRequestEnvelopeSchema.parse(body.value)
        const assertCurrent = guardManagerDataTurnFence(
          input.state, 'session', operation.data, envelope
        )
        const result = await input.sharedData!.executeSession(
          operation.data as ManagerSessionStoreOperation,
          envelope.value,
          assertCurrent
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid session-store request', error.issues)
        if (error instanceof StaleTurnFenceError) {
          return jsonResponse({ code: error.code, message: error.message }, 409)
        }
        if (isUsageIndexUnavailable(error)) return usageIndexUnavailableResponse(error)
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/artifact/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = ArtifactStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid artifact-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const result = await input.sharedData!.executeArtifact(
          operation.data as ManagerArtifactStoreOperation,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid artifact-store request', error.issues)
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/memory/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = MemoryStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid memory-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const result = await input.sharedData!.executeMemory(
          operation.data as ManagerMemoryStoreOperation,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid memory-store request', error.issues)
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/graph/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = GraphStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid graph-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const result = await input.sharedData!.executeGraph(
          operation.data as ManagerGraphStoreOperation,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid graph-store request', error.issues)
        if (error instanceof GraphRunConflictError) {
          return jsonResponse({ code: 'graph_run_conflict', message: error.message }, 409)
        }
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/attachment/:operation', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const operation = AttachmentStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid attachment-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const result = await input.sharedData!.executeAttachment(
          operation.data as ManagerAttachmentStoreOperation,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid attachment-store request', error.issues)
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('POST', '/v1/data/atomic-json/read', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({ path: z.string().min(1).max(4_096) }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid atomic JSON read', parsed.error.issues)
      return jsonResponse({ snapshot: await input.sharedData!.readAtomicJson(parsed.data.path) })
    }
  ))
  if (input.sharedData) router.add('PUT', '/v1/data/atomic-json/write', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      const parsed = z.object({
        path: z.string().min(1).max(4_096),
        expectedRevision: z.number().int().nonnegative(),
        value: z.unknown(),
        fence: ManagerResourceFenceSchema.optional(),
        commitId: z.string().min(1).max(256).optional()
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid atomic JSON write', parsed.error.issues)
      try {
        return await fencedAtomicJsonMutation(input, parsed.data, (commitId) =>
          input.sharedData!.writeAtomicJson({
            path: parsed.data.path,
            expectedRevision: parsed.data.expectedRevision,
            value: parsed.data.value,
            ...(parsed.data.fence && commitId ? {
              beforeCommit: () => input.state.assertResourceCommit(
                parsed.data.fence!, commitId
              )
            } : {})
          }))
      } catch (error) {
        if (isResourceFenceStale(error)) return resourceFenceStale()
        if (error instanceof RevisionConflictError) {
          return jsonResponse({
            code: 'revision_conflict',
            currentRevision: error.currentRevision
          }, 409)
        }
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('DELETE', '/v1/data/atomic-json/delete', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        path: z.string().min(1).max(4_096),
        expectedRevision: z.number().int().nonnegative(),
        fence: ManagerResourceFenceSchema.optional(),
        commitId: z.string().min(1).max(256).optional()
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid atomic JSON delete', parsed.error.issues)
      try {
        return await fencedAtomicJsonMutation(input, parsed.data, (commitId) =>
          input.sharedData!.deleteAtomicJson({
            path: parsed.data.path,
            expectedRevision: parsed.data.expectedRevision,
            ...(parsed.data.fence && commitId ? {
              beforeCommit: () => input.state.assertResourceCommit(
                parsed.data.fence!, commitId
              )
            } : {})
          }))
      } catch (error) {
        if (isResourceFenceStale(error)) return resourceFenceStale()
        if (error instanceof RevisionConflictError) {
          return jsonResponse({
            code: 'revision_conflict',
            currentRevision: error.currentRevision
          }, 409)
        }
        throw error
      }
    }
  ))
  if (input.sharedData) router.add('GET', '/v1/controls/:kind/:id/owner', (request, context) => authorized(
    request,
    input.managerToken,
    () => {
      const kind = z.enum(['approval', 'user-input']).safeParse(context.params.kind)
      if (!kind.success) return validation('invalid control kind')
      const threadId = input.sharedData!.controlThread(kind.data, context.params.id)
      const lease = threadId ? input.state.lease(threadId) : null
      const registration = lease ? input.state.registration(lease.ownerFlavor) : null
      return jsonResponse({ threadId, lease, registration })
    }
  ))
  if (input.documents) router.add('GET', '/v1/documents/:key', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const key = z.enum(['settings', 'client-state']).safeParse(context.params.key)
      if (!key.success) return validation('invalid document key')
      return jsonResponse({ snapshot: await input.documents!.read(key.data) })
    }
  ))
  if (input.documents) router.add('PUT', '/v1/documents/:key', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const key = z.enum(['settings', 'client-state']).safeParse(context.params.key)
      if (!key.success) return validation('invalid document key')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      const parsed = z.object({
        expectedRevision: z.number().int().nonnegative(),
        value: z.string().max(MAX_MANAGER_DATA_BODY_BYTES)
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid revisioned document write', parsed.error.issues)
      try {
        return jsonResponse({ snapshot: await input.documents!.write({
          key: key.data,
          ...parsed.data
        }) })
      } catch (error) {
        if (error instanceof RevisionConflictError) {
          return jsonResponse({
            code: 'revision_conflict',
            message: error.message,
            currentRevision: error.currentRevision
          }, 409)
        }
        throw error
      }
    }
  ))
  return router
}

function resourceFenceBody(resource: string, value: unknown) {
  return ManagerResourceFenceSchema.safeParse({
    resource,
    ...(typeof value === 'object' && value !== null ? value : {})
  })
}

export function leaseOwnerBody(value: unknown) {
  return z.object({
    turnId: z.string().min(1).max(256),
    ownerFlavor: RuntimeFlavorSchema,
    ownerInstanceId: z.string().min(1).max(256),
    fencingToken: z.number().int().positive()
  }).strict().safeParse(value)
}
