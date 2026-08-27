import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type {
  AppSettingsV1,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowV1
} from '../shared/app-settings'
import {
  parseJsonObject,
  readRequestBody,
  writeJson
} from './schedule-runtime-helpers'
import { summarizeWorkflowForAgent } from './workflow-runtime-helpers'
import type { WorkflowPayload } from './workflow-expression'

type WorkflowWebhookOptions = {
  loadSettings: () => Promise<AppSettingsV1>
  logError: (category: string, message: string, detail?: unknown) => void
  runWorkflowByRef: (
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ) => Promise<WorkflowRunResult>
  runWorkflowInternal: (
    workflow: WorkflowV1,
    triggerNodeId: string,
    triggerLabel: string,
    runId: ReturnType<typeof randomUUID>,
    initialPayload: WorkflowPayload
  ) => Promise<WorkflowRunResult>
  runForHook: (
    idOrName: string,
    payload?: unknown,
    workspaceOverride?: string
  ) => Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }>
  runWorkflowForTool: (
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ) => Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }>
}

export class WorkflowWebhookServer {
  private server: Server | null = null
  private serverKey = ''
  // Synchronous /workflow/run + internal runs execute inside this server's
  // event loop. Cap concurrent awaited runs so several slow workflows cannot
  // pile up unbounded work in the main process.
  private activeRuns = 0
  private static readonly MAX_CONCURRENT_SYNC_RUNS = 4

  constructor(private readonly options: WorkflowWebhookOptions) {}

  sync(settings: AppSettingsV1): void {
    // The same local server hosts webhook-trigger paths, /workflow/internal/* (agent
    // tool) and the public POST /workflow/run, so listen whenever workflows are on.
    const shouldListen = settings.workflow.enabled && settings.workflow.workflows.length > 0
    if (!shouldListen) {
      this.close()
      return
    }
    const key = String(settings.workflow.webhookPort)
    if (this.server && this.serverKey === key) return
    this.close()
    const server = createServer((req, res) => {
      void this.handleWebhookRequest(req, res)
    })
    server.on('error', (error) => {
      this.options.logError('workflow-webhook', 'Webhook server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) this.close()
    })
    // Bind to localhost only — never expose the listener to the network.
    server.listen(settings.workflow.webhookPort, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  close(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.options.loadSettings()
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const secret = settings.workflow.webhookSecret.trim()
      if (secret) {
        const rawHeader = req.headers['x-kun-secret']
        const headerSecret = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
        if (req.headers.authorization !== `Bearer ${secret}` && headerSecret !== secret) {
          writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
          return
        }
      }
      // Internal endpoints used by the GUI-hosted workflow MCP server (agent tool)
      // and the kun hook bridge.
      if (
        pathname === '/workflow/internal/list' ||
        pathname === '/workflow/internal/run' ||
        pathname === '/workflow/internal/hook-run'
      ) {
        await this.handleInternalRequest(pathname, req, res, settings)
        return
      }
      // Public local API: run any workflow by name/id and get its output back.
      if (pathname === '/workflow/run') {
        if (this.activeRuns >= WorkflowWebhookServer.MAX_CONCURRENT_SYNC_RUNS) {
          writeJson(res, 503, { ok: false, message: 'Too many concurrent workflow runs; retry later.' })
          return
        }
        const body = await readRequestBody(req)
        const parsed = parseJsonObject(body) ?? {}
        const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
        if (!idOrName) {
          writeJson(res, 400, { ok: false, message: 'Provide a workflow name or id.' })
          return
        }
        const workspaceOverride = typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : undefined
        this.activeRuns += 1
        let result: Awaited<ReturnType<WorkflowWebhookOptions['runWorkflowByRef']>>
        try {
          result = await this.options.runWorkflowByRef(idOrName, parsed.input, workspaceOverride)
        } finally {
          this.activeRuns -= 1
        }
        writeJson(res, result.ok ? 200 : 400, result)
        return
      }
      const method = req.method ?? 'GET'
      let match: { workflow: WorkflowV1; nodeId: string } | null = null
      for (const workflow of settings.workflow.workflows) {
        if (!workflow.enabled) continue
        for (const node of workflow.nodes) {
          if (node.type !== 'webhook-trigger' || node.disabled) continue
          if (node.config.path !== pathname) continue
          if (node.config.method !== 'ANY' && node.config.method !== method) continue
          match = { workflow, nodeId: node.id }
          break
        }
        if (match) break
      }
      if (!match) {
        writeJson(res, 404, { ok: false, message: 'No enabled workflow matches this webhook.' })
        return
      }
      const body = await readRequestBody(req)
      const parsed = parseJsonObject(body)
      const runId = randomUUID()
      void this.options.runWorkflowInternal(match.workflow, match.nodeId, 'webhook', runId, {
        json: parsed ?? body,
        text: body
      })
      writeJson(res, 200, { ok: true, runId })
    } catch (error) {
      this.options.logError('workflow-webhook', 'Webhook request failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      try {
        writeJson(res, 500, { ok: false, message: 'Internal error.' })
      } catch {
        /* response already sent */
      }
    }
  }

  private async handleInternalRequest(
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
    settings: AppSettingsV1
  ): Promise<void> {
    if (pathname === '/workflow/internal/list') {
      const workflows = settings.workflow.workflows
        .filter((workflow) => workflow.enabled && workflow.callableByAgent)
        .map((workflow) => {
          const manual = workflow.nodes.find((node) => node.type === 'manual-trigger')
          const schema = manual?.type === 'manual-trigger' ? manual.config.inputSchema : undefined
          const inputs = (schema ?? []).map((field) => ({
            key: field.key,
            type: field.type,
            required: field.required,
            description: field.description || field.label
          }))
          return { id: workflow.id, name: workflow.name, description: summarizeWorkflowForAgent(workflow), inputs }
        })
      writeJson(res, 200, { ok: true, workflows })
      return
    }
    const body = await readRequestBody(req)
    const parsed = parseJsonObject(body) ?? {}
    const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
    if (!idOrName) {
      writeJson(res, 400, { ok: false, message: 'Provide a workflow name or id.' })
      return
    }
    const workspaceOverride = typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : undefined
    if (pathname === '/workflow/internal/hook-run') {
      // The hook payload (the kun invocation) is the workflow input; nodes read it via {{json.*}}.
      const result = await this.options.runForHook(idOrName, parsed.payload ?? parsed.input, workspaceOverride)
      writeJson(res, 200, result)
      return
    }
    const result = await this.options.runWorkflowForTool(idOrName, parsed.input, workspaceOverride)
    writeJson(res, result.ok ? 200 : 400, result)
  }

  /** Run a workflow on behalf of the Kun agent tool: resolve by id/name, await it, return its output. */
}
