import { z } from 'zod'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import type { Router } from '../server/router.js'
import { managerMemoryErrorResponse } from './manager-memory-errors.js'
import { authorizedAsync, validation } from './service-manager-router-auth.js'
import { MAX_MANAGER_DATA_BODY_BYTES, MemoryStoreOperationSchema } from './service-manager-state.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'

export function addManagerMemoryRoute(router: Router, managerToken: string, store: ManagerSharedDataStore): void {
  router.add('POST', '/v1/data/memory/:operation', (request, context) => authorizedAsync(
    request,
    managerToken,
    async () => {
      const operation = MemoryStoreOperationSchema.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid memory-store operation')
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      try {
        const result = await store.executeMemory(operation.data, body.value, request.signal)
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid memory-store request', error.issues)
        const response = managerMemoryErrorResponse(error)
        if (response) return response
        throw error
      }
    }
  ))
}
