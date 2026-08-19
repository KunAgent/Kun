import type { KnowledgeNode } from '../knowledge/knowledge-types.js'
import type { NodeGraphAccumulator } from './node-graph-accumulator.js'
import {
  agentNodeId,
  basenameOf,
  clipLabel,
  fileNodeId,
  folderOf,
  knowledgeBaseNodeId,
  knowledgeNodeGraphId,
  memoryNodeId,
  tagNodeId,
  threadNodeId,
  workspaceNodeId,
  type NodeGraphAgentInput,
  type NodeGraphChangedFilesInput,
  type NodeGraphKnowledgeInput,
  type NodeGraphMemoryInput,
  type NodeGraphThreadInput
} from './node-graph-inputs.js'

/** Leaf knowledge kinds that are not whole files render as `section` nodes. */
const SECTION_KINDS = new Set<KnowledgeNode['kind']>([
  'section',
  'range',
  'page',
  'slide',
  'worksheet',
  'cell-range'
])

function addWorkspace(graph: NodeGraphAccumulator, workspace: string): string {
  const id = workspaceNodeId(workspace)
  graph.addNode({
    id,
    kind: 'workspace',
    label: basenameOf(workspace) || workspace,
    subtitle: workspace,
    workspace,
    path: workspace
  })
  return id
}

export function contributeThreads(
  graph: NodeGraphAccumulator,
  threads: readonly NodeGraphThreadInput[],
  agents: readonly NodeGraphAgentInput[] = []
): void {
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]))
  const known = new Set(threads.map((thread) => thread.id))
  for (const thread of threads) {
    const id = threadNodeId(thread.id)
    graph.addNode({
      id,
      kind: 'thread',
      label: clipLabel(thread.title || thread.id),
      ...(thread.mode || thread.relation
        ? { subtitle: [thread.mode, thread.relation].filter(Boolean).join(' · ') }
        : {}),
      workspace: thread.workspace,
      threadId: thread.id,
      ...(thread.status ? { state: thread.status } : {}),
      ...(thread.createdAt ? { createdAt: thread.createdAt } : {}),
      ...(thread.updatedAt ? { updatedAt: thread.updatedAt } : {})
    })
    for (const workspace of [thread.workspace, ...(thread.additionalWorkspaces ?? [])]) {
      if (!workspace) continue
      graph.addEdge('workspace', id, addWorkspace(graph, workspace))
    }
    if (thread.agentId) {
      const agent = agentNodeId(thread.agentId)
      graph.addNode({
        id: agent,
        kind: 'agent',
        label: clipLabel(agentNames.get(thread.agentId) ?? thread.agentId),
        agentId: thread.agentId
      })
      graph.addEdge('agent', id, agent)
    }
    // Only link relations whose other endpoint is inside this projection;
    // a dangling parent would otherwise render as an unlabeled ghost node.
    if (thread.parentThreadId && known.has(thread.parentThreadId)) {
      graph.addEdge('parent', id, threadNodeId(thread.parentThreadId))
    }
    if (thread.forkedFromThreadId && known.has(thread.forkedFromThreadId)) {
      graph.addEdge('fork', id, threadNodeId(thread.forkedFromThreadId))
    }
  }
}

export function contributeMemories(
  graph: NodeGraphAccumulator,
  memories: readonly NodeGraphMemoryInput[]
): void {
  for (const memory of memories) {
    if (memory.deletedAt) continue
    const id = memoryNodeId(memory.id)
    const workspace = memory.workspace ?? memory.project
    graph.addNode({
      id,
      kind: 'memory',
      label: clipLabel(memory.content, 90),
      subtitle: clipLabel(memory.content, 300),
      ...(workspace ? { workspace } : {}),
      memoryId: memory.id,
      state: memory.disabledAt ? 'disabled' : memory.scope,
      ...(memory.updatedAt ? { updatedAt: memory.updatedAt } : {})
    })
    if (workspace) graph.addEdge('workspace', id, addWorkspace(graph, workspace))
    if (memory.sourceThreadId && graph.has(threadNodeId(memory.sourceThreadId))) {
      graph.addEdge('memoryOf', id, threadNodeId(memory.sourceThreadId))
    }
    for (const rawTag of memory.tags ?? []) {
      const tag = rawTag.trim()
      if (!tag) continue
      const tagId = tagNodeId(tag)
      graph.addNode({ id: tagId, kind: 'tag', label: `#${tag}`, tag })
      graph.addEdge('tagged', id, tagId)
    }
  }
}

