import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema,
  type RuntimeFlavor,
  type RuntimeRegistration,
  type ThreadExecutionLease
} from '../contracts/runtime-flavor.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import { acquireRuntimeDataDirLease } from '../server/runtime-data-dir-lease.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse, type JsonResponse } from '../server/response.js'
import { Router } from '../server/router.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import { KUN_VERSION } from '../version.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
  publishManagerDiscovery,
  removeManagerDiscovery,
  type ManagerDiscoveryRecord
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
  ResourceFenceStaleError
} from './resource-lease-state.js'
import {
  ArtifactStoreOperationSchema,
  AttachmentStoreOperationSchema,
  GraphStoreOperationSchema,
  KUN_MANAGER_CAPABILITIES,
  MAX_MANAGER_DATA_BODY_BYTES,
  MemoryStoreOperationSchema,
  RuntimeRegistrationRequiredError,
  RuntimeSlotBusyError,
  ServiceManagerState,
  SessionStoreOperationSchema,
  ThreadLeaseBusyError,
  ThreadStoreOperationSchema
} from './service-manager-state.js'

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
}): Router {
  const router = new Router()
  const capabilities = input.sharedData
    ? KUN_MANAGER_CAPABILITIES
    : KUN_MANAGER_CAPABILITIES.filter((capability) =>
        capability !== 'shared-data-v1' &&
        capability !== 'artifact-memory-data-v1' &&
        capability !== 'atomic-json-v1'
      )
  router.add('GET', '/health', () => jsonResponse({
    status: 'ok',
    service: 'kun-service-manager',
    protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
    instanceId: input.instanceId,
    pid: process.pid,
    startedAt: input.startedAt,
    serviceVersion: KUN_VERSION,
    ...(input.buildId ? { buildId: input.buildId } : {}),
    capabilities
  }))
  router.add('GET', '/v1/manager/status', (request) => authorized(request, input.managerToken, () =>
    jsonResponse({
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: input.instanceId,
      pid: process.pid,
      startedAt: input.startedAt,
      serviceVersion: KUN_VERSION,
      ...(input.buildId ? { buildId: input.buildId } : {}),
      capabilities,
      slots: input.state.snapshot()
    })))
  router.add('GET', '/v1/runtimes/:flavor', (request, context) => authorized(request, input.managerToken, () => {
    const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
    if (!flavor.success) return validation('invalid runtime flavor')
    return jsonResponse({ registration: input.state.registration(flavor.data) })
  }))
  router.add('GET', '/v1/leases/threads/:threadId', (request, context) => authorized(
    request,
    input.managerToken,
    () => jsonResponse({ lease: input.state.lease(context.params.threadId) })
  ))
  router.add('POST', '/v1/leases/threads/:threadId/acquire', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        turnId: z.string().min(1).max(256),
        ownerFlavor: RuntimeFlavorSchema,
        ownerInstanceId: z.string().min(1).max(256)
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid thread lease request', parsed.error.issues)
      try {
        return jsonResponse({ lease: input.state.acquireLease({
          threadId: context.params.threadId,
          ...parsed.data
        }) })
      } catch (error) {
        if (error instanceof ThreadLeaseBusyError) {
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
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = leaseOwnerBody(body.value)
      if (!parsed.success) return validation('invalid thread lease renewal', parsed.error.issues)
      const lease = input.state.renewLease({ threadId: context.params.threadId, ...parsed.data })
      return lease
        ? jsonResponse({ lease })
        : jsonResponse({ code: 'thread_lease_lost', message: 'thread lease is no longer owned by this runtime' }, 409)
    }
  ))
  router.add('POST', '/v1/leases/threads/:threadId/release', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = leaseOwnerBody(body.value)
      if (!parsed.success) return validation('invalid thread lease release', parsed.error.issues)
      return jsonResponse({ released: input.state.releaseLease({
        threadId: context.params.threadId,
        ...parsed.data
      }) })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/acquire', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
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
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource lease renewal', parsed.error.issues)
      const lease = input.state.renewResource(parsed.data)
      if (lease) await input.flushState?.()
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
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource commit renewal', parsed.error.issues)
      const lease = input.state.renewResourceCommit(parsed.data, context.params.commitId)
      if (!lease) return resourceFenceStale()
      await input.flushState?.()
      return jsonResponse({ lease })
    }
  ))
  router.add('POST', '/v1/leases/resources/:resource/commits/:commitId/end', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
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
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = resourceFenceBody(context.params.resource, body.value)
      if (!parsed.success) return validation('invalid resource lease release', parsed.error.issues)
      const released = input.state.releaseResource(parsed.data)
      if (released) await input.flushState?.()
      return jsonResponse({ released })
    }
  ))
  router.add('PUT', '/v1/runtimes/:flavor/register', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const registration = RuntimeRegistrationSchema.safeParse(body.value)
      if (!registration.success || registration.data.flavor !== flavor.data) {
        return validation('invalid runtime registration', registration.success ? undefined : registration.error.issues)
      }
      try {
        return jsonResponse({ registration: input.state.register(registration.data) })
      } catch (error) {
        if (error instanceof RuntimeSlotBusyError) {
          return jsonResponse({
            code: 'runtime_slot_busy',
            message: error.message,
            owner: error.owner
          }, 409)
        }
        throw error
      }
    }
  ))
  router.add('POST', '/v1/runtimes/:flavor/heartbeat', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({ instanceId: z.string().min(1).max(256) }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid heartbeat', parsed.error.issues)
      if (!input.state.heartbeat(flavor.data, parsed.data.instanceId)) {
        return jsonResponse({ code: 'runtime_instance_changed', message: 'runtime slot owner changed' }, 409)
      }
      return jsonResponse({ accepted: true })
    }
  ))
  router.add('DELETE', '/v1/runtimes/:flavor/:instanceId', (request, context) => authorized(
    request,
    input.managerToken,
    () => {
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      return jsonResponse({
        removed: input.state.unregister(flavor.data, context.params.instanceId)
      })
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
        const result = await input.sharedData!.executeThread(
          operation.data,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid thread-store request', error.issues)
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
        const result = await input.sharedData!.executeSession(
          operation.data as ManagerSessionStoreOperation,
          body.value
        )
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid session-store request', error.issues)
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

export function authorized(
  request: Request,
  token: string,
  action: () => JsonResponse | Response
): JsonResponse | Response {
  return tokenMatches(request.headers.get('authorization'), token)
    ? action()
    : jsonResponse({ code: 'unauthorized', message: 'manager authorization required' }, 401)
}

export async function authorizedAsync(
  request: Request,
  token: string,
  action: () => Promise<JsonResponse | Response>
): Promise<JsonResponse | Response> {
  return tokenMatches(request.headers.get('authorization'), token)
    ? action()
    : jsonResponse({ code: 'unauthorized', message: 'manager authorization required' }, 401)
}

export function tokenMatches(header: string | null, expected: string): boolean {
  const actual = header?.replace(/^Bearer\s+/iu, '') ?? ''
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function validation(message: string, details?: unknown): JsonResponse {
  return jsonResponse({ code: 'validation_error', message, ...(details ? { details } : {}) }, 400)
}

async function fencedAtomicJsonMutation<T>(
  input: { state: ServiceManagerState; flushState?: () => Promise<void> },
  mutation: { fence?: z.infer<typeof ManagerResourceFenceSchema>; commitId?: string },
  operation: (commitId?: string) => Promise<T>
): Promise<JsonResponse> {
  const needsReservation = Boolean(mutation.fence && !mutation.commitId)
  const commitId = mutation.commitId ?? (needsReservation ? randomUUID() : undefined)
  if (mutation.fence && commitId && needsReservation) {
    const lease = input.state.beginResourceCommit(mutation.fence, commitId)
    if (!lease) return resourceFenceStale()
    await input.flushState?.()
  }
  let renewalInFlight: Promise<void> | undefined
  const renewalTimer = needsReservation && mutation.fence && commitId
    ? setInterval(() => {
        if (renewalInFlight) return
        renewalInFlight = Promise.resolve().then(async () => {
          const lease = input.state.renewResourceCommit(mutation.fence!, commitId)
          if (!lease) throw new ResourceFenceStaleError()
          await input.flushState?.()
        }).finally(() => { renewalInFlight = undefined })
        void renewalInFlight.catch(() => undefined)
      }, 3_000)
    : undefined
  renewalTimer?.unref?.()
  try {
    if (mutation.fence && commitId) input.state.assertResourceCommit(mutation.fence, commitId)
    return jsonResponse({ snapshot: await operation(commitId) })
  } finally {
    if (renewalTimer) clearInterval(renewalTimer)
    if (renewalInFlight) await renewalInFlight
    if (mutation.fence && commitId && needsReservation) {
      input.state.endResourceCommit(mutation.fence, commitId)
      await input.flushState?.()
    }
  }
}

export function resourceFenceStale(): JsonResponse {
  return jsonResponse({
    code: 'resource_fence_stale',
    message: 'resource lease fencing token is no longer current'
  }, 409)
}

function isResourceFenceStale(error: unknown): boolean {
  return error instanceof ResourceFenceStaleError ||
    (error instanceof Error && error.cause instanceof ResourceFenceStaleError)
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
    ownerInstanceId: z.string().min(1).max(256)
  }).strict().safeParse(value)
}
