import type { NodeGraphProjection } from '../contracts/node-graph.js'
import { NodeGraphAccumulator } from './node-graph-accumulator.js'
import type { NodeGraphBuildInput } from './node-graph-inputs.js'
import {
  contributeChangedFiles,
  contributeKnowledgeBases,
  contributeMemories,
  contributeThreads
} from './node-graph-sources.js'

/**
 * Pure Node Graph projection. Every input is already loaded, so this function
 * performs no I/O and is fully deterministic for a given input — the service
 * layer owns fetching, timeouts, and caching.
 *
 * Order matters: threads are contributed first so later sources can attach to
 * existing thread nodes instead of inventing placeholders.
 */
export function buildNodeGraphProjection(input: NodeGraphBuildInput): NodeGraphProjection {
  const graph = new NodeGraphAccumulator(input.limits ?? {})
  for (const note of input.diagnostics ?? []) graph.diagnostic(note)
  contributeThreads(graph, input.threads, input.agents ?? [])
  contributeKnowledgeBases(graph, input.knowledgeBases ?? [])
  contributeMemories(graph, input.memories ?? [])
  contributeChangedFiles(graph, input.changedFiles ?? [])
  return graph.finish(input.builtAt, input.workspace)
}
