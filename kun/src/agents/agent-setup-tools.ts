import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { AgentIdentityService } from './agent-identity-service.js'

const bindings = new WeakMap<ThreadStore, AgentIdentityService>()
export const COMMIT_AGENT_SETUP_TOOL = 'commit_agent_setup'
export const bindAgentSetupDirectory = (threads: ThreadStore, directory: AgentIdentityService) => bindings.set(threads, directory)

const CommitAgentSetup = z.object({
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(160).default(''),
  instructions: z.string().trim().min(1).max(8000)
}).strict()

export function agentSetupTools(threads: ThreadStore) {
  return [LocalToolHost.defineTool({
    name: COMMIT_AGENT_SETUP_TOOL,
    description: 'Save the interviewed Agent identity. Call once when you have enough to write durable name, title, and standing instructions. This does not start other work.',
    toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomAgent === true && Boolean(context.allowedToolNames?.includes(COMMIT_AGENT_SETUP_TOOL)),
    inputSchema: z.toJSONSchema(CommitAgentSetup) as Record<string, unknown>,
    execute: async (args, context) => {
      try { return { output: { agent: await commitAgentSetupFromTool(threads, args, context) } } }
      catch (error) { return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } } }
    }
  })]
}

async function commitAgentSetupFromTool(threads: ThreadStore, args: unknown, context: ToolHostContext) {
  const directory = bindings.get(threads)
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const agentId = thread?.roomContext?.participantAgentId
  if (!directory || !agentId) throw new Error('agent setup binding unavailable')
  const turn = thread.turns.find((item) => item.id === context.turnId)
  if (!turn || turn.status !== 'running') throw new Error('active agent turn required')
  const agent = await directory.active(agentId)
  if (agent.setup?.status !== 'pending') throw new Error('agent interview is not active')
  const input = CommitAgentSetup.parse(args)
  const now = new Date().toISOString()
  const result = await directory.update(agent.id, {
    clientRequestId: context.turnId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || agent.id,
    expectedRevision: agent.revision, name: input.name, title: input.title, instructions: input.instructions,
    setup: { status: 'completed', startedAt: agent.setup!.startedAt, completedAt: now }
  })
  return { id: result.agent.id, name: result.agent.name, title: result.agent.title }
}
