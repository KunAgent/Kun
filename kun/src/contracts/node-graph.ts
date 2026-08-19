import { z } from 'zod'

/**
 * Node Graph is the Obsidian-style knowledge/relationship map of a Kun
 * workspace. It is unrelated to Graph Mode (`contracts/graph-core.ts`),
 * which models multi-agent orchestration runs. Keep the two vocabularies
 * separate: this contract only ever describes a read-only projection that
 * the renderer draws, never anything the agent loop schedules.
 */
export const NODE_GRAPH_CONTRACT_VERSION = 1 as const

export const NodeGraphNodeKindSchema = z.enum([
  /** A workspace root; the closest analogue to an Obsidian vault. */
  'workspace',
  /** A conversation. */
  'thread',
  /** A subagent profile a thread is bound to. */
  'agent',
  /** A mounted knowledge base. */
  'knowledgeBase',
  /** A directory inside a folder projection. */
  'folder',
  /** An indexed knowledge-base file. */
  'document',
  /** A heading / page / slide / sheet range inside a document. */
  'section',
  /** A durable memory record. */
  'memory',
  /** A memory tag. */
  'tag',
  /** A workspace file a thread changed. */
  'file'
])
export type NodeGraphNodeKind = z.infer<typeof NodeGraphNodeKindSchema>

export const NODE_GRAPH_NODE_KINDS = NodeGraphNodeKindSchema.options

export const NodeGraphEdgeKindSchema = z.enum([
  /** Structural containment: base -> document -> section. */
  'contains',
  /** A `[[wikilink]]` or `[markdown](link)` between documents. */
  'link',
  /** A thread mounting a knowledge base. */
  'mount',
  /** A thread whose `parentThreadId` is the other endpoint. */
  'parent',
  /** A thread forked from the other endpoint. */
  'fork',
  /** Membership in a workspace. */
  'workspace',
  /** A thread bound to a subagent profile. */
  'agent',
  /** A memory captured from a thread. */
  'memoryOf',
  /** A memory carrying a tag. */
  'tagged',
  /** A thread that changed a workspace file. */
  'touches'
])
export type NodeGraphEdgeKind = z.infer<typeof NodeGraphEdgeKindSchema>

export const NODE_GRAPH_EDGE_KINDS = NodeGraphEdgeKindSchema.options

const Label = z.string().max(400)

export const NodeGraphNodeSchema = z.object({
  id: z.string().min(1).max(600),
  kind: NodeGraphNodeKindSchema,
  label: Label,
  /** Hover / inspector detail line. Never secret material. */
  subtitle: Label.optional(),
  /** Owning workspace root, when the node belongs to exactly one. */
  workspace: z.string().max(1_000).optional(),
  /** Workspace- or mount-relative path for document / section / file nodes. */
  path: z.string().max(1_000).optional(),
  /** Containing folder of `path`, exposed so the UI can filter by folder. */
  folder: z.string().max(1_000).optional(),
  threadId: z.string().max(200).optional(),
  agentId: z.string().max(200).optional(),
  mountId: z.string().max(200).optional(),
  /** Originating `KnowledgeNode.id`, so the UI can open the exact evidence. */
  knowledgeNodeId: z.string().max(400).optional(),
  memoryId: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  /** Thread status / memory scope / index state, for coloring and filters. */
  state: z.string().max(80).optional(),
  createdAt: z.string().max(80).optional(),
  updatedAt: z.string().max(80).optional(),
  /** Source size in bytes, for file-backed nodes. */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Edge count. Node radius is derived from this, exactly like Obsidian. */
  degree: z.number().int().nonnegative()
}).strict()
export type NodeGraphNode = z.infer<typeof NodeGraphNodeSchema>

export const NodeGraphEdgeSchema = z.object({
  id: z.string().min(1).max(1_300),
  from: z.string().min(1).max(600),
  to: z.string().min(1).max(600),
  kind: NodeGraphEdgeKindSchema,
  label: Label.optional()
}).strict()
export type NodeGraphEdge = z.infer<typeof NodeGraphEdgeSchema>

export const NodeGraphProjectionSchema = z.object({
  version: z.literal(NODE_GRAPH_CONTRACT_VERSION),
  builtAt: z.string().min(1),
  /** Absent when the projection spans every workspace. */
  workspace: z.string().max(1_000).optional(),
  nodes: z.array(NodeGraphNodeSchema),
  edges: z.array(NodeGraphEdgeSchema),
  /**
   * Node count per kind before truncation, so the UI can explain gaps.
   *
   * Partial on purpose: `z.record` over an enum demands every key, which would
   * make adding a node kind a breaking change for any producer that omits it.
   */
  counts: z.partialRecord(NodeGraphNodeKindSchema, z.number().int().nonnegative()),
  /** True when a cap dropped nodes or edges. */
  truncated: z.boolean(),
  /** Operator-readable notes: skipped mounts, pending indexes, timeouts. */
  diagnostics: z.array(z.string().max(600)).max(64)
}).strict()
export type NodeGraphProjection = z.infer<typeof NodeGraphProjectionSchema>
