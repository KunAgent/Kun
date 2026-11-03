import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { postJson, WorkflowBridgeError, type BridgeEndpoint } from './claw-schedule-bridge-client'
import { WORKFLOW_TOOL_QUERY_TIMEOUT_MS, WORKFLOW_TOOL_WAIT_TIMEOUT_MS } from './claw-schedule-mcp-timeouts'
import {
  createWorkflowCatalogRefresher,
  type WorkflowCatalogRefresher
} from './claw-schedule-workflow-catalog'

type McpLaunchOptions = {
  baseUrl: string
  secret: string
  workflowBaseUrl: string
  workflowSecret: string
}

/** Schedule endpoints are local and fast; keep the previous 15s ceiling. */
const SCHEDULE_REQUEST_TIMEOUT_MS = 15_000

function parseArgValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

function parseLaunchOptions(argv: string[]): McpLaunchOptions | null {
  if (!argv.includes('--gui-schedule-mcp-server') && !argv.includes('--claw-schedule-mcp-server')) return null
  const baseUrl = parseArgValue(argv, '--base-url').trim() || 'http://127.0.0.1:8787'
  const secret = parseArgValue(argv, '--secret').trim()
  const workflowBaseUrl = parseArgValue(argv, '--workflow-base-url').trim()
  const workflowSecret = parseArgValue(argv, '--workflow-secret').trim()
  return { baseUrl, secret, workflowBaseUrl, workflowSecret }
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {})
  }
}

function errorResult(message: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: message }],
    ...(structuredContent ? { structuredContent } : {}),
    isError: true
  }
}

export type ClawScheduleMcpServerBudgets = {
  /** How long `run_workflow` waits before reporting an unknown outcome. */
  workflowWaitMs?: number
}

export type ClawScheduleMcpServerHandle = {
  server: McpServer
  catalogRefresher?: WorkflowCatalogRefresher
}

/**
 * Builds the MCP server without binding it to a transport, so the registration
 * and its failure behaviour can be exercised over an in-memory transport.
 * Returns null when the argv did not ask for this server.
 */
