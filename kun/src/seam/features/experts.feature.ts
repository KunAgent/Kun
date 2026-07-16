import type { KunExtension, RouteRegistrar } from '../types.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Router } from '../../server/router.js'
import { ExpertService, type ExpertServiceOptions } from '../../experts/services/expert-service.js'

/**
 * Experts Feature Extension
 *
 * Registers:
 * - Expert management service (plugin scanning, custom experts)
 * - Expert routes (GET /v1/experts, GET /v1/experts/:id)
 * - Expert context hook (to be implemented in Stage 2)
 */

const expertsExtension: KunExtension = {
  id: 'experts',

  registerRoutes: ((router: Router, runtime: ServerRuntime) => {
    const expertService = runtime.extensions?.experts as ExpertService | undefined

    // GET /v1/experts - list all experts and teams
    router.add('GET', '/v1/experts', async () => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          experts: expertService.listExperts(),
          teams: expertService.listTeams()
        })
      }
    })

    // GET /v1/experts/:id - get expert or team by id
    router.add('GET', '/v1/experts/:id', async (req) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }

      // Extract id from URL path
      const match = req.url?.match(/\/v1\/experts\/([^/?]+)/)
      const id = match ? match[1] : undefined

      if (!id) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert ID is required' })
        }
      }

      const expert = expertService.getExpert(id)
      if (expert) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expert })
        }
      }

      const team = expertService.getExpertTeam(id)
      if (team) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ team })
        }
      }

      return {
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: `Expert or team '${id}' not found` })
      }
    })
  }) as RouteRegistrar,

  async initializeServices(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>> {
    const config = featureConfig as ExpertServiceOptions | undefined
    if (!config) {
      // Experts feature not configured - skip initialization
      return {}
    }

    const service = new ExpertService({
      pluginRoots: config.pluginRoots || [],
      customExpertsDir: config.customExpertsDir || '~/.kun/experts/custom'
    })

    await service.initialize()

    return { experts: service }
  },

  registerLoopHooks(bus) {
    // TODO: Register expert-context-hook to inject expert roleDefinition
    // Will be implemented in Stage 2 after thread schema migration
  }
}

export default expertsExtension
