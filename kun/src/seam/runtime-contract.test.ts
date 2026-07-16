import { describe, expect, it } from 'vitest'
import { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { MoaConfigAdapter } from '../moa/adapters/moa-config.js'
import moaExtension from './features/moa.feature.js'
import expertsExtension from './features/experts.feature.js'
import { registerCollaborationRoutes } from '../experts/services/collaboration-routes.js'

const runtimeBase = {
  runtimeToken: 'test-token',
  insecure: false
} as ServerRuntime

describe('extension runtime route contracts', () => {
  it('registers the MoA preset collection and item routes', async () => {
    const router = new Router()
    const moa = new MoaConfigAdapter({ rawConfig: {} })
    const runtime = { ...runtimeBase, extensions: { moa: { moa } } } as ServerRuntime

    expect(moaExtension.registerRoutes).toBeTypeOf('function')
    moaExtension.registerRoutes!(router, runtime)

    expect(router.match('GET', '/v1/moa/presets')).toBeDefined()
    expect(router.match('GET', '/v1/moa/presets/balanced-local')).toBeDefined()
  })

  it('registers collaboration plan and task control routes', () => {
    const router = new Router()
    const service = {}
    const runtime = {
      ...runtimeBase,
      extensions: {
        experts: {
          collaborationStore: service,
          collaborationPlanService: service,
          collaborationTaskService: service,
          collaborationOrchestrator: service
        }
      }
    } as unknown as ServerRuntime

    registerCollaborationRoutes(router, runtime)

    expect(router.match('GET', '/v1/collaboration/plans')).toBeDefined()
    expect(router.match('POST', '/v1/collaboration/tasks/task-1/interrupt')).toBeDefined()
    expect(router.match('POST', '/v1/collaboration/tasks/task-1/retry')).toBeDefined()
  })

  it('matches expert diagnostics before the parameterized expert route', async () => {
    const router = new Router()
    const expertService = {
      diagnostics: () => ({ expertCount: 1 }),
      getExpert: () => undefined,
      getExpertTeam: () => undefined
    }
    const runtime = {
      ...runtimeBase,
      extensions: { experts: { experts: expertService } }
    } as unknown as ServerRuntime
    expertsExtension.registerRoutes!(router, runtime)

    const match = router.match('GET', '/v1/experts/diagnostics')
    expect(match).toBeDefined()
    const response = await match!.handler(new Request('http://localhost/v1/experts/diagnostics', {
      headers: { authorization: 'Bearer test-token' }
    }), { params: match!.params })

    expect(response.status).toBe(200)
  })
})
