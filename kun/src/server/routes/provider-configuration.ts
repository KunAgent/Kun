import { previewProviderRoute } from './provider-route-preview.js'
import { z } from 'zod'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { strictRuntimeTokenAuthorized } from './gateway-request-guard.js'
import { ERRORS } from './runtime-error.js'
import { jsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ModelConnectionConflictError } from '../../services/model-connection-registry.js'
import { exportProviderConfiguration, prepareProviderImport } from '../../services/provider-configuration-exchange.js'

export function registerProviderConfigurationRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/provider-config', async (request) => {
    if (!strictRuntimeTokenAuthorized(request, runtime.runtimeToken)) return ERRORS.unauthorized()
    if (!runtime.modelConnections) return ERRORS.validation('Provider configuration is unavailable')
    const params = new URL(request.url).searchParams
    if (params.has('schema_version') && params.get('schema_version') !== '2') {
      return jsonResponse({ message: 'This Runtime requires provider configuration schema v2', supportedSchemaVersions: [2] }, 409)
    }
    const page = z.object({ offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(100), search: z.string().max(256).default('')
    }).safeParse({ offset: params.get('offset') ?? undefined, limit: params.get('limit') ?? undefined, search: params.get('search') ?? undefined })
    if (!page.success) return ERRORS.validation('Invalid provider configuration page')
    const { offset, limit } = page.data, search = page.data.search.toLowerCase()
    const snapshot = await runtime.modelConnections.configurationSnapshot()
    const connections = snapshot.connections.filter((connection) =>
      !search || `${connection.name} ${connection.id}`.toLowerCase().includes(search))
    return jsonResponse({ ...snapshot, supportedSchemaVersions: [2], compatibilitySnapshotVersion: 1, connections: connections.slice(offset, offset + limit), totalConnections: connections.length })
  })
  for (const action of ['transactions/preview', 'transactions/commit', 'export', 'import/preview', 'routes/preview'] as const) {
    router.add('POST', `/v1/provider-config/${action}`, async (request) => {
      if (!strictRuntimeTokenAuthorized(request, runtime.runtimeToken)) return ERRORS.unauthorized()
      const registry = runtime.modelConnections
      if (!registry) return ERRORS.validation('Provider configuration is unavailable')
      const body = await readJsonBody(request, 8 * 1024 * 1024)
      if (!body.ok) return body.response
      try {
        if (action === 'routes/preview') return jsonResponse(await previewProviderRoute(runtime, body.value))
        if (action === 'transactions/preview') return jsonResponse(await registry.previewConfiguration(body.value))
        if (action === 'transactions/commit') return jsonResponse(await registry.commitConfiguration(body.value))
        const snapshot = await registry.configurationSnapshot()
        if (action === 'export') return jsonResponse(exportProviderConfiguration(snapshot))
        const imported = prepareProviderImport(body.value, snapshot)
        return jsonResponse({ ...await registry.previewConfiguration({ expectedRevision: imported.expectedRevision,
          operations: imported.operations }), remaps: imported.remaps, secretSlots: imported.secretSlots })
      } catch (error) {
        if (error instanceof ModelConnectionConflictError) return jsonResponse({ message: error.message,
          revision: error.snapshot.revision }, 409)
        if (error instanceof z.ZodError) return ERRORS.validation('Invalid provider configuration document')
        return ERRORS.validation(error instanceof Error ? error.message : 'Provider configuration operation failed')
      }
    })
  }
}
