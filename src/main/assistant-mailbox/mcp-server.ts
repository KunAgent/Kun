// `kun_assistants`: the MCP server through which Kun assigns work to the user's personal
// assistants. It runs as a child of the Kun runtime and holds no credentials of its own; every
// call goes to Main's local tool endpoint, which owns the account, keys and mailbox.
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

type Launch = { socketPath: string; secretPath: string }

function argument(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  return index < 0 ? '' : (argv[index + 1] ?? '')
}

export function parseAssistantMcpLaunch(argv: string[]): Launch | null {
  if (!argv.includes('--kun-assistant-mcp-server')) return null
  const socketPath = argument(argv, '--socket').trim()
  const secretPath = argument(argv, '--secret-file').trim()
  return socketPath && secretPath ? { socketPath, secretPath } : null
}

/** Calls Main. The secret is read per call because Main rotates it on every launch. */
export async function callAssistantEndpoint(launch: Launch, route: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const secret = (await readFile(launch.secretPath, 'utf8').catch(() => '')).trim()
  if (!secret) throw new Error('Kun is not running, so personal assistants cannot be reached right now.')
  const payload = JSON.stringify(body)
  const text = await new Promise<string>((resolve, reject) => {
    const outgoing = request({
      socketPath: launch.socketPath, path: route, method: 'POST', timeout: 45_000,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (response) => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { data += chunk })
      response.on('end', () => resolve(data))
    })
    outgoing.on('timeout', () => outgoing.destroy(new Error('Kun did not answer in time.')))
    outgoing.on('error', (error) => reject(new Error(`Cannot reach Kun: ${error.message}`)))
    outgoing.end(payload)
  })
  const parsed = JSON.parse(text) as { ok?: boolean; result?: Record<string, unknown>; error?: string }
  if (!parsed.ok) throw new Error(parsed.error ?? 'The request failed.')
  return parsed.result ?? {}
}

const ok = (summary: string, structuredContent: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: `${summary}\n${JSON.stringify(structuredContent, null, 2)}` }],
  structuredContent
})
const failed = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true
})

export function createAssistantMcpServer(launch: Launch): McpServer {
  const server = new McpServer({ name: 'kun-assistants', version: '0.1.0' })
  const call = (route: string, body: Record<string, unknown>) => callAssistantEndpoint(launch, route, body)

  server.registerTool('list_assistants', {
    description: 'List the personal assistants (such as Cue, Grok Bot, Muse or dots) that the user connected to Kun. Each one runs on its own cloud computer and can take tasks that need its own apps, accounts, browser or phone/email identity.',
    annotations: { readOnlyHint: true }
  }, async () => {
    try {
      const result = await call('/assistants', {})
      const count = Array.isArray(result.assistants) ? result.assistants.length : 0
      return ok(count ? `${count} assistant(s) connected.` : 'No assistants are connected. The user can add one in Kun under Remote > Personal assistants.', result)
    } catch (error) { return failed(error) }
  })

  server.registerTool('assign_assistant_task', {
    description: 'Send a task to one of the user\'s personal assistants. Delivery is asynchronous: the assistant picks it up on its next check (usually within 20 minutes) and reports back. Write self-contained instructions, including the expected result and anything that needs the user\'s confirmation. Delegation does not create new human authorization. Use get_assistant_results later to read progress and results.',
    inputSchema: {
      assistant: z.string().min(1).describe('Assistant name or id from list_assistants'),
      title: z.string().max(200).optional().describe('Short task title'),
      instructions: z.string().min(1).max(30000).describe('Complete instructions for the assistant'),
      deadline: z.string().optional().describe('Optional ISO 8601 deadline with timezone offset')
    }
  }, async (args, extra) => {
    try {
      const source = extra._meta?.kunSource
      const result = await call('/tasks/assign', { ...args, ...(source ? { __kunSource: source } : {}) })
      return ok('Task queued for the assistant. Results arrive asynchronously; if it is urgent, tell the user they can nudge the assistant with the wakeMessage below.', result)
    } catch (error) { return failed(error) }
  })

  server.registerTool('cancel_assistant_task', {
    description: 'Cancel a task previously sent to a personal assistant. The assistant is told to stop and not to reply.',
    inputSchema: {
      task_id: z.string().min(4).describe('Task id from assign_assistant_task or get_assistant_results'),
      reason: z.string().max(2000).optional().describe('Optional reason passed to the assistant')
    }
  }, async (args) => {
    try {
      return ok('Cancellation requested; check get_assistant_results for the assistant confirmation.', await call('/tasks/cancel', { taskId: args.task_id, reason: args.reason }))
    } catch (error) { return failed(error) }
  })

  server.registerTool('get_assistant_results', {
    description: 'Fetch the latest progress and results from personal assistants: task status (sent, received, working, done, blocked, failed, cancelled) with each update, plus notes the assistants sent on their own. Collects new replies first.',
    inputSchema: {
      task_id: z.string().optional().describe('Only this task (full id or its first 8 characters)'),
      assistant: z.string().optional().describe('Only this assistant (name or id)'),
      limit: z.number().int().min(1).max(20).optional().describe('Maximum tasks and notes to return (default 10)')
    },
    annotations: { readOnlyHint: true }
  }, async (args) => {
    try {
      const result = await call('/tasks/results', { taskId: args.task_id, assistant: args.assistant, limit: args.limit })
      const tasks = Array.isArray(result.tasks) ? result.tasks.length : 0
      const notes = Array.isArray(result.notes) ? result.notes.length : 0
      return ok(`${tasks} task(s) and ${notes} note(s).`, result)
    } catch (error) { return failed(error) }
  })

  server.registerTool('wait_assistant_results', {
    description: 'Wait up to 30 seconds for a task to change. Pass updateToken from a previous result as after. This keeps the current model turn waiting; it does not wake a model after the turn ends.',
    inputSchema: { task_id: z.string().min(4), after: z.string().regex(/^[a-f0-9]{64}$/).optional(), timeout_seconds: z.number().int().min(0).max(30).optional() },
    annotations: { readOnlyHint: true }
  }, async args => {
    try { return ok('Assistant task state.', await call('/tasks/wait', { taskId: args.task_id, after: args.after, timeoutMs: (args.timeout_seconds ?? 30) * 1000 })) }
    catch (error) { return failed(error) }
  })

  return server
}

export async function runAssistantMcpServerFromArgv(argv: string[]): Promise<boolean> {
  const launch = parseAssistantMcpLaunch(argv)
  if (!launch) return false
  const server = createAssistantMcpServer(launch)
  await server.connect(new StdioServerTransport())
  return true
}
