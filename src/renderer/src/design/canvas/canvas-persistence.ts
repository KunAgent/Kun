import type { CanvasAgentNote, CanvasDocument, CanvasEmbeddedArtifact, CanvasRunningAppFrame, CanvasShape, Point } from './canvas-types'
import { ROOT_SHAPE_ID } from './canvas-types'
import { normalizeRunningAppUrl } from './running-app-frame'
import type { DesignOperation, DesignOperationJournalEntry } from '../graph/design-graph-types'
import type { DesignCodeBinding, DesignCodeBindingTarget } from '../code-binding/code-binding-types'
import { createEmptyMotionDocument } from '../motion/model'
import { parseCanvasMotionDocument } from './canvas-motion-persistence'
import {
  normalizeDesignPersistenceWorkspaceRoot,
  writeDesignWorkspaceFile
} from '../design-persistence-coordinator'

export { parseCanvasMotionDocument } from './canvas-motion-persistence'

const DESIGN_DIR = '.kun-design'
export const MAX_CANVAS_DOCUMENT_OBJECTS = 10_000
export const MAX_CANVAS_CHILDREN_PER_SHAPE = 4_096
export const MAX_CANVAS_GRAPH_DEPTH = 512
export const MAX_CANVAS_POINTS_PER_SHAPE = 20_000

export function canvasDocPath(artifactId: string, baseDir: string = DESIGN_DIR): string {
  return `${baseDir}/${artifactId}/canvas.json`
}

export function canvasDocumentKey(workspaceRoot: string, artifactId: string, baseDir?: string): string {
  return [workspaceRoot, canvasDocPath(artifactId, baseDir)].join('\0')
}

export function serializeCanvasDocument(doc: CanvasDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function parseCanvasAgentNote(raw: unknown): CanvasAgentNote | null {
  if (!isObj(raw)) return null
  if (
    raw.kind !== 'critique' &&
    raw.kind !== 'decision' &&
    raw.kind !== 'todo' &&
    raw.kind !== 'question' &&
    raw.kind !== 'rationale'
  ) {
    return null
  }
  if (typeof raw.body !== 'string' || raw.body.trim().length === 0) return null
  return {
    kind: raw.kind,
    body: raw.body.trim(),
    ...(raw.source === 'agent' ||
    raw.source === 'critic' ||
    raw.source === 'repair' ||
    raw.source === 'user' ||
    raw.source === 'system'
      ? { source: raw.source }
      : {}),
    ...(raw.severity === 'info' || raw.severity === 'warning' || raw.severity === 'error'
      ? { severity: raw.severity }
      : {}),
    ...(Array.isArray(raw.targetIds) ? { targetIds: raw.targetIds.filter((id): id is string => typeof id === 'string') } : {}),
    ...(typeof raw.directionId === 'string' ? { directionId: raw.directionId } : {}),
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.resolved === 'boolean' ? { resolved: raw.resolved } : {})
  }
}

function parseRunningAppFrame(raw: unknown): CanvasRunningAppFrame | null {
  if (!isObj(raw) || typeof raw.url !== 'string') return null
  const url = normalizeRunningAppUrl(raw.url)
  if (!url) return null
  return {
    url,
    ...(typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.trim() } : {}),
    ...(typeof raw.routePath === 'string' && raw.routePath.trim() ? { routePath: raw.routePath.trim() } : {}),
    ...(typeof raw.sourceFile === 'string' && raw.sourceFile.trim() ? { sourceFile: raw.sourceFile.trim() } : {}),
    ...(typeof raw.componentName === 'string' && raw.componentName.trim()
      ? { componentName: raw.componentName.trim() }
      : {}),
    ...(typeof raw.capturedAt === 'string' && raw.capturedAt.trim() ? { capturedAt: raw.capturedAt.trim() } : {}),
    ...(raw.status === 'reachable' || raw.status === 'unreachable' || raw.status === 'unknown'
      ? { status: raw.status }
      : {})
  }
}

