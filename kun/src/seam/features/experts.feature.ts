import type { KunExtension, RouteRegistrar, LoopHookBus } from '../types.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Router } from '../../server/router.js'
import { ExpertService, type ExpertServiceOptions } from '../../experts/services/expert-service.js'
import { createExpertContextHook } from '../../experts/loop/expert-context-hook.js'
import { CollaborationStore } from '../../experts/services/collaboration-store.js'
import { CollaborationPlanService } from '../../experts/services/collaboration-plan-service.js'
import { CollaborationTaskService } from '../../experts/services/collaboration-task-service.js'
import { CollaborationOrchestrator } from '../../experts/services/collaboration-orchestrator.js'
import { registerCollaborationRoutes } from '../../experts/services/collaboration-routes.js'
import { authenticated } from '../auth.js'

/**
 * Experts Feature Extension
 *
 * Registers:
 * - Expert management service (plugin scanning, custom experts)
 * - Expert routes (GET /v1/experts, GET /v1/experts/:id)
 * - Expert context hook (injects expert systemPrompt into agent loop)
 */

// Module-level service reference for hook registration
let expertServiceInstance: ExpertService | undefined

const expertsExtension: KunExtension = {
  id: 'experts',

  registerRoutes: ((router: Router, runtime: ServerRuntime) => {
    const services = runtime.extensions?.experts as { experts: ExpertService } | undefined
    const expertService = services?.experts

    // GET /v1/experts - list all experts and teams
    router.add('GET', '/v1/experts', authenticated(async () => {
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
          teams: expertService.listTeams(),
          activation: expertService.getActivationSnapshot()
        })
      }
    }, runtime))

    // Static routes must precede /:id because the Router is first-match.
    router.add('GET', '/v1/experts/diagnostics', authenticated(async () => {
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
        body: JSON.stringify(expertService.diagnostics())
      }
    }, runtime))

    router.add('GET', '/v1/experts/:id/execution-profile', authenticated(async (_req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const profile = context.params.id
        ? expertService.createExecutionProfile(context.params.id)
        : undefined
      return {
        status: profile ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(profile ? { executionProfile: profile } : { error: 'Expert is not active' })
      }
    }, runtime))

    // GET /v1/experts/:id - get expert or team by id
    router.add('GET', '/v1/experts/:id', authenticated(async (req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }

      const id = context.params.id
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
    }, runtime))

    // POST /v1/experts - create custom expert
    router.add('POST', '/v1/experts', authenticated(async (req) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      try {
        const bodyText = await req.text()
        const request = JSON.parse(bodyText)
        const expert = await expertService.createCustomExpert(request)
        return {
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expert })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // POST /v1/experts/teams - create custom expert team
    router.add('POST', '/v1/experts/teams', authenticated(async (req) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      try {
        const bodyText = await req.text()
        const request = JSON.parse(bodyText)
        const team = await expertService.createCustomExpertTeam(request)
        return {
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ team })
        }
      } catch (err) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: String(err) })
        }
      }
    }, runtime))

    // DELETE /v1/experts/:id - delete custom expert
    router.add('DELETE', '/v1/experts/:id', authenticated(async (req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const id = context.params.id
      if (!id) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert ID is required' })
        }
      }
      const deleted = await expertService.deleteCustomExpert(id)
      return {
        status: deleted ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(deleted ? { success: true } : { error: 'Expert not found or not deletable' })
      }
    }, runtime))

    // POST /v1/experts/:id/enable - enable expert
    router.add('POST', '/v1/experts/:id/enable', authenticated(async (req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const id = context.params.id
      if (!id) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert ID is required' })
        }
      }
      const success = await expertService.setEnabled(id, true)
      return {
        status: success ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(success ? { enabled: true } : { error: 'Expert not found' })
      }
    }, runtime))

    // POST /v1/experts/:id/disable - disable expert
    router.add('POST', '/v1/experts/:id/disable', authenticated(async (req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const id = context.params.id
      if (!id) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert ID is required' })
        }
      }
      const success = await expertService.setEnabled(id, false)
      return {
        status: success ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(success ? { enabled: false } : { error: 'Expert not found' })
      }
    }, runtime))

    router.add('POST', '/v1/experts/:id/activate', authenticated(async (_req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const id = context.params.id
      const activation = id ? await expertService.activate(id) : undefined
      return {
        status: activation ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activation ?? { error: 'Expert not found' })
      }
    }, runtime))

    router.add('POST', '/v1/experts/:id/deactivate', authenticated(async (_req, context) => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      const id = context.params.id
      const activation = id ? await expertService.deactivate(id) : undefined
      return {
        status: activation ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(activation ?? { error: 'Expert not found' })
      }
    }, runtime))

    // POST /v1/experts/refresh - refresh plugin scan
    router.add('POST', '/v1/experts/refresh', authenticated(async () => {
      if (!expertService) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Expert service unavailable' })
        }
      }
      await expertService.refresh()
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true })
      }
    }, runtime))

    // Register collaboration routes (Expert Team orchestration)
    registerCollaborationRoutes(router, runtime)
  }) as RouteRegistrar,

  async initializeServices(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>> {
    const config = featureConfig as ExpertServiceOptions | undefined
    if (!config) {
      // Experts feature not configured - skip initialization
      return {}
    }

    const dataDir = runtime.info?.().dataDir || process.cwd()
    const service = new ExpertService({
      pluginRoots: config.pluginRoots || [],
      customExpertsDir: config.customExpertsDir || '~/.kun/experts/custom',
      statusDataDir: `${dataDir}/experts`
    })

    await service.initialize()

    // Store for hook registration (called after initServices)
    expertServiceInstance = service

    // Initialize collaboration services (Expert Team orchestration)
    const collaborationStore = new CollaborationStore({ dataDir })
    await collaborationStore.markRunningTasksInterrupted()
    const collaborationPlanService = new CollaborationPlanService({ store: collaborationStore })
    const collaborationTaskService = new CollaborationTaskService({
      store: collaborationStore,
      planService: collaborationPlanService,
      // Bridge task dispatch to Kun thread/turn services (wired in registerRoutes context)
      startTask: async (task) => {
        // Create a thread for the task assigned to an expert
        if (!runtime.threadService || !runtime.turnService) {
          throw new Error('Thread/turn services unavailable for collaboration task dispatch')
        }
        const thread = await runtime.threadService.create({
          title: `[Collaboration] ${task.title}`,
          workspace: dataDir,
          model: runtime.defaultModel ?? 'deepseek-v4-pro',
          mode: 'agent',
          ...(task.assignedExpertId ? { expertId: task.assignedExpertId } : {})
        })
        const started = await runtime.turnService.startTurn({
          threadId: thread.id,
          request: {
            prompt: task.description,
            disableUserInput: true,
            attachmentIds: [],
            fileReferences: []
          }
        })
        void runtime.runTurn(thread.id, started.turnId)
        return { threadId: thread.id, turnId: started.turnId }
      },
      cancelTask: async (threadId, turnId) => {
        const thread = await runtime.threadService?.get(threadId)
        const running = turnId
          ? thread?.turns.find((turn) => turn.id === turnId)
          : thread?.turns.find((turn) => turn.status === 'running' || turn.status === 'queued')
        if (running && runtime.turnService) {
          await runtime.turnService.interruptTurn({ threadId, turnId: running.id })
        }
      }
    })
    const collaborationOrchestrator = new CollaborationOrchestrator({
      store: collaborationStore,
      planService: collaborationPlanService,
      taskService: collaborationTaskService
    })

    return {
      experts: service,
      collaborationStore,
      collaborationPlanService,
      collaborationTaskService,
      collaborationOrchestrator
    }
  },

  registerLoopHooks(bus: LoopHookBus) {
    if (!expertServiceInstance) {
      // Expert service not initialized, skip hook registration
      return
    }

    // Register hook to inject expert systemPrompt before each model request
    const hook = createExpertContextHook({ expertService: expertServiceInstance })
    bus.on('beforeModelRequest', hook)
  }
}

export default expertsExtension
