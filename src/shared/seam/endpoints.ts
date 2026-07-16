/**
 * EXT-SEAM: Extension endpoint allowlist templates.
 *
 * These templates mirror the routes registered by each feature's seam module
 * in kun/src/seam/features/*.feature.ts. They are merged into the preload IPC
 * allowlist (src/main/ipc/app-ipc-schemas/runtime.ts) so the renderer can reach
 * migrated endpoints through the same validated channel as core routes.
 *
 * Placeholders use `{id}` (matched against a single path segment). Keep methods
 * in sync with the feature routes — an over-permissive method list widens the
 * IPC surface.
 */

export interface ExtensionEndpointTemplate {
  template: string
  allowedMethods: readonly string[]
}

export const EXTENSION_ENDPOINT_TEMPLATES: readonly ExtensionEndpointTemplate[] = [
  // Experts
  { template: '/v1/experts', allowedMethods: ['GET', 'POST'] },
  { template: '/v1/experts/teams', allowedMethods: ['POST'] },
  { template: '/v1/experts/refresh', allowedMethods: ['POST'] },
  { template: '/v1/experts/diagnostics', allowedMethods: ['GET'] },
  { template: '/v1/experts/{id}', allowedMethods: ['GET', 'DELETE'] },
  { template: '/v1/experts/{id}/execution-profile', allowedMethods: ['GET'] },
  { template: '/v1/experts/{id}/enable', allowedMethods: ['POST'] },
  { template: '/v1/experts/{id}/disable', allowedMethods: ['POST'] },
  { template: '/v1/experts/{id}/activate', allowedMethods: ['POST'] },
  { template: '/v1/experts/{id}/deactivate', allowedMethods: ['POST'] },

  // MoA
  { template: '/v1/moa/presets', allowedMethods: ['GET'] },
  { template: '/v1/moa/presets/{id}', allowedMethods: ['GET'] },

  // Automation
  { template: '/v1/automation/employees', allowedMethods: ['GET'] },
  { template: '/v1/automation/tasks', allowedMethods: ['GET', 'POST'] },
  { template: '/v1/automation/tasks/{id}', allowedMethods: ['GET'] },
  { template: '/v1/automation/tasks/{id}/cancel', allowedMethods: ['POST'] },
  { template: '/v1/automation/approvals', allowedMethods: ['GET'] },
  { template: '/v1/automation/approvals/{id}/approve', allowedMethods: ['POST'] },
  { template: '/v1/automation/approvals/{id}/reject', allowedMethods: ['POST'] },
  { template: '/v1/automation/logs', allowedMethods: ['GET'] },

  // Design (literal paths before parameterized to avoid greedy {id} matches)
  { template: '/v1/design/libraries', allowedMethods: ['GET'] },
  { template: '/v1/design/libraries/{id}/reload', allowedMethods: ['POST'] },
  { template: '/v1/design/libraries/{id}', allowedMethods: ['GET'] },
  { template: '/v1/design/components/search', allowedMethods: ['POST'] },
  { template: '/v1/design/components/{id}', allowedMethods: ['GET'] },
  { template: '/v1/design/assets/search', allowedMethods: ['POST'] },
  { template: '/v1/design/assets/{id}', allowedMethods: ['GET'] },
  { template: '/v1/design/skills', allowedMethods: ['GET'] },
  { template: '/v1/design/skills/search', allowedMethods: ['POST'] },
  { template: '/v1/design/skills/execute', allowedMethods: ['POST'] },
  { template: '/v1/design/skills/reload', allowedMethods: ['POST'] },
  { template: '/v1/design/skills/{id}', allowedMethods: ['GET'] },

  // Collaboration
  { template: '/v1/collaboration/plans', allowedMethods: ['GET', 'POST'] },
  { template: '/v1/collaboration/plans/{id}/confirm', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/plans/{id}/start', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/plans/{id}/cancel', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/plans/{id}/state', allowedMethods: ['GET'] },
  { template: '/v1/collaboration/plans/{id}', allowedMethods: ['GET'] },
  { template: '/v1/collaboration/tasks/{id}/clarification', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/tasks/{id}/interrupt', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/tasks/{id}/retry', allowedMethods: ['POST'] },
  { template: '/v1/collaboration/tasks/{id}', allowedMethods: ['GET'] }
]