function parseEmbeddedArtifact(raw: unknown): CanvasEmbeddedArtifact | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (raw.kind !== 'html' && raw.kind !== 'svg') return null
  return { id: raw.id.trim(), kind: raw.kind }
}

function parseShape(raw: unknown, id: string): CanvasShape | null {
  if (!isObj(raw)) return null
  const type = raw.type
  if (
    type !== 'rect' &&
    type !== 'ellipse' &&
    type !== 'text' &&
    type !== 'image' &&
    type !== 'frame' &&
    type !== 'group' &&
    type !== 'arrow' &&
    type !== 'line' &&
    type !== 'draw'
  )
    return null

  const finiteNumberFields = [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'fontSize',
    'fontWeight',
    'lineHeight'
  ] as const
  if (finiteNumberFields.some((field) =>
    typeof raw[field] === 'number' && !Number.isFinite(raw[field])
  )) return null
  if (
    typeof raw.cornerRadius === 'number' && !Number.isFinite(raw.cornerRadius) ||
    Array.isArray(raw.cornerRadius) && (
      raw.cornerRadius.length !== 4 ||
      raw.cornerRadius.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    )
  ) return null
  if (
    Array.isArray(raw.children) && (
      raw.children.length > MAX_CANVAS_CHILDREN_PER_SHAPE ||
      raw.children.some((child) => typeof child !== 'string' || !child.trim())
    )
  ) return null
  if (
    Array.isArray(raw.points) && (
      raw.points.length > MAX_CANVAS_POINTS_PER_SHAPE ||
      raw.points.some((point) =>
        !isObj(point) ||
        typeof point.x !== 'number' ||
        !Number.isFinite(point.x) ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.y)
      )
    )
  ) return null

  const agentNote = parseCanvasAgentNote(raw.agentNote)
  const runningApp = parseRunningAppFrame(raw.runningApp)
  const embeddedArtifact = parseEmbeddedArtifact(raw.embeddedArtifact)
  return {
    id,
    type: type as CanvasShape['type'],
    name: typeof raw.name === 'string' ? raw.name : id,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    frameId: typeof raw.frameId === 'string' ? raw.frameId : null,
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
    width: typeof raw.width === 'number' ? raw.width : 100,
    height: typeof raw.height === 'number' ? raw.height : 100,
    rotation: typeof raw.rotation === 'number' ? raw.rotation : 0,
    opacity: typeof raw.opacity === 'number' ? raw.opacity : 1,
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
    locked: typeof raw.locked === 'boolean' ? raw.locked : false,
    fills: Array.isArray(raw.fills) ? raw.fills : [],
    strokes: Array.isArray(raw.strokes) ? raw.strokes : [],
    cornerRadius:
      typeof raw.cornerRadius === 'number'
        ? raw.cornerRadius
        : Array.isArray(raw.cornerRadius) && raw.cornerRadius.length === 4
          ? (raw.cornerRadius as [number, number, number, number])
          : 0,
    children: Array.isArray(raw.children) ? raw.children as string[] : [],
    ...(typeof raw.textContent === 'string' && { textContent: raw.textContent }),
    ...(typeof raw.fontSize === 'number' && { fontSize: raw.fontSize }),
    ...(typeof raw.fontFamily === 'string' && { fontFamily: raw.fontFamily }),
    ...(typeof raw.fontWeight === 'number' && { fontWeight: raw.fontWeight }),
    ...(typeof raw.textAlign === 'string' && { textAlign: raw.textAlign as CanvasShape['textAlign'] }),
    ...(typeof raw.lineHeight === 'number' && { lineHeight: raw.lineHeight }),
    ...(typeof raw.fontColor === 'string' && { fontColor: raw.fontColor }),
    ...(typeof raw.imageUrl === 'string' && { imageUrl: raw.imageUrl }),
    ...(typeof raw.aiImageHolder === 'boolean' && { aiImageHolder: raw.aiImageHolder }),
    ...(typeof raw.clipContent === 'boolean' && { clipContent: raw.clipContent }),
    ...(embeddedArtifact ? { embeddedArtifact } : {}),
    ...(typeof raw.htmlArtifactId === 'string' && { htmlArtifactId: raw.htmlArtifactId }),
    ...(runningApp ? { runningApp } : {}),
    ...((raw.devicePreset === 'mobile' ||
      raw.devicePreset === 'tablet' ||
      raw.devicePreset === 'desktop') && {
      devicePreset: raw.devicePreset as CanvasShape['devicePreset']
    }),
    ...(typeof raw.arrowheadStart === 'string' && {
      arrowheadStart: raw.arrowheadStart as CanvasShape['arrowheadStart']
    }),
    ...(typeof raw.arrowheadEnd === 'string' && {
      arrowheadEnd: raw.arrowheadEnd as CanvasShape['arrowheadEnd']
    }),
    ...(Array.isArray(raw.points) && { points: raw.points as Point[] }),
    // Effects / layout / constraints are passed through structurally — the
    // executor's Zod schema is the source of truth on write, so loading trusts
    // the on-disk shape and only guards the container kind to avoid crashes.
    ...(Array.isArray(raw.shadows) && { shadows: raw.shadows as CanvasShape['shadows'] }),
    ...(typeof raw.blendMode === 'string' && { blendMode: raw.blendMode as CanvasShape['blendMode'] }),
    ...(isObj(raw.layout) && { layout: raw.layout as unknown as CanvasShape['layout'] }),
    ...(isObj(raw.constraints) && { constraints: raw.constraints as unknown as CanvasShape['constraints'] }),
    ...(agentNote ? { agentNote } : {})
  }
}

