import type { Router } from '../router.js'
import { healthJsonResponse } from './health.js'
import {
  gatewayCredentialStatus,
  ensureGatewayCredential,
  rotateGatewayCredential,
  revokeGatewayCredential,
  revealGatewayCredential,
  gatewayChatCompletions,
  gatewayModels,
  gatewayResponses,
  routePoolStatus,
  testRoutePool
} from './openai-model-gateway.js'
import { registerExtensionManagementRoutes } from './extensions.js'
import { registerExtensionPublicRoutes } from './extension-public.js'
import {
  createMigrationExport,
  commitMigrationImport,
  preflightMigrationImport,
  releaseMigrationImport,
  releaseMigrationExport,
  rollbackMigrationImport,
  verifyMigrationImport,
  streamMigrationExport
} from './migrations.js'
import { runtimeInfoJsonResponse, runtimeToolDiagnosticsJsonResponse } from './runtime-info.js'
import { jsonResponse } from '../response.js'
import { shutdownRuntime } from './runtime-shutdown.js'
import {
  cancelModelConnectionOAuth,
  clearModelCredential,
  claudeSdkStatus,
  commitModelCredential,
  completeOfficialProviderAuth,
  connectModelConnection,
  deleteModelConnection,
  fenceModelCredential,
  listModelConnections,
  modelConnectionEvents,
  patchModelConnection,
  probeModelConnection,
  replaceModelCredential,
  selectModelConnection,
  startModelConnectionOAuth,
  modelConnectionOAuthStatus,
  submitModelConnectionOAuth,
  installClaudeSdk,
  updateModelConnectionGlobals
} from './model-connections.js'
import {
  installOfficialProviderCli,
  listOfficialProviderCliModels,
  officialProviderCliStatus
} from './official-provider-cli.js'
import { applyRuntimeConfig } from './runtime-config.js'
import { listSkills } from './skills.js'
import { authorizeMcpOAuth, clearMcpOAuth, mcpOAuthDiagnostics } from './mcp-oauth.js'
import { deleteMcpConfig, listMcpConfig, patchMcpConfig, putMcpConfig } from './mcp-config.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { strictRuntimeTokenAuthorized } from './gateway-request-guard.js'