export function createClawScheduleMcpServerFromArgv(
  argv: string[],
  budgets: ClawScheduleMcpServerBudgets = {}
): ClawScheduleMcpServerHandle | null {
  const options = parseLaunchOptions(argv)
  if (!options) return null
  const workflowWaitMs = budgets.workflowWaitMs ?? WORKFLOW_TOOL_WAIT_TIMEOUT_MS

  const server = new McpServer(
    { name: 'kun-schedule', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  const registerListTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. List scheduled tasks managed by the currently running Kun app.'
        : 'List scheduled tasks managed by the currently running Kun app.'
    }, async (extra) => {
      try {
        const result = await postJson(options, '/schedule/internal/list', {}, {
          timeoutMs: SCHEDULE_REQUEST_TIMEOUT_MS,
          signal: extra.signal
        })
        const tasks = Array.isArray(result.tasks) ? result.tasks : []
        return textResult(
          tasks.length
            ? `Found ${tasks.length} scheduled task(s).`
            : 'No scheduled tasks are configured.',
          { tasks }
        )
      } catch (error) {
        return errorResult(`Failed to list scheduled tasks: ${failureText(error)}`)
      }
    })
  }
  registerListTool('claw_schedule_list')
  registerListTool('gui_schedule_list')

  const registerCreateTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Create a scheduled task in Kun. Supports one-time (`at`), daily, or interval schedules.'
        : 'Create a scheduled task in Kun. Supports one-time (`at`), daily, or interval schedules. When creating from an existing conversation, pass that conversation\'s provider_id, model, and reasoning_effort so the scheduled task keeps the same execution settings.',
      inputSchema: {
        title: z.string().min(1).describe('Short task title shown in the GUI'),
        prompt: z.string().min(1).describe('The prompt/instruction the agent should run at schedule time'),
        schedule_kind: z.enum(['at', 'daily', 'interval']).describe('Schedule type'),
        at_time: z.string().optional().describe('ISO 8601 timestamp with timezone offset, required when schedule_kind is `at`'),
        time_of_day: z.string().optional().describe('24h time like 09:00, required when schedule_kind is `daily`'),
        every_minutes: z.number().int().min(1).max(10080).optional().describe('Interval in minutes, required when schedule_kind is `interval`'),
        workspace_root: z.string().optional().describe('Optional workspace directory override'),
        claw_channel_id: z.string().optional().describe('Optional Claw IM channel id whose persona should run this task'),
        provider_id: z.string().optional().describe('Optional model provider id configured in Kun settings'),
        model: z.string().optional().describe('Optional model id, e.g. deepseek-v4-pro / deepseek-v4-flash'),
        reasoning_effort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional().describe('Optional reasoning strength'),
        mode: z.enum(['agent', 'plan']).optional().describe('Execution mode'),
        enabled: z.boolean().optional().describe('Whether the task should be enabled immediately')
      }
    }, async (args, extra) => {
      try {
        const result = await postJson(options, '/schedule/internal/create', {
          input: {
            title: args.title,
            prompt: args.prompt,
            workspaceRoot: args.workspace_root,
            clawChannelId: args.claw_channel_id,
            providerId: args.provider_id,
            model: args.model,
            reasoningEffort: args.reasoning_effort,
            mode: args.mode,
            enabled: args.enabled,
            schedule: {
              kind: args.schedule_kind,
              atTime: args.at_time,
              timeOfDay: args.time_of_day,
              everyMinutes: args.every_minutes
            }
          }
        }, { timeoutMs: SCHEDULE_REQUEST_TIMEOUT_MS, signal: extra.signal })
        const task = (result.task ?? null) as Record<string, unknown> | null
        return textResult(
          `Scheduled task created: ${typeof task?.title === 'string' ? task.title : args.title}`,
          task ? { task } : undefined
        )
      } catch (error) {
        return errorResult(`Failed to create scheduled task: ${failureText(error)}`)
      }
    })
  }
  registerCreateTool('claw_schedule_create')
  registerCreateTool('gui_schedule_create')

  const registerUpdateTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Update an existing Kun scheduled task.'
        : 'Update an existing Kun scheduled task.',
      inputSchema: {
        task_id: z.string().min(1).describe('Task id returned by gui_schedule_list or gui_schedule_create'),
        title: z.string().optional(),
        prompt: z.string().optional(),
        enabled: z.boolean().optional(),
        workspace_root: z.string().optional(),
        claw_channel_id: z.string().optional(),
        provider_id: z.string().optional(),
        model: z.string().optional(),
        reasoning_effort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).optional(),
        mode: z.enum(['agent', 'plan']).optional(),
        schedule_kind: z.enum(['manual', 'at', 'daily', 'interval']).optional(),
        at_time: z.string().optional(),
        time_of_day: z.string().optional(),
        every_minutes: z.number().int().min(1).max(10080).optional()
      }
    }, async (args, extra) => {
      try {
        const patch: Record<string, unknown> = {}
        if (args.title !== undefined) patch.title = args.title
        if (args.prompt !== undefined) patch.prompt = args.prompt
        if (args.enabled !== undefined) patch.enabled = args.enabled
        if (args.workspace_root !== undefined) patch.workspaceRoot = args.workspace_root
        if (args.claw_channel_id !== undefined) patch.clawChannelId = args.claw_channel_id
        if (args.provider_id !== undefined) patch.providerId = args.provider_id
        if (args.model !== undefined) patch.model = args.model
        if (args.reasoning_effort !== undefined) patch.reasoningEffort = args.reasoning_effort
        if (args.mode !== undefined) patch.mode = args.mode
        if (
          args.schedule_kind !== undefined ||
          args.at_time !== undefined ||
          args.time_of_day !== undefined ||
          args.every_minutes !== undefined
        ) {
          patch.schedule = {
            ...(args.schedule_kind !== undefined ? { kind: args.schedule_kind } : {}),
            ...(args.at_time !== undefined ? { atTime: args.at_time } : {}),
            ...(args.time_of_day !== undefined ? { timeOfDay: args.time_of_day } : {}),
            ...(args.every_minutes !== undefined ? { everyMinutes: args.every_minutes } : {})
          }
        }
        const result = await postJson(options, '/schedule/internal/update', {
          taskId: args.task_id,
          patch
        }, { timeoutMs: SCHEDULE_REQUEST_TIMEOUT_MS, signal: extra.signal })
        const task = (result.task ?? null) as Record<string, unknown> | null
        return textResult(
          `Scheduled task updated: ${typeof task?.title === 'string' ? task.title : args.task_id}`,
          task ? { task } : undefined
        )
      } catch (error) {
        return errorResult(`Failed to update scheduled task: ${failureText(error)}`)
      }
    })
  }
  registerUpdateTool('claw_schedule_update')
  registerUpdateTool('gui_schedule_update')

  const registerDeleteTool = (name: string): void => {
    server.registerTool(name, {
      description: name.startsWith('claw_')
        ? 'Legacy alias. Delete a scheduled task from Kun.'
        : 'Delete a scheduled task from Kun.',
      inputSchema: {
        task_id: z.string().min(1).describe('Task id returned by gui_schedule_list or gui_schedule_create')
      }
    }, async ({ task_id }, extra) => {
      try {
        await postJson(options, '/schedule/internal/delete', { taskId: task_id }, {
          timeoutMs: SCHEDULE_REQUEST_TIMEOUT_MS,
          signal: extra.signal
        })
        return textResult(`Scheduled task deleted: ${task_id}`)
      } catch (error) {
        return errorResult(`Failed to delete scheduled task: ${failureText(error)}`)
      }
    })
  }
  registerDeleteTool('claw_schedule_delete')
  registerDeleteTool('gui_schedule_delete')

  // The `gui_plan_create` MCP tool has been retired in favour of the
  // native Kun `create_plan` tool. See RETIRED_CLAW_GUI_PLAN_TOOL_NAMES
  // for the list of removed tool names.

  // Workflow tools — the same bridge exposes the GUI's node-based workflows that
  // the user marked "callable by agent", by calling the WorkflowRuntime's local
  // /workflow/internal/* endpoints. The GUI only passes --workflow-base-url when
  // Workflow is enabled, so these tools stay hidden instead of failing on a
  // listener that was never started.
  let catalogRefresher: WorkflowCatalogRefresher | undefined
  if (options.workflowBaseUrl) {
    const wf: BridgeEndpoint = { baseUrl: options.workflowBaseUrl, secret: options.workflowSecret }
    const RUN_WORKFLOW_BASE_DESC =
      "Run one of the user's saved \"Create Loop\" workflows by name (or id) and wait for it to finish; returns its final output. When the user's request matches a saved workflow below, prefer running it over doing the steps manually."

    const buildCatalog = (result: Record<string, unknown>): string => {
      const workflows = Array.isArray(result.workflows) ? result.workflows : []
      const lines = workflows
        .map((item: { name?: unknown; description?: unknown }) => {
          const name = typeof item.name === 'string' ? item.name : ''
          const desc = typeof item.description === 'string' ? item.description : ''
          return name ? `- "${name}"${desc ? ` — ${desc}` : ''}` : ''
        })
        .filter((line) => line.length > 0)
      return lines.length
        ? `\n\nWorkflows the user has saved (run by name; call list_workflows for inputs):\n${lines.join('\n')}`
        : ''
    }

    server.registerTool('list_workflows', {
      description:
        'List the GUI "Create Loop" workflows the user marked callable by the agent. Returns each workflow id, name, a short description, and its required inputs. Check this whenever a request might be satisfied by a saved workflow.'
    }, async (extra) => {
      try {
        const result = await postJson(wf, '/workflow/internal/list', {}, {
          timeoutMs: WORKFLOW_TOOL_QUERY_TIMEOUT_MS,
          signal: extra.signal
        })
        const workflows = Array.isArray(result.workflows) ? result.workflows : []
        return textResult(
          workflows.length
            ? `Found ${workflows.length} callable workflow(s).`
            : 'No workflows are marked callable by the agent.',
          { workflows }
        )
      } catch (error) {
        return errorResult(`Failed to list workflows: ${failureText(error)}`)
      }
    })

    const runWorkflowTool = server.registerTool('run_workflow', {
      description: RUN_WORKFLOW_BASE_DESC,
      inputSchema: {
        workflow: z.string().min(1).describe('Workflow name or id from list_workflows'),
        input: z.string().optional().describe('Optional input passed to the trigger; available to nodes as {{text}}'),
        workspace_root: z.string().optional().describe('Optional working directory override for this run')
      }
    }, async (args, extra) => {
      try {
        const result = await postJson(wf, '/workflow/internal/run', {
          workflow: args.workflow,
          input: args.input,
          workspaceRoot: args.workspace_root
        }, { timeoutMs: workflowWaitMs, signal: extra.signal })
        const status = typeof result.status === 'string' ? result.status : 'done'
        const output = typeof result.output === 'string' ? result.output : ''
        const message = typeof result.message === 'string' ? result.message : ''
        return textResult(
          `Workflow "${args.workflow}" finished (${status}).${message ? ` ${message}` : ''}${output ? `\n\nOutput:\n${output}` : ''}`,
          { status, output, message }
        )
      } catch (error) {
        // The bridge stopping its wait is not proof the run failed: the run keeps
        // going inside Kun. Report the unknown outcome instead of a false failure
        // (and never retry a side-effecting run automatically).
        if (error instanceof WorkflowBridgeError && error.code === 'timeout') {
          const budget =
            workflowWaitMs >= 60_000
              ? `${Math.round(workflowWaitMs / 60_000)} minutes`
              : `${Math.round(workflowWaitMs / 1_000)} seconds`
          return errorResult(
            `Workflow "${args.workflow}" did not report back within ${budget}. It may still be running in Kun: the result is unknown, and it was not started again.`,
            { status: 'unknown', output: '', message: 'wait timed out' }
          )
        }
        return errorResult(`Failed to run workflow: ${failureText(error)}`)
      }
    })

    catalogRefresher = createWorkflowCatalogRefresher({
      readCatalog: async () => buildCatalog(await postJson(wf, '/workflow/internal/list', {}, {
        timeoutMs: WORKFLOW_TOOL_QUERY_TIMEOUT_MS
      })),
      // Keeping run_workflow's description (the workflow catalog the agent sees)
      // fresh requires no kun restart: re-fetch on an interval and update the
      // tool only when the list actually changes. update() emits
      // tools/list_changed, so the agent re-reads the catalog on its next turn.
      updateDescription: (catalog) => runWorkflowTool.update({ description: RUN_WORKFLOW_BASE_DESC + catalog }),
      logError: (message) => {
        process.stderr.write(`kun mcp[gui_schedule]: workflow catalog refresh failed: ${message}\n`)
      }
    })
  }

  return { server, ...(catalogRefresher ? { catalogRefresher } : {}) }
}

/**
 * Entry point used by the Electron child process. Initialize happens before any
 * workflow catalog fetch, so an unreachable WorkflowRuntime cannot delay the
 * schedule tools.
 */
export async function runClawScheduleMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const handle = createClawScheduleMcpServerFromArgv(argv)
  if (!handle) return false

  const transport = new StdioServerTransport()
  // connect() chains the handler we set here, so a closed transport stops the
  // catalog timer without losing the SDK's own close handling.
  transport.onclose = () => handle.catalogRefresher?.stop()
  await handle.server.connect(transport)
  // Seeding the catalog only starts after initialize: a slow or unreachable
  // WorkflowRuntime must never block the schedule tools from coming up.
  handle.catalogRefresher?.start()
  return true
}

/**
 * List of MCP tool names that used to act as the GUI plan bridge. The
 * names are kept here as a single source of truth for migration
 * scripts; the actual tools are no longer registered.
 */
export const RETIRED_CLAW_GUI_PLAN_TOOL_NAMES: readonly string[] = ['gui_plan_create'] as const