function parseDesignOperation(raw: unknown): DesignOperation | null {
  if (!isObj(raw)) return null
  if (
    typeof raw.id !== 'string' ||
    typeof raw.type !== 'string' ||
    typeof raw.label !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    !Array.isArray(raw.targetIds)
  ) {
    return null
  }
  const source = raw.source
  if (source !== 'canvas' && source !== 'agent' && source !== 'code-bridge' && source !== 'import') return null
  return {
    id: raw.id,
    type: raw.type as DesignOperation['type'],
    label: raw.label,
    source,
    createdAt: raw.createdAt,
    targetIds: raw.targetIds.filter((id): id is string => typeof id === 'string'),
    payload: raw.payload
  }
}

function parseOperationJournalEntry(raw: unknown): DesignOperationJournalEntry | null {
  if (!isObj(raw)) return null
  if (
    typeof raw.id !== 'string' ||
    typeof raw.label !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    !Array.isArray(raw.operations) ||
    !Array.isArray(raw.affectedIds) ||
    !Array.isArray(raw.errors)
  ) {
    return null
  }
  const status = raw.status === 'partial' ? 'partial' : raw.status === 'applied' ? 'applied' : null
  if (!status) return null
  const operations = raw.operations.map(parseDesignOperation).filter((op): op is DesignOperation => Boolean(op))
  return {
    id: raw.id,
    label: raw.label,
    createdAt: raw.createdAt,
    status,
    operations,
    affectedIds: raw.affectedIds.filter((id): id is string => typeof id === 'string'),
    errors: raw.errors
      .filter(isObj)
      .map((error) => ({
        code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        message: typeof error.message === 'string' ? error.message : '',
        ...(typeof error.suggestion === 'string' ? { suggestion: error.suggestion } : {})
      }))
      .filter((error) => error.message.length > 0)
  }
}

function parseGraphMetadata(raw: unknown): CanvasDocument['graph'] {
  if (!isObj(raw) || raw.version !== 1) return undefined
  return {
    version: 1,
    ...(typeof raw.projectId === 'string' ? { projectId: raw.projectId } : {}),
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
    ...(typeof raw.lastJournalEntryId === 'string' ? { lastJournalEntryId: raw.lastJournalEntryId } : {})
  }
}