export function contributeKnowledgeBases(
  graph: NodeGraphAccumulator,
  bases: readonly NodeGraphKnowledgeInput[]
): void {
  for (const base of bases) {
    const baseId = knowledgeBaseNodeId(base.mountId)
    graph.addNode({
      id: baseId,
      kind: 'knowledgeBase',
      label: clipLabel(base.mountName || base.mountId),
      ...(base.index ? { subtitle: base.index.root, path: base.index.root } : {}),
      mountId: base.mountId,
      ...(base.state ? { state: base.state } : {}),
      ...(base.index ? { updatedAt: base.index.builtAt } : {})
    })
    for (const threadId of base.threadIds) {
      const threadNode = threadNodeId(threadId)
      if (graph.has(threadNode)) graph.addEdge('mount', threadNode, baseId)
    }
    if (!base.index) {
      graph.diagnostic(`knowledge base "${base.mountName}" has no ready index yet`)
      continue
    }
    contributeKnowledgeIndex(graph, base, baseId)
  }
}

function contributeKnowledgeIndex(
  graph: NodeGraphAccumulator,
  base: NodeGraphKnowledgeInput,
  baseId: string
): void {
  const index = base.index
  if (!index) return
  const sectionsPerDocument = new Map<string, number>()
  const documentOf = new Map<string, string>()
  for (const node of Object.values(index.nodes)) {
    if (node.kind === 'document') {
      const graphId = knowledgeNodeGraphId(base.mountId, node.id)
      documentOf.set(node.id, graphId)
      graph.addNode({
        id: graphId,
        kind: 'document',
        label: node.relativePath ? basenameOf(node.relativePath) : clipLabel(node.title),
        subtitle: clipLabel(node.summary || node.relativePath || node.title, 300),
        ...(node.relativePath
          ? { path: node.relativePath, folder: folderOf(node.relativePath) }
          : {}),
        mountId: base.mountId,
        knowledgeNodeId: node.id
      })
      graph.addEdge('contains', baseId, graphId)
    }
  }
  for (const node of Object.values(index.nodes)) {
    if (!SECTION_KINDS.has(node.kind)) continue
    const owner = ownerDocumentId(index.nodes, node)
    if (!owner) continue
    const used = sectionsPerDocument.get(owner) ?? 0
    if (used >= graph.sectionCap) continue
    sectionsPerDocument.set(owner, used + 1)
    const graphId = knowledgeNodeGraphId(base.mountId, node.id)
    graph.addNode({
      id: graphId,
      kind: 'section',
      label: clipLabel(node.title, 90),
      subtitle: clipLabel(node.summary, 300),
      ...(node.relativePath
        ? { path: node.relativePath, folder: folderOf(node.relativePath) }
        : {}),
      mountId: base.mountId,
      knowledgeNodeId: node.id,
      state: node.kind
    })
    const parentGraphId = node.parentId
      ? knowledgeNodeGraphId(base.mountId, node.parentId)
      : undefined
    graph.addEdge(
      'contains',
      parentGraphId && graph.has(parentGraphId) ? parentGraphId : documentOf.get(owner) ?? baseId,
      graphId
    )
  }
  for (const reference of index.references) {
    const from = knowledgeNodeGraphId(base.mountId, reference.fromId)
    const to = knowledgeNodeGraphId(base.mountId, reference.toId)
    if (!graph.has(from) || !graph.has(to)) continue
    graph.addEdge('link', from, to, clipLabel(reference.label, 80))
  }
}

/** Walks `parentId` up to the containing `document` node id. */
function ownerDocumentId(
  nodes: Record<string, KnowledgeNode>,
  node: KnowledgeNode
): string | null {
  let current: KnowledgeNode | undefined = node
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (current.kind === 'document') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

export function contributeChangedFiles(
  graph: NodeGraphAccumulator,
  entries: readonly NodeGraphChangedFilesInput[]
): void {
  for (const entry of entries) {
    const threadNode = threadNodeId(entry.threadId)
    if (!graph.has(threadNode)) continue
    for (const path of entry.files) {
      if (!path) continue
      const id = fileNodeId(entry.workspace, path)
      graph.addNode({
        id,
        kind: 'file',
        label: basenameOf(path),
        subtitle: path,
        ...(entry.workspace ? { workspace: entry.workspace } : {}),
        path,
        folder: folderOf(path)
      })
      graph.addEdge('touches', threadNode, id)
    }
  }
}
