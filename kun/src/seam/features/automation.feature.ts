import type { KunExtension, LoopHookBus } from '../types.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { AutomationRuntime } from '../../automation/services/automation-runtime.js'
import { AutomationTaskStore } from '../../automation/services/automation-task-store.js'
import { AutomationPolicyEngine } from '../../automation/services/automation-policy-engine.js'
import { AutomationExecutor } from '../../automation/services/automation-executor.js'
import type { AutomationSettings } from '../../automation/contracts/automation-types.js'
import { authenticated } from '../auth.js'

/**
 * Automation Feature Extension
 *
 * Registers:
 * - Automation runtime services (task execution, policy, storage)
 * - Routes for digital employee management and task control
 * - No loop hooks needed (automation runs independently of agent loop)
 *
 * Digital employees execute tasks by calling Kun runtime API,
 * not by injecting into the agent loop directly.
 */

// Module-level references for service lifecycle
let automationRuntime: AutomationRuntime | undefined

const automationExtension: KunExtension = {
  id: 'automation',

  async initializeServices(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>> {
    const config = (featureConfig as AutomationSettings | undefined) ?? {
      enabled: false,
      employees: [],
      defaults: {
        actionLevel: 'draft' as const,
        autoReplyEnabled: false,
        maxAutoRepliesPerHour: 10,
        riskThreshold: 'medium' as const,
        approvalPolicy: {
          mode: 'manual' as const,
          requireApprovalRiskAtOrAbove: 'medium' as const,
          timeoutMinutes: 30,
          allowApproverEdit: true
        }
      },
      schedules: []
    }

    // Initialize store under Kun dataDir, never the repository/resource dir.
    const dataDir = typeof runtime.info === 'function'
      ? runtime.info().dataDir
      : process.cwd()
    const taskStore = new AutomationTaskStore(dataDir)

    // Initialize policy engine
    const policyEngine = new AutomationPolicyEngine()

    // Initialize runtime. The in-process executor is attached later in
    // registerRoutes(), where the real ServerRuntime (threadService/turnService/
    // runTurn) is available — initializeServices only receives a stub runtime.
    const automationRt = new AutomationRuntime({
      taskStore,
      policyEngine,
      logError: (category, message, detail) => {
        console.error(`[Automation ${category}]`, message, detail)
      }
    })

    // Sync settings
    automationRt.sync(config)

    // Store reference for routes
    automationRuntime = automationRt

    return { automation: automationRt, automationTaskStore: taskStore, settings: config }
  },

  registerRoutes(router, runtime) {
    if (!automationRuntime) {
      console.warn('[automation] Runtime not initialized, skipping route registration')
      return
    }

    const rt = automationRuntime

    // Attach the in-process executor now that the real runtime is available.
    // This is what actually lets a digital employee run a Kun turn.
    if (runtime.threadService && runtime.turnService && runtime.sessionStore) {
      rt.setExecutor(new AutomationExecutor({
        threadService: runtime.threadService,
        turnService: runtime.turnService,
        sessionStore: runtime.sessionStore,
        runTurn: (threadId, turnId) => runtime.runTurn(threadId, turnId),
        defaultModel: runtime.defaultModel ?? 'deepseek-v4-pro',
        workspace: typeof runtime.info === 'function' ? runtime.info().dataDir : process.cwd()
      }))
    }

    // GET /v1/automation/employees - List digital employees
    router.add('GET', '/v1/automation/employees', authenticated(async () => {
      const services = runtime.extensions?.automation as { settings?: { employees?: unknown[] } } | undefined
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ employees: services?.settings?.employees ?? [] })
      }
    }, runtime))

    // POST /v1/automation/tasks - Run a task
    router.add('POST', '/v1/automation/tasks', authenticated(async (req) => {
      const bodyText = await req.text()
      const input = JSON.parse(bodyText)
      const result = await rt.runTask(input)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result)
      }
    }, runtime))

    // GET /v1/automation/tasks - List tasks
    router.add('GET', '/v1/automation/tasks', authenticated(async (req) => {
      const url = new URL(req.url)
      const filter = {
        employeeId: url.searchParams.get('employeeId') || undefined,
        status: url.searchParams.get('status')?.split(',') as any,
        limit: parseInt(url.searchParams.get('limit') || '200')
      }
      const tasks = await rt.listTasks(filter)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks })
      }
    }, runtime))

    // GET /v1/automation/tasks/:id - Get task details
    router.add('GET', '/v1/automation/tasks/:id', authenticated(async (req, context) => {
      const taskId = context.params.id
      if (!taskId) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Task ID required' })
        }
      }
      const task = await rt.getTask(taskId)
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

    // POST /v1/automation/tasks/:id/cancel - Cancel task
    router.add('POST', '/v1/automation/tasks/:id/cancel', authenticated(async (req, context) => {
      const taskId = context.params.id
      if (!taskId) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Task ID required' })
        }
      }
      const task = await rt.cancelTask(taskId)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task })
      }
    }, runtime))

    // GET /v1/automation/approvals - List approvals
    router.add('GET', '/v1/automation/approvals', authenticated(async (req) => {
      const url = new URL(req.url)
      const filter = {
        employeeId: url.searchParams.get('employeeId') || undefined,
        status: url.searchParams.get('status')?.split(',') as any,
        limit: parseInt(url.searchParams.get('limit') || '200')
      }
      const approvals = await rt.listApprovals(filter)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvals })
      }
    }, runtime))

    // POST /v1/automation/approvals/:id/approve - Approve task
    router.add('POST', '/v1/automation/approvals/:id/approve', authenticated(async (req, context) => {
      const approvalId = context.params.id
      if (!approvalId) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Approval ID required' })
        }
      }
      const bodyText = await req.text()
      const input = JSON.parse(bodyText || '{}')
      const task = await rt.approveTask(approvalId, input)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task })
      }
    }, runtime))

    // POST /v1/automation/approvals/:id/reject - Reject task
    router.add('POST', '/v1/automation/approvals/:id/reject', authenticated(async (req, context) => {
      const approvalId = context.params.id
      if (!approvalId) {
        return {
          status: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Approval ID required' })
        }
      }
      const bodyText = await req.text()
      const input = JSON.parse(bodyText || '{}')
      const task = await rt.rejectTask(approvalId, input)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task })
      }
    }, runtime))

    // GET /v1/automation/logs - List execution logs
    router.add('GET', '/v1/automation/logs', authenticated(async (req) => {
      const url = new URL(req.url)
      const filter = {
        taskId: url.searchParams.get('taskId') || undefined,
        employeeId: url.searchParams.get('employeeId') || undefined,
        limit: parseInt(url.searchParams.get('limit') || '200')
      }
      const logs = await rt.listLogs(filter)
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logs })
      }
    }, runtime))
  }
}

export default automationExtension
