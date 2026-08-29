import { createHash } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import {
  NODE_GRAPH_CONTRACT_VERSION,
  type NodeGraphNodeKind,
  type NodeGraphProjection
} from '../contracts/node-graph.js'
import type { KnowledgeNode, StoredKnowledgeIndex } from '../knowledge/knowledge-types.js'
import { NodeGraphAccumulator } from './node-graph-accumulator.js'
import {
  basenameOf,
  clipLabel,
  folderOf,
  knowledgeNodeGraphId,
  type NodeGraphLimits
} from './node-graph-inputs.js'

/**
 * Folder projection: one or more directory trees rendered as a graph.
 *
 * This is the Write-workspace view of Node Graph. Unlike the workspace
 * projection it has no threads, memories, or agents — only the files
 * themselves, their `[[wikilinks]]`, and the folders that nest them. Directory
 * nodes are kept here (the workspace projection flattens them away) because
 * "how is this vault organised" is the question a folder graph answers.
 *
 * Several roots can be projected together, which is what lets a link that
 * reaches into a sibling workspace draw a real edge instead of disappearing.
 */

/** Knowledge index kinds that are a fragment of a document rather than a file. */
const SECTION_KINDS = new Set<KnowledgeNode['kind']>([
  'section',
  'range',
  'page',
  'slide',
  'worksheet',
  'cell-range'
])

function graphKindFor(kind: KnowledgeNode['kind']): NodeGraphNodeKind | null {
  if (kind === 'root' || kind === 'directory') return 'folder'
  if (kind === 'document') return 'document'
  return SECTION_KINDS.has(kind) ? 'section' : null
}

export type NodeGraphFolderRoot = {
  /** Absolute directory this tree describes. */
  root: string
  /** Null when the directory has never been indexed or is being rebuilt. */
  index: StoredKnowledgeIndex | null
  /** Index state, surfaced so the UI can explain an empty first load. */
  state?: string
}

export type NodeGraphFolderInput = {
  builtAt: string
  roots: readonly NodeGraphFolderRoot[]
  limits?: Partial<NodeGraphLimits>
  diagnostics?: readonly string[]
  /** Force the truncation flag: the caller dropped roots or hit a scan budget. */
  truncated?: boolean
}

/** Absolute POSIX path of a document, used to match links across roots. */
function absoluteKey(root: string, relativePath: string): string {
  return pathLookupKey(join(root, relativePath))
}

