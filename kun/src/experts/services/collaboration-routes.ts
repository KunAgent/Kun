import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { CollaborationStore } from './collaboration-store.js'
import { CollaborationPlanService } from './collaboration-plan-service.js'
import { CollaborationTaskService } from './collaboration-task-service.js'
import { CollaborationOrchestrator } from './collaboration-orchestrator.js'
import { authenticated } from '../../seam/auth.js'
import {
  CreateCollaborationPlanSchema,
  CancelCollaborationPlanSchema,
  AnswerClarificationSchema
} from '../contracts/collaboration.js'

/**
 * EXT-SEAM: Collaboration REST API routes.
 *
 * Provides HTTP endpoints for collaboration plan/task management.
 */

export function registerCollaborationRoutes(
  router: Router,
  runtime: ServerRuntime
): void {
  const services = runtime.extensions?.experts as {
    collaborationStore?: CollaborationStore
    collaborationPlanService?: CollaborationPlanService
    collaborationTaskService?: CollaborationTaskService
    collaborationOrchestrator?: CollaborationOrchestrator
  } | undefined

  if (!services?.collaborationStore || !services?.collaborationPlanService ||
      !services?.collaborationTaskService || !services?.collaborationOrchestrator) {
    console.warn('[collaboration] Services not initialized, skipping route registration')
    return
  }

  const { collaborationPlanService, collaborationOrchestrator, collaborationTaskService } = services

  router.add('GET', '/v1/collaboration/plans', authenticated(async () => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plans: await collaborationPlanService.listPlans() })
  }), runtime))

  // POST /v1/collaboration/plans - Create a new collaboration plan
  router.add('POST', '/v1/collaboration/plans', authenticated(async (req, context) => {
    try {
      const bodyText = await req.text()
      const input = CreateCollaborationPlanSchema.parse(JSON.parse(bodyText))
      const plan = await collaborationPlanService.createPlan(input)
      return {
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan })
      }
    } catch (err) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: String(err) })
      }
    }
  }, runtime))

  // GET /v1/collaboration/plans/:id - Get plan by ID
  router.add('GET', '/v1/collaboration/plans/:id', authenticated(async (req, context) => {
    const planId = context.params.id
    const plan = await collaborationPlanService.getPlan(planId)

    if (!plan) {
      return {
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Plan not found' })
      }
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan })
    }
  }, runtime))

  // POST /v1/collaboration/plans/:id/confirm - Confirm a plan
  router.add('POST', '/v1/collaboration/plans/:id/confirm', authenticated(async (req, context) => {
    const planId = context.params.id
    try {
      const plan = await collaborationPlanService.confirmPlan(planId)
      if (!plan) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Plan not found' })
        }
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan })
      }
    } catch (err) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: String(err) })
      }
    }
  }, runtime))

  // POST /v1/collaboration/plans/:id/start - Start executing a plan
  router.add('POST', '/v1/collaboration/plans/:id/start', authenticated(async (req, context) => {
    const planId = context.params.id
    try {
      const plan = await collaborationOrchestrator.startPlan(planId)
      if (!plan) {
        return {
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Plan not found' })
        }
      }
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan })
      }
    } catch (err) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: String(err) })
      }
    }
  }, runtime))

  // POST /v1/collaboration/plans/:id/cancel - Cancel a plan
  router.add('POST', '/v1/collaboration/plans/:id/cancel', authenticated(async (req, context) => {
    const planId = context.params.id
    try {
      const bodyText = await req.text()
      const input = CancelCollaborationPlanSchema.parse(JSON.parse(bodyText))
      await collaborationOrchestrator.terminatePlan(planId, input.reason)
      const plan = await collaborationPlanService.getPlan(planId)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan })
      }
    } catch (err) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: String(err) })
      }
    }
  }, runtime))

  // GET /v1/collaboration/plans/:id/state - Get plan state
  router.add('GET', '/v1/collaboration/plans/:id/state', authenticated(async (req, context) => {
    const planId = context.params.id
    const state = await collaborationOrchestrator.getState(planId)

    if (!state) {
      return {
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Plan not found' })
      }
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state })
    }
  }, runtime))

  // GET /v1/collaboration/tasks/:taskId?planId=... - Get task by ID
  router.add('GET', '/v1/collaboration/tasks/:taskId', authenticated(async (req, context) => {
    const taskId = context.params.taskId
    const planId = new URL(req.url).searchParams.get('planId')

    if (!planId) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'planId query parameter required' })
      }
    }

    const task = await collaborationTaskService.getTask(taskId, planId)
    if (!task) {
      return {
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Task not found' })
      }
    }

    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task })
    }
  }, runtime))

  // POST /v1/collaboration/tasks/:taskId/clarification?planId=... - Answer clarification
  router.add('POST', '/v1/collaboration/tasks/:taskId/clarification', authenticated(async (req, context) => {
    const taskId = context.params.taskId
    try {
      const bodyText = await req.text()
      const input = AnswerClarificationSchema.parse(JSON.parse(bodyText))
      const planId = new URL(req.url).searchParams.get('planId')

      if (!planId) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'planId query parameter required' })
        }
      }

      await collaborationOrchestrator.answerClarification(planId, taskId, input.answer)
      const task = await collaborationTaskService.getTask(taskId, planId)

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task })
      }
    } catch (err) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: String(err) })
      }
    }
  }, runtime))

  const taskControlHandler = (
    action: 'interrupt' | 'retry'
  ) => authenticated(async (req: Request, context: { params: Record<string, string> }) => {
    const taskId = context.params.taskId
    const planId = new URL(req.url).searchParams.get('planId')
    if (!planId) {
      return {
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'planId query parameter required' })
      }
    }
    try {
      const task = action === 'interrupt'
        ? await collaborationTaskService.interruptTaskExecution(planId, taskId)
        : await collaborationTaskService.retryTaskExecution(planId, taskId)
      return {
        status: task ? 200 : 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(task ? { task } : { error: 'Task not found' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: message.startsWith('Cannot ') ? 409 : 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: message })
      }
    }
  }, runtime)

  router.add('POST', '/v1/collaboration/tasks/:taskId/interrupt', taskControlHandler('interrupt'))
  router.add('POST', '/v1/collaboration/tasks/:taskId/retry', taskControlHandler('retry'))
}