function parseCodeBindingTarget(raw: unknown): DesignCodeBindingTarget | null {
  if (!isObj(raw)) return null
  return {
    ...(typeof raw.sourceFile === 'string' ? { sourceFile: raw.sourceFile } : {}),
    ...(typeof raw.componentName === 'string' ? { componentName: raw.componentName } : {}),
    ...(typeof raw.exportName === 'string' ? { exportName: raw.exportName } : {}),
    ...(typeof raw.domId === 'string' ? { domId: raw.domId } : {}),
    ...(typeof raw.onlookId === 'string' ? { onlookId: raw.onlookId } : {}),
    ...(typeof raw.astPath === 'string' ? { astPath: raw.astPath } : {}),
    ...(typeof raw.routePath === 'string' ? { routePath: raw.routePath } : {}),
    ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
    ...(typeof raw.column === 'number' ? { column: raw.column } : {})
  }
}

function parseCodeBinding(raw: unknown): DesignCodeBinding | null {
  if (!isObj(raw)) return null
  if (
    typeof raw.id !== 'string' ||
    typeof raw.designObjectId !== 'string' ||
    typeof raw.kind !== 'string' ||
    typeof raw.status !== 'string' ||
    typeof raw.createdAt !== 'string'
  ) {
    return null
  }
  if (!['dom-node', 'component', 'route', 'file', 'generated-code'].includes(raw.kind)) return null
  if (!['active', 'stale', 'missing'].includes(raw.status)) return null
  const target = parseCodeBindingTarget(raw.target)
  if (!target) return null
  return {
    id: raw.id,
    designObjectId: raw.designObjectId,
    kind: raw.kind as DesignCodeBinding['kind'],
    target,
    status: raw.status as DesignCodeBinding['status'],
    createdAt: raw.createdAt,
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
    ...(isObj(raw.metadata) ? { metadata: raw.metadata } : {})
  }
}

/**
 * v1 → v2 migration: v1 stored a frame/group child's x/y RELATIVE to its parent
 * (the old renderer nested children inside the parent's transform). v2 stores
 * absolute coords. Rewrite each non-root shape's x/y to its absolute position
 * (own coord + accumulated ancestor offsets) so visual positions are preserved.
 */
function flattenCoordinatesToAbsolute(
  objects: Record<string, CanvasShape>,
  rootId: string
): void {
  const stack: Array<{ id: string; offsetX: number; offsetY: number }> = [
    { id: rootId, offsetX: 0, offsetY: 0 }
  ]
  while (stack.length > 0) {
    const current = stack.pop()!
    const { id, offsetX, offsetY } = current
    const shape = objects[id]
    if (!shape) continue
    const isRoot = id === rootId
    const absX = isRoot ? shape.x : shape.x + offsetX
    const absY = isRoot ? shape.y : shape.y + offsetY
    if (!isRoot) {
      shape.x = absX
      shape.y = absY
    }
    for (let index = shape.children.length - 1; index >= 0; index -= 1) {
      stack.push({ id: shape.children[index], offsetX: absX, offsetY: absY })
    }
  }
}

export function validateCanvasDocumentGraph(
  objects: Record<string, CanvasShape>,
  rootId: string
): boolean {
  const objectIds = Object.keys(objects)
  if (objectIds.length === 0 || objectIds.length > MAX_CANVAS_DOCUMENT_OBJECTS) return false
  const root = objects[rootId]
  if (!root || root.parentId !== null) return false

  const visited = new Set<string>([rootId])
  const parentByChild = new Map<string, string>()
  const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!
    if (depth > MAX_CANVAS_GRAPH_DEPTH) return false
    const shape = objects[id]
    if (!shape || shape.children.length > MAX_CANVAS_CHILDREN_PER_SHAPE) return false
    const uniqueChildren = new Set<string>()
    for (const childId of shape.children) {
      if (uniqueChildren.has(childId)) return false
      uniqueChildren.add(childId)
      const child = objects[childId]
      if (!child || childId === rootId || child.parentId !== id) return false
      if (parentByChild.has(childId) || visited.has(childId)) return false
      parentByChild.set(childId, id)
      visited.add(childId)
      stack.push({ id: childId, depth: depth + 1 })
    }
  }
  return visited.size === objectIds.length
}

