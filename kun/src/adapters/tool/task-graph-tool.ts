/**
 * Agent-callable task graph (P1 #2).
 *
 * Lets the model plan and drive a dependency-aware task DAG instead of a flat
 * todo list: add tasks with dependencies/priority/retries, ask which are
 * runnable now (respecting deps + concurrency), and record start/success/
 * failure. State is kept per thread in-memory so a multi-step plan persists
 * across turns within the conversation. This is an agent tool, not a core-loop
 * scheduler — the model decides when to advance the plan.
 */

import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import { TaskGraph } from '../../tasks/task-graph.js'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createTaskGraphTool(options: { rootDir?: string } = {}): LocalTool {
  const graphs = new Map<string, TaskGraph>()
  const graphFor = async (threadId: string): Promise<TaskGraph> => {
    let graph = graphs.get(threadId)
    if (graph) return graph
    graph = options.rootDir ? await loadGraph(options.rootDir, threadId) : new TaskGraph({ concurrency: 1 })
    graphs.set(threadId, graph)
    return graph
  }
  const save = async (threadId: string, graph: TaskGraph): Promise<void> => {
    if (options.rootDir) await saveGraph(options.rootDir, threadId, graph)
  }
  const snapshot = (graph: TaskGraph) => ({
    tasks: graph.list().map((t) => ({
      id: t.id, title: t.title, state: t.state, dependsOn: t.dependsOn,
      priority: t.priority, attempts: t.attempts, maxAttempts: t.maxAttempts,
      ...(t.lastError ? { lastError: t.lastError } : {})
    })),
    runnable: graph.nextRunnable().map((t) => t.id),
    complete: graph.isComplete()
  })

  return LocalToolHost.defineTool({
    name: 'task_graph',
    description:
      'Plan and drive a dependency-aware task graph for this thread. actions: ' +
      '"add" (id,title,dependsOn?,priority?,maxAttempts?), "list", "next" (runnable now), ' +
      '"start" (id), "complete" (id), "fail" (id,error), "pause"/"resume"/"cancel" (id), ' +
      '"set_concurrency" (concurrency). Tasks become runnable only when their dependencies succeed.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'next', 'start', 'complete', 'fail', 'pause', 'resume', 'cancel', 'set_concurrency'] },
        id: { type: 'string' },
        title: { type: 'string' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        priority: { type: 'number' },
        maxAttempts: { type: 'number' },
        error: { type: 'string' },
        concurrency: { type: 'number' }
      },
      required: ['action'],
      additionalProperties: false
    },
    policy: 'auto',
    execute: async (args, context) => {
      const graph = await graphFor(context.threadId)
      const action = typeof args.action === 'string' ? args.action : ''
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      try {
        switch (action) {
          case 'add': {
            if (!id || typeof args.title !== 'string' || !args.title.trim()) {
              return { output: { error: 'id and title are required for add' }, isError: true }
            }
            graph.add({
              id,
              title: args.title.trim(),
              ...(Array.isArray(args.dependsOn) ? { dependsOn: args.dependsOn.filter((d): d is string => typeof d === 'string') } : {}),
              ...(typeof args.priority === 'number' ? { priority: args.priority } : {}),
              ...(typeof args.maxAttempts === 'number' ? { maxAttempts: args.maxAttempts } : {})
            })
            await save(context.threadId, graph)
            return { output: { action, added: id, ...snapshot(graph) } }
          }
          case 'list':
          case 'next':
            return { output: { action, ...snapshot(graph) } }
          case 'start':
            graph.markRunning(id)
            await save(context.threadId, graph)
            return { output: { action, id, ...snapshot(graph) } }
          case 'complete':
            graph.markSucceeded(id)
            await save(context.threadId, graph)
            return { output: { action, id, ...snapshot(graph) } }
          case 'fail': {
            const outcome = graph.markFailed(id, typeof args.error === 'string' ? args.error : 'unspecified failure')
            await save(context.threadId, graph)
            return { output: { action, id, retried: outcome.retried, ...snapshot(graph) } }
          }
          case 'pause': graph.pause(id); await save(context.threadId, graph); return { output: { action, id, ...snapshot(graph) } }
          case 'resume': graph.resume(id); await save(context.threadId, graph); return { output: { action, id, ...snapshot(graph) } }
          case 'cancel': graph.cancel(id); await save(context.threadId, graph); return { output: { action, id, ...snapshot(graph) } }
          case 'set_concurrency':
            graph.setConcurrency(typeof args.concurrency === 'number' ? args.concurrency : 1)
            await save(context.threadId, graph)
            return { output: { action, ...snapshot(graph) } }
          default:
            return { output: { error: `unknown action: ${action}` }, isError: true }
        }
      } catch (error) {
        return { output: { action, error: error instanceof Error ? error.message : String(error) }, isError: true }
      }
    }
  })
}

async function loadGraph(rootDir: string, threadId: string): Promise<TaskGraph> {
  try {
    return TaskGraph.fromJSON(JSON.parse(await readFile(graphPath(rootDir, threadId), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new TaskGraph({ concurrency: 1 })
    throw error
  }
}

async function saveGraph(rootDir: string, threadId: string, graph: TaskGraph): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  const target = graphPath(rootDir, threadId)
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(graph.toJSON(), null, 2), 'utf8')
  await rename(temporary, target)
}

function graphPath(rootDir: string, threadId: string): string {
  return join(rootDir, `${createHash('sha256').update(threadId).digest('hex')}.json`)
}
