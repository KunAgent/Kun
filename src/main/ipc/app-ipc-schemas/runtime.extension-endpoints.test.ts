import { describe, it, expect } from 'vitest'
import { runtimeRequestPayloadSchema } from './runtime'

describe('IPC Extension Endpoints', () => {
  const extensionEndpoints = [
    // Experts
    { path: '/v1/experts', method: 'GET' },
    { path: '/v1/experts', method: 'POST' },
    { path: '/v1/experts/abc123', method: 'GET' },
    { path: '/v1/experts/abc123', method: 'DELETE' },
    { path: '/v1/experts/abc123/enable', method: 'POST' },
    { path: '/v1/experts/abc123/disable', method: 'POST' },
    { path: '/v1/experts/teams', method: 'POST' },
    { path: '/v1/experts/refresh', method: 'POST' },
    { path: '/v1/experts/diagnostics', method: 'GET' },

    // MoA
    { path: '/v1/moa/presets', method: 'GET' },
    { path: '/v1/moa/presets', method: 'POST' },
    { path: '/v1/moa/presets/balanced-local', method: 'GET' },
    { path: '/v1/moa/presets/balanced-local', method: 'DELETE' },

    // Automation
    { path: '/v1/automation/employees', method: 'GET' },
    { path: '/v1/automation/tasks', method: 'GET' },
    { path: '/v1/automation/tasks', method: 'POST' },
    { path: '/v1/automation/tasks/task123', method: 'GET' },
    { path: '/v1/automation/tasks/task123/cancel', method: 'POST' },
    { path: '/v1/automation/approvals', method: 'GET' },
    { path: '/v1/automation/approvals/appr123/approve', method: 'POST' },
    { path: '/v1/automation/approvals/appr123/reject', method: 'POST' },
    { path: '/v1/automation/logs', method: 'GET' },

    // Design
    { path: '/v1/design/libraries', method: 'GET' },
    { path: '/v1/design/libraries/lib123', method: 'GET' },
    { path: '/v1/design/libraries/lib123/reload', method: 'POST' },
    { path: '/v1/design/components/search', method: 'POST' },
    { path: '/v1/design/components/comp123', method: 'GET' },
    { path: '/v1/design/assets/search', method: 'POST' },
    { path: '/v1/design/assets/asset123', method: 'GET' },
    { path: '/v1/design/skills', method: 'GET' },
    { path: '/v1/design/skills/search', method: 'POST' },
    { path: '/v1/design/skills/skill123', method: 'GET' },
    { path: '/v1/design/skills/execute', method: 'POST' },
    { path: '/v1/design/skills/reload', method: 'POST' },

    // Collaboration
    { path: '/v1/collaboration/plans', method: 'GET' },
    { path: '/v1/collaboration/plans', method: 'POST' },
    { path: '/v1/collaboration/plans/plan123', method: 'GET' },
    { path: '/v1/collaboration/plans/plan123/confirm', method: 'POST' },
    { path: '/v1/collaboration/plans/plan123/start', method: 'POST' },
    { path: '/v1/collaboration/plans/plan123/cancel', method: 'POST' },
    { path: '/v1/collaboration/plans/plan123/state', method: 'GET' },
    { path: '/v1/collaboration/tasks/task123', method: 'GET' },
    { path: '/v1/collaboration/tasks/task123/clarification', method: 'POST' },
    { path: '/v1/collaboration/tasks/task123/interrupt', method: 'POST' },
    { path: '/v1/collaboration/tasks/task123/retry', method: 'POST' }
  ]

  extensionEndpoints.forEach(({ path, method }) => {
    it(`should allow ${method} ${path}`, () => {
      const result = runtimeRequestPayloadSchema.safeParse({ path, method })
      expect(result.success).toBe(true)
    })
  })

  it('should reject non-whitelisted extension endpoint', () => {
    const result = runtimeRequestPayloadSchema.safeParse({
      path: '/v1/experts/abc123/nonexistent',
      method: 'POST'
    })
    expect(result.success).toBe(false)
  })

  it('should reject wrong method on extension endpoint', () => {
    const result = runtimeRequestPayloadSchema.safeParse({
      path: '/v1/design/libraries',
      method: 'DELETE' // not in allowedMethods
    })
    expect(result.success).toBe(false)
  })
})