export function parseCanvasDocument(raw: string): CanvasDocument | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(parsed)) return null
  if (parsed.version !== 1 && parsed.version !== 2) return null
  const rootId = typeof parsed.rootId === 'string' ? parsed.rootId : ROOT_SHAPE_ID
  if (!isObj(parsed.objects)) return null
  const rawObjects = Object.entries(parsed.objects as Record<string, unknown>)
  if (rawObjects.length === 0 || rawObjects.length > MAX_CANVAS_DOCUMENT_OBJECTS) return null

  const objects: Record<string, CanvasShape> = {}
  for (const [id, rawShape] of rawObjects) {
    const shape = parseShape(rawShape, id)
    if (!shape) return null
    objects[id] = shape
  }

  if (!validateCanvasDocumentGraph(objects, rootId)) return null
  if (parsed.version === 1) flattenCoordinatesToAbsolute(objects, rootId)
  const graph = parseGraphMetadata(parsed.graph)
  const operationJournal = Array.isArray(parsed.operationJournal)
    ? parsed.operationJournal
        .map(parseOperationJournalEntry)
        .filter((entry): entry is DesignOperationJournalEntry => Boolean(entry))
    : undefined
  const codeBindings = Array.isArray(parsed.codeBindings)
    ? parsed.codeBindings.map(parseCodeBinding).filter((binding): binding is DesignCodeBinding => Boolean(binding))
    : undefined
  const motion = parsed.motion === undefined
    ? createEmptyMotionDocument()
    : parseCanvasMotionDocument(parsed.motion, { rootId, objects }) ?? createEmptyMotionDocument()
  return {
    version: 2,
    rootId,
    objects,
    motion,
    ...(graph ? { graph } : {}),
    ...(operationJournal && operationJournal.length > 0 ? { operationJournal } : {}),
    ...(codeBindings && codeBindings.length > 0 ? { codeBindings } : {})
  }
}

const _saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const _pendingSaves = new Map<string, {
  workspaceRoot: string
  path: string
  content: string
}>()

function canvasSaveKey(workspaceRoot: string, artifactId: string, baseDir: string | undefined): string {
  return canvasDocumentKey(workspaceRoot, artifactId, baseDir)
}

export function persistCanvasDocument(
  workspaceRoot: string,
  artifactId: string,
  doc: CanvasDocument,
  baseDir?: string
): void {
  if (!workspaceRoot) return

  const key = canvasSaveKey(workspaceRoot, artifactId, baseDir)
  const existingTimer = _saveTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  _pendingSaves.set(key, {
    path: canvasDocPath(artifactId, baseDir),
    workspaceRoot,
    content: serializeCanvasDocument(doc)
  })
  const timer = setTimeout(() => {
    _saveTimers.delete(key)
    const pending = _pendingSaves.get(key)
    _pendingSaves.delete(key)
    if (pending) void writeDesignWorkspaceFile(pending)
  }, 600)
  _saveTimers.set(key, timer)
}

export async function flushPendingCanvasDocuments(workspaceRoot?: string): Promise<void> {
  const normalizedRoot = workspaceRoot === undefined
    ? null
    : normalizeDesignPersistenceWorkspaceRoot(workspaceRoot)
  for (;;) {
    const entries = [..._pendingSaves.entries()]
      .filter(([, pending]) =>
        normalizedRoot === null ||
        normalizeDesignPersistenceWorkspaceRoot(pending.workspaceRoot) === normalizedRoot
      )
    if (entries.length === 0) return
    await Promise.all(entries.map(async ([key, pending]) => {
      const timer = _saveTimers.get(key)
      if (timer) clearTimeout(timer)
      _saveTimers.delete(key)
      _pendingSaves.delete(key)
      await writeDesignWorkspaceFile(pending)
    }))
  }
}

export async function loadCanvasDocument(
  workspaceRoot: string,
  artifactId: string,
  baseDir?: string
): Promise<CanvasDocument | null> {
  if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') return null
  try {
    const result = await window.kunGui.readWorkspaceFile({
      path: canvasDocPath(artifactId, baseDir),
      workspaceRoot
    })
    if (!result || !result.ok) return null
    return parseCanvasDocument(result.content)
  } catch {
    return null
  }
}
