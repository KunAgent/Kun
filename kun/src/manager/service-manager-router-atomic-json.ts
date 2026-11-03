import { z } from 'zod'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import type { Router } from '../server/router.js'
import { ManagerResourceFenceSchema } from './resource-lease-state.js'
import { RevisionConflictError } from './revisioned-document-store.js'
import { authorizedAsync, validation } from './service-manager-router-auth.js'
import {
  fencedAtomicJsonMutation,
  isResourceFenceStale,
  resourceFenceStale
} from './service-manager-router-fenced-mutation.js'
import { MAX_MANAGER_DATA_BODY_BYTES, type ServiceManagerState } from './service-manager-state.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'

/**
 * Manager-owned JSON documents (Registry, catalogs, intents, credentials).
 * Reads accept `ifNoneMatch` with the etag of a previous read and then answer
 * `{ unchanged: true }` instead of the document, so pollers stop moving the
 * whole file over loopback when nothing changed.
 */
export function addManagerAtomicJsonRoutes(router: Router, input: {
  managerToken: string
  sharedData: ManagerSharedDataStore
  state: ServiceManagerState
  flushState?: () => Promise<void>
  flushStateForRenewal?: (ttlMs: number) => Promise<void>
}): void {
  router.add('POST', '/v1/data/atomic-json/read', (request) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const parsed = z.object({
        path: z.string().min(1).max(4_096),
        ifNoneMatch: z.string().min(1).max(128).optional()
      }).strict().safeParse(body.value)
      if (!parsed.success) return validation('invalid atomic JSON read', parsed.error.issues)
      return jsonResponse({
        snapshot: await input.sharedData.readAtomicJsonConditional(parsed.data.path, parsed.data.ifNoneMatch)
      })
    }
  ))
  router.add('PUT', '/v1/data/atomic-json/write', (request) => authorizedAsync(
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
          input.sharedData.writeAtomicJson({
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
  router.add('DELETE', '/v1/data/atomic-json/delete', (request) => authorizedAsync(
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
          input.sharedData.deleteAtomicJson({
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
}