export function registerCoreRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/health', () => healthJsonResponse())
  router.add('GET', '/v1/models', (request) => gatewayModels(runtime, request))
  router.add('POST', '/v1/chat/completions', (request) => gatewayChatCompletions(runtime, request))
  router.add('POST', '/v1/responses', (request) => gatewayResponses(runtime, request))
  const strictGatewayAdmin = (request: Request) => strictRuntimeTokenAuthorized(request, runtime.runtimeToken)
  router.add('GET', '/v1/model-gateway/credential/status', (request) => {
    if (!strictGatewayAdmin(request)) return ERRORS.unauthorized()
    return gatewayCredentialStatus(runtime)
  })
  router.add('POST', '/v1/model-gateway/credential/ensure', (request) => {
    if (!strictGatewayAdmin(request)) return ERRORS.unauthorized()
    return ensureGatewayCredential(runtime)
  })
  router.add('POST', '/v1/model-gateway/credential/rotate', (request) => {
    if (!strictGatewayAdmin(request)) return ERRORS.unauthorized()
    return rotateGatewayCredential(runtime)
  })
  router.add('DELETE', '/v1/model-gateway/credential', (request) => {
    if (!strictGatewayAdmin(request)) return ERRORS.unauthorized()
    return revokeGatewayCredential(runtime)
  })
  router.add('POST', '/v1/model-gateway/credential/reveal', (request) => {
    if (!strictGatewayAdmin(request)) return ERRORS.unauthorized()
    return revealGatewayCredential(runtime)
  })
  router.add('GET', '/v1/model-routes', (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return routePoolStatus(runtime)
  })
  router.add('POST', '/v1/model-routes/:id/test', (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return testRoutePool(runtime, ctx.params.id)
  })
  if (runtime.extensionPlatform) {
    // Static public extension paths must precede `/v1/extensions/:id` because
    // the minimal Router uses first-match ordering.
    registerExtensionPublicRoutes(router, runtime)
    registerExtensionManagementRoutes(router, {
      packageManager: runtime.extensionPlatform.packageManager,
      registry: runtime.extensionPlatform.registry,
      manager: runtime.extensionPlatform.manager,
      indexClient: runtime.extensionPlatform.indexClient,
      validation: runtime.extensionPlatform.validation,
      runtimeToken: runtime.runtimeToken,
      insecure: runtime.insecure,
      ...(runtime.extensionPlatform.jobs ? { jobs: runtime.extensionPlatform.jobs } : {}),
      ...(runtime.extensionPlatform.bundledSeedResults
        ? { bundledSeedResults: runtime.extensionPlatform.bundledSeedResults }
        : {})
    })
  }
  router.add('POST', '/v1/migrations/exports', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createMigrationExport(runtime.migrationService, request)
  })
  router.add('GET', '/v1/migrations/exports/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return streamMigrationExport(runtime.migrationService, ctx.params.id)
  })
  router.add('DELETE', '/v1/migrations/exports/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return releaseMigrationExport(runtime.migrationService, ctx.params.id)
  })
  router.add('POST', '/v1/migrations/imports/preflight', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return preflightMigrationImport(runtime.migrationImportService, request)
  })
  router.add('POST', '/v1/migrations/imports/:id/commit', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return commitMigrationImport(runtime.migrationImportService, ctx.params.id)
  })
  router.add('POST', '/v1/migrations/imports/:id/verify', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return verifyMigrationImport(runtime.migrationImportService, ctx.params.id)
  })
  router.add('POST', '/v1/migrations/imports/:id/rollback', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return rollbackMigrationImport(runtime.migrationImportService, ctx.params.id)
  })
  router.add('DELETE', '/v1/migrations/imports/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return releaseMigrationImport(runtime.migrationImportService, ctx.params.id)
  })
  router.add('GET', '/v1/runtime/info', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeInfoJsonResponse(runtime)
  })
  router.add('GET', '/v1/runtime/tools', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return runtimeToolDiagnosticsJsonResponse(runtime)
  })
  router.add('POST', '/v1/runtime/thread-guardian', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.inspectThreadStore) return ERRORS.unavailable('thread guardian is not available')
    return jsonResponse(await runtime.inspectThreadStore())
  })
  router.add('POST', '/v1/runtime/shutdown', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return shutdownRuntime(runtime, request)
  })
  router.add('GET', '/v1/model-connections', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listModelConnections(runtime.modelConnections)
  })
  router.add('PATCH', '/v1/model-connections', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateModelConnectionGlobals(runtime.modelConnections, request)
  })
  router.add('POST', '/v1/model-connections/connect', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return connectModelConnection(runtime.modelConnections, request)
  })
  router.add('POST', '/v1/model-connections/oauth/start', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return startModelConnectionOAuth(runtime.modelConnectionOAuth, request)
  })
  router.add('GET', '/v1/model-connections/official-cli/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return officialProviderCliStatus(runtime.officialProviderCli)
  })
  router.add('POST', '/v1/model-connections/official-cli/install', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return installOfficialProviderCli(runtime.officialProviderCli)
  })
  router.add('GET', '/v1/model-connections/official-cli/models', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listOfficialProviderCliModels(runtime.officialProviderCli)
  })
  router.add('POST', '/v1/model-connections/cli/complete', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return completeOfficialProviderAuth(runtime.officialProviderAuth, request)
  })
  router.add('GET', '/v1/model-connections/oauth/:sessionId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return modelConnectionOAuthStatus(runtime.modelConnectionOAuth, ctx.params.sessionId)
  })
  router.add('POST', '/v1/model-connections/oauth/:sessionId/submit', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return submitModelConnectionOAuth(runtime.modelConnectionOAuth, ctx.params.sessionId, request)
  })
  router.add('DELETE', '/v1/model-connections/oauth/:sessionId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return cancelModelConnectionOAuth(runtime.modelConnectionOAuth, ctx.params.sessionId)
  })
  router.add('GET', '/v1/model-connections/claude/sdk', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return claudeSdkStatus(runtime.modelConnectionOAuth)
  })
  router.add('POST', '/v1/model-connections/claude/sdk/install', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return installClaudeSdk(runtime.modelConnectionOAuth)
  })
  router.add('POST', '/v1/model-connections/select', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return selectModelConnection(runtime.modelConnections, request)
  })
  router.add('GET', '/v1/model-connections/events', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return modelConnectionEvents(runtime.modelConnections, request)
  })
  router.add('PATCH', '/v1/model-connections/:providerId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return patchModelConnection(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('PUT', '/v1/model-connections/:providerId/credential', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return replaceModelCredential(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('POST', '/v1/model-connections/:providerId/credential/commit', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return commitModelCredential(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('POST', '/v1/model-connections/:providerId/credential/fence', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return fenceModelCredential(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('DELETE', '/v1/model-connections/:providerId/credential', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearModelCredential(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('DELETE', '/v1/model-connections/:providerId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteModelConnection(runtime.modelConnections, ctx.params.providerId, request)
  })
  router.add('POST', '/v1/model-connections/:providerId/probe', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return probeModelConnection(runtime.modelConnections, ctx.params.providerId)
  })
  router.add('POST', '/v1/runtime/config/apply', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return applyRuntimeConfig(runtime, request)
  })
  router.add('GET', '/v1/mcp/oauth', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return mcpOAuthDiagnostics(runtime)
  })
  router.add('GET', '/v1/mcp/config', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listMcpConfig(runtime)
  })
  router.add('PUT', '/v1/mcp/config/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return putMcpConfig(runtime, ctx.params.id, request)
  })
  router.add('PATCH', '/v1/mcp/config/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return patchMcpConfig(runtime, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/mcp/config/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteMcpConfig(runtime, ctx.params.id)
  })
  router.add('DELETE', '/v1/mcp/oauth', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearMcpOAuth(runtime)
  })
  router.add('DELETE', '/v1/mcp/oauth/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return clearMcpOAuth(runtime, ctx.params.id)
  })
  router.add('POST', '/v1/mcp/oauth/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return authorizeMcpOAuth(runtime, ctx.params.id)
  })
  router.add('GET', '/v1/skills', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listSkills(runtime, request)
  })
}
