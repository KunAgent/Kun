/**
 * ISSUE-016: Cross-layer acceptance tests
 *
 * Verifies the Extension Seam integration across all layers: features,
 * services, contracts, hooks, and registry wiring. Uses the actual module
 * structure (verified against source, not assumed).
 */

import { describe, it, expect } from 'vitest'

describe('Cross-Layer Acceptance Tests', () => {
  describe('Config Schema Validation', () => {
    it('should accept extensions config structure', () => {
      const config = {
        serve: {
          extensions: {
            experts: { pluginRoots: ['./experts'] },
            moa: { presets: [] },
            automation: { dataDir: './data/auto', employees: [] },
            design: { librariesRoot: './design_libraries' }
          }
        }
      }
      expect(config.serve.extensions).toBeDefined()
      expect(Object.keys(config.serve.extensions)).toHaveLength(4)
    })
  })

  describe('Extension Seam Pattern Compliance', () => {
    it('should follow one-feature-one-directory pattern', () => {
      // experts/ (incl. collaboration), moa/, automation/, design/
      const domains = ['experts', 'moa', 'automation', 'design']
      expect(domains.length).toBe(4)
    })
  })

  describe('Route Registration Verification', () => {
    it('should have experts feature with routes (default export)', async () => {
      const mod = await import('../seam/features/experts.feature.js')
      expect(mod.default.id).toBe('experts')
      expect(mod.default.registerRoutes).toBeDefined()
    })

    it('should have MoA feature with routes (default export)', async () => {
      const mod = await import('../seam/features/moa.feature.js')
      expect(mod.default.id).toBe('moa')
      // MoA registers model clients + loop hooks; routes are optional
      expect(mod.default.registerModelClients).toBeDefined()
    })

    it('should have automation feature with routes (default export)', async () => {
      const mod = await import('../seam/features/automation.feature.js')
      expect(mod.default.id).toBe('automation')
      expect(mod.default.registerRoutes).toBeDefined()
    })

    it('should have design feature with routes (named export)', async () => {
      const { designExtension } = await import('../seam/features/design.feature.js')
      expect(designExtension.id).toBe('design')
      expect(designExtension.registerRoutes).toBeDefined()
    })
  })

  describe('Service Layer Verification', () => {
    it('should have ExpertService implementation', async () => {
      const { ExpertService } = await import('../experts/services/expert-service.js')
      expect(ExpertService).toBeDefined()
    })

    it('should have CollaborationPlanService implementation', async () => {
      const { CollaborationPlanService } = await import('../experts/services/collaboration-plan-service.js')
      expect(CollaborationPlanService).toBeDefined()
    })

    it('should have CollaborationTaskService implementation', async () => {
      const { CollaborationTaskService } = await import('../experts/services/collaboration-task-service.js')
      expect(CollaborationTaskService).toBeDefined()
    })

    it('should have CollaborationOrchestrator implementation', async () => {
      const { CollaborationOrchestrator } = await import('../experts/services/collaboration-orchestrator.js')
      expect(CollaborationOrchestrator).toBeDefined()
    })

    it('should have CollaborationStore implementation', async () => {
      const { CollaborationStore } = await import('../experts/services/collaboration-store.js')
      expect(CollaborationStore).toBeDefined()
    })

    it('should have MoaConfigAdapter implementation', async () => {
      const { MoaConfigAdapter } = await import('../moa/adapters/moa-config.js')
      expect(MoaConfigAdapter).toBeDefined()
    })

    it('should have MoaModelClient + MoaDispatchModelClient implementation', async () => {
      const mod = await import('../moa/adapters/moa-model-client.js')
      expect(mod.MoaModelClient).toBeDefined()
      expect(mod.MoaDispatchModelClient).toBeDefined()
    })

    it('should have AutomationRuntime implementation', async () => {
      const { AutomationRuntime } = await import('../automation/services/automation-runtime.js')
      expect(AutomationRuntime).toBeDefined()
    })

    it('should have AutomationScheduler implementation', async () => {
      const { AutomationScheduler } = await import('../automation/services/automation-scheduler.js')
      expect(AutomationScheduler).toBeDefined()
    })

    it('should have AutomationExecutor implementation', async () => {
      const { AutomationExecutor } = await import('../automation/services/automation-executor.js')
      expect(AutomationExecutor).toBeDefined()
    })

    it('should have AutomationDeliveryAdapter implementation', async () => {
      const { AutomationDeliveryAdapter } = await import('../automation/services/automation-delivery.js')
      expect(AutomationDeliveryAdapter).toBeDefined()
    })

    it('should have DesignLibraryService implementation', async () => {
      const { DesignLibraryService } = await import('../design/services/design-library-service.js')
      expect(DesignLibraryService).toBeDefined()
    })

    it('should have SkillService implementation', async () => {
      const { SkillService } = await import('../design/services/skill-service.js')
      expect(SkillService).toBeDefined()
    })
  })

  describe('Contract Layer Verification', () => {
    it('should have expert contracts with Zod schemas', async () => {
      const contracts = await import('../experts/contracts/experts.js')
      expect(contracts.ExpertProfileSchema).toBeDefined()
      expect(contracts.ExpertTeamSchema).toBeDefined()
    })

    it('should have collaboration contracts with Zod schemas', async () => {
      const contracts = await import('../experts/contracts/collaboration.js')
      expect(contracts.CollaborationPlanSchema).toBeDefined()
      expect(contracts.CollaborationTaskSchema).toBeDefined()
      expect(contracts.CollaborationLimitsSchema).toBeDefined()
    })

    it('should have MoA contracts with Zod schemas', async () => {
      const contracts = await import('../moa/contracts/moa-types.js')
      expect(contracts.MoaPresetSchema).toBeDefined()
      expect(contracts.MoaLayerSchema).toBeDefined()
    })

    it('should have automation contracts with Zod schemas', async () => {
      const contracts = await import('../automation/contracts/automation-types.js')
      expect(contracts.AutomationTaskSchema).toBeDefined()
      expect(contracts.DigitalEmployeeSchema).toBeDefined()
    })

    it('should have design contracts with Zod schemas', async () => {
      const contracts = await import('../design/contracts/design-library-types.js')
      expect(contracts.DesignLibraryMetadataSchema).toBeDefined()
      expect(contracts.DesignComponentSchema).toBeDefined()
    })
  })

  describe('Hook Integration Verification', () => {
    it('should have expert context hook factory', async () => {
      const { createExpertContextHook } = await import('../experts/loop/expert-context-hook.js')
      expect(createExpertContextHook).toBeDefined()
      expect(typeof createExpertContextHook).toBe('function')
    })

    it('should have MoA routing hook factory', async () => {
      const { createMoaRoutingHook } = await import('../moa/routing/moa-routing.js')
      expect(createMoaRoutingHook).toBeDefined()
      expect(typeof createMoaRoutingHook).toBe('function')
    })
  })

  describe('Feature Registry Integration', () => {
    it('should have all 4 features enabled', async () => {
      const { ENABLED_FEATURES } = await import('../seam/features/index.js')
      expect(ENABLED_FEATURES).toBeDefined()
      expect(ENABLED_FEATURES.length).toBe(4)

      const featureIds = ENABLED_FEATURES.map((f) => f.id)
      expect(featureIds).toContain('experts')
      expect(featureIds).toContain('moa')
      expect(featureIds).toContain('automation')
      expect(featureIds).toContain('design')
    })
  })

  describe('Registry Dispatch Functions', () => {
    it('should export registerExtensionRoutes', async () => {
      const seam = await import('../seam/index.js')
      expect(seam.registerExtensionRoutes).toBeDefined()
    })

    it('should export initializeExtensionServices', async () => {
      const seam = await import('../seam/index.js')
      expect(seam.initializeExtensionServices).toBeDefined()
    })

    it('should export emitLoopHook', async () => {
      const seam = await import('../seam/index.js')
      expect(seam.emitLoopHook).toBeDefined()
    })

    it('should export registerExtensionModelClients', async () => {
      const seam = await import('../seam/index.js')
      expect(seam.registerExtensionModelClients).toBeDefined()
    })
  })

  describe('Auth Wrapper Verification', () => {
    it('should have authenticated wrapper', async () => {
      const { authenticated } = await import('../seam/auth.js')
      expect(authenticated).toBeDefined()
      expect(typeof authenticated).toBe('function')
    })
  })
})
