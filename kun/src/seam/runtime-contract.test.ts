import { describe, expect, it } from 'vitest'
import { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { MoaConfigAdapter } from '../moa/adapters/moa-config.js'
import moaExtension from './features/moa.feature.js'
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

  it('registers a collaboration plan collection route', () => {
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
  })
})