function posix(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Drive-letter (`C:/`) or UNC (`//server/share`) absolute path. */
function isWindowsStylePath(posixPath: string): boolean {
  return /^[a-z]:(\/|$)/i.test(posixPath) || /^\/\/[^/]/.test(posixPath)
}

/**
 * Comparison key for an absolute path. Windows filesystems are
 * case-insensitive, so Windows-style paths fold case; POSIX paths keep it.
 */
function pathLookupKey(value: string): string {
  const normalized = posix(value)
  return isWindowsStylePath(normalized) ? normalized.toLocaleLowerCase() : normalized
}

export function buildNodeGraphFolderProjection(
  input: NodeGraphFolderInput
): NodeGraphProjection {
  const graph = new NodeGraphAccumulator(input.limits ?? {})
  for (const note of input.diagnostics ?? []) graph.diagnostic(note)
  /** Absolute document path -> graph node id, across every root. */
  const documentsByAbsolutePath = new Map<string, string>()
  const scoped = input.roots.filter((entry) => entry.root.trim().length > 0)
  for (const entry of scoped) {
    if (!entry.index) {
      graph.diagnostic(`"${basename(entry.root) || entry.root}" has no ready index yet`)
      continue
    }
    contributeRoot(graph, entry, documentsByAbsolutePath)
  }
  for (const entry of scoped) {
    if (entry.index) contributeReferences(graph, entry, documentsByAbsolutePath)
  }
  const finished = graph.finish(input.builtAt)
  return {
    ...finished,
    version: NODE_GRAPH_CONTRACT_VERSION,
    ...(input.truncated ? { truncated: true } : {}),
    ...(scoped.length === 1 ? { workspace: scoped[0]!.root } : {})
  }
}

function contributeRoot(
  graph: NodeGraphAccumulator,
  entry: NodeGraphFolderRoot,
  documentsByAbsolutePath: Map<string, string>
): void {
  const index = entry.index
  if (!index) return
  const mountId = folderMountId(entry.root)
  const nodes = Object.values(index.nodes)
  const sectionsPerDocument = new Map<string, number>()
  const recordByPath = new Map(index.documents.map((record) => [record.relativePath, record]))
  // Folders and documents first so section parents already exist, and so the
  // per-document section cap is applied against a known owner.
  for (const node of nodes) {
    const kind = graphKindFor(node.kind)
    if (kind !== 'folder' && kind !== 'document') continue
    const id = knowledgeNodeGraphId(mountId, node.id)
    graph.addNode({
      id,
      kind,
      label: labelFor(node, entry.root),
      ...(node.summary ? { subtitle: clipLabel(node.summary, 300) } : {}),
      workspace: entry.root,
      ...(node.relativePath
        ? { path: node.relativePath, folder: folderOf(node.relativePath) }
        : {}),
      mountId,
      knowledgeNodeId: node.id,
      state: node.kind,
      ...fileMetadata(kind === 'document' && node.relativePath
        ? recordByPath.get(node.relativePath)
        : undefined)
    })
    if (kind === 'document' && node.relativePath) {
      documentsByAbsolutePath.set(absoluteKey(entry.root, node.relativePath), id)
    }
  }
  for (const node of nodes) {
    if (graphKindFor(node.kind) !== 'section') continue
    const owner = ownerDocumentId(index.nodes, node)
    if (!owner) continue
    const used = sectionsPerDocument.get(owner) ?? 0
    if (used >= graph.sectionCap) continue
    sectionsPerDocument.set(owner, used + 1)
    graph.addNode({
      id: knowledgeNodeGraphId(mountId, node.id),
      kind: 'section',
      label: clipLabel(node.title, 90),
      ...(node.summary ? { subtitle: clipLabel(node.summary, 300) } : {}),
      workspace: entry.root,
      ...(node.relativePath
        ? { path: node.relativePath, folder: folderOf(node.relativePath) }
        : {}),
      mountId,
      knowledgeNodeId: node.id,
      state: node.kind
    })
  }
  // Containment follows the index's own parent pointers, so folder nesting in
  // the graph is exactly the nesting on disk.
  for (const node of nodes) {
    if (!node.parentId) continue
    const child = knowledgeNodeGraphId(mountId, node.id)
    const parent = knowledgeNodeGraphId(mountId, node.parentId)
    if (!graph.has(child) || !graph.has(parent)) continue
    graph.addEdge('contains', parent, child)
  }
  for (const note of index.diagnostics.slice(0, 8)) graph.diagnostic(note)
}

/**
 * Draws link edges once every root's documents are known, so a reference can
 * resolve into a different workspace.
 */
function contributeReferences(
  graph: NodeGraphAccumulator,
  entry: NodeGraphFolderRoot,
  documentsByAbsolutePath: Map<string, string>
): void {
  const index = entry.index
  if (!index) return
  const mountId = folderMountId(entry.root)
  for (const reference of index.references) {
    const from = knowledgeNodeGraphId(mountId, reference.fromId)
    const to = knowledgeNodeGraphId(mountId, reference.toId)
    if (!graph.has(from) || !graph.has(to)) continue
    graph.addEdge('link', from, to, clipLabel(reference.label, 80))
  }
  for (const reference of index.externalReferences ?? []) {
    const from = knowledgeNodeGraphId(mountId, reference.fromId)
    if (!graph.has(from)) continue
    const to = resolveAcrossRoots(entry.root, reference, documentsByAbsolutePath)
    if (!to || to === from) continue
    graph.addEdge('link', from, to, clipLabel(reference.label, 80))
  }
}

/**
 * Resolves a link that escaped its own base against the absolute filesystem,
 * then matches it to a document in any projected root.
 *
 * A missing extension gets `.md`, mirroring `resolveKnowledgeLink`, and both
 * spellings are tried so `[[../other/note]]` and `[[../other/note.md]]` behave
 * the same.
 */
function resolveAcrossRoots(
  root: string,
  reference: { sourcePath: string; target: string },
  documentsByAbsolutePath: Map<string, string>
): string | null {
  const raw = reference.target.split('#', 1)[0]!.split('?', 1)[0]!.trim()
  if (!raw) return null
  // Windows absolute paths must be recognized before the URI-scheme filter:
  // `C:/notes/a.md` matches the generic scheme expression because of `C:`,
  // and would otherwise be discarded as a URL.
  const windowsAbsolute = isWindowsStylePath(posix(raw))
  if (!windowsAbsolute && /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  const base = windowsAbsolute || isAbsolute(raw)
    ? raw
    : join(root, dirname(reference.sourcePath), raw)
  const normalized = pathLookupKey(base)
  const candidates = /\.[^/]+$/.test(normalized)
    ? [normalized]
    : [`${normalized}.md`, `${normalized}.markdown`, `${normalized}.mdx`]
  for (const candidate of candidates) {
    const found = documentsByAbsolutePath.get(candidate)
    if (found) return found
  }
  return null
}

/** Size and timestamps for a file-backed node, when the index recorded them. */
function fileMetadata(record?: {
  size: number
  mtimeMs: number
  birthtimeMs?: number
}): { sizeBytes?: number; updatedAt?: string; createdAt?: string } {
  if (!record) return {}
  return {
    sizeBytes: record.size,
    ...(record.mtimeMs > 0 ? { updatedAt: new Date(record.mtimeMs).toISOString() } : {}),
    ...(record.birthtimeMs && record.birthtimeMs > 0
      ? { createdAt: new Date(record.birthtimeMs).toISOString() }
      : {})
  }
}

function labelFor(node: KnowledgeNode, root: string): string {
  if (node.kind === 'root') return basename(root) || root
  if (node.relativePath) return basenameOf(node.relativePath)
  return clipLabel(node.title, 90)
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

/**
 * Identity key for a folder root: POSIX separators, no trailing slash, and
 * case-folded for Windows-style paths (drive letters and UNC shares name the
 * same directory in any case). Callers canonicalize symlinks and `.` segments
 * with `realpath` before this, so equal keys mean the same physical tree.
 */
export function folderIdentityKey(root: string): string {
  const normalized = posix(root.trim()).replace(/\/+$/, '') || '/'
  return isWindowsStylePath(normalized) ? normalized.toLocaleLowerCase() : normalized
}

/**
 * Stable, filesystem-safe mount id for a directory. Node ids embed it, so it
 * must not change between loads — and two directories must never share one,
 * or their same-named files would silently merge in the accumulator. A
 * truncated SHA-256 keeps collisions out of practical reach (the previous
 * 32-bit polynomial hash collided on inputs as short as `Aa`/`BB`).
 */
export function folderMountId(root: string): string {
  const digest = createHash('sha256').update(folderIdentityKey(root)).digest('hex')
  return `folder-${digest.slice(0, 16)}`
}
