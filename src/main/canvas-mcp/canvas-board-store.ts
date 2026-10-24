import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CANVAS_MAX_ELEMENTS = 5_000
export const CANVAS_MAX_BOARD_BYTES = 6 * 1024 * 1024
const MAX_RECENT_OPERATIONS = 64
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const BOARD_ID_PATTERN = /^cb_[a-z0-9]{12}$/
const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'frame'])
const UPDATABLE_PROPS = [
  'x', 'y', 'width', 'height', 'angle', 'text', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth',
  'strokeStyle', 'roughness', 'opacity', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign', 'points',
  'groupIds', 'locked', 'link', 'name'
] as const

export type CanvasElement = Record<string, unknown> & { id: string; type: string }

export type CanvasBoard = {
  version: 1
  boardId: string
  title: string
  revision: number
  createdAt: string
  updatedAt: string
  elements: CanvasElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
  /** True while model-authored skeleton elements still need page normalization. */
  pending: boolean
  recentOperations: string[]
}

export type CanvasOperation =
  | { op: 'add'; element: Record<string, unknown> }
  | { op: 'update'; id: string; props: Record<string, unknown> }
  | { op: 'delete'; id: string }

export class CanvasBoardError extends Error {
  constructor(readonly code: 'not_found' | 'invalid' | 'conflict' | 'too_large', message: string, readonly revision?: number) {
    super(message)
    this.name = 'CanvasBoardError'
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function newElementId(): string {
  return `el_${randomBytes(6).toString('hex')}`
}

/** Validate a model-authored skeleton; the page converts it with Excalidraw's own converter. */
export function normalizeSkeleton(input: Record<string, unknown>): CanvasElement {
  const type = typeof input.type === 'string' ? input.type : ''
  if (!SHAPE_TYPES.has(type)) throw new CanvasBoardError('invalid', `unsupported element type: ${type || '(missing)'}`)
  if (!finiteNumber(input.x) || !finiteNumber(input.y)) throw new CanvasBoardError('invalid', 'elements need numeric x and y')
  const id = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : newElementId()
  const element: CanvasElement = { ...input, id, type, kunSkeleton: true }
  if (type === 'text' && typeof element.text !== 'string') throw new CanvasBoardError('invalid', 'text elements need text')
  return element
}

function boundTextId(element: CanvasElement): string | undefined {
  const bound = Array.isArray(element.boundElements) ? element.boundElements : []
  for (const entry of bound) {
    const item = record(entry)
    if (item?.type === 'text' && typeof item.id === 'string') return item.id
  }
  return undefined
}

function labelOf(element: CanvasElement, byId: Map<string, CanvasElement>): string | undefined {
  if (typeof element.text === 'string') return element.text
  const label = record(element.label)
  if (typeof label?.text === 'string') return label.text
  const textId = boundTextId(element)
  const text = textId ? byId.get(textId)?.text : undefined
  return typeof text === 'string' ? text : undefined
}

function bindingId(value: unknown): string | undefined {
  const binding = record(value)
  const id = binding?.elementId ?? binding?.id
  return typeof id === 'string' ? id : undefined
}

/** Compact, model-friendly description of the live elements. */
export function summarizeElements(elements: readonly CanvasElement[], ids?: readonly string[]): Array<Record<string, unknown>> {
  const live = elements.filter((element) => element.isDeleted !== true)
  const byId = new Map(live.map((element) => [element.id, element]))
  const wanted = ids?.length ? new Set(ids) : null
  const summaries: Array<Record<string, unknown>> = []
  for (const element of live) {
    if (typeof element.containerId === 'string' && byId.has(element.containerId)) continue
    if (wanted && !wanted.has(element.id)) continue
    const label = labelOf(element, byId)
    summaries.push({
      id: element.id,
      type: element.type,
      x: Math.round(Number(element.x) || 0),
      y: Math.round(Number(element.y) || 0),
      ...(finiteNumber(element.width) ? { width: Math.round(element.width) } : {}),
      ...(finiteNumber(element.height) ? { height: Math.round(element.height) } : {}),
      ...(label ? { text: label.slice(0, 300) } : {}),
      ...(typeof element.strokeColor === 'string' ? { strokeColor: element.strokeColor } : {}),
      ...(typeof element.backgroundColor === 'string' && element.backgroundColor !== 'transparent'
        ? { backgroundColor: element.backgroundColor } : {}),
      ...(bindingId(element.startBinding ?? element.start) ? { start: bindingId(element.startBinding ?? element.start) } : {}),
      ...(bindingId(element.endBinding ?? element.end) ? { end: bindingId(element.endBinding ?? element.end) } : {}),
      ...(Array.isArray(element.groupIds) && element.groupIds.length ? { groupIds: element.groupIds } : {})
    })
  }
  return summaries
}

function applyOperation(elements: CanvasElement[], operation: CanvasOperation): CanvasElement[] {
  if (operation.op === 'add') {
    const element = normalizeSkeleton(operation.element)
    if (elements.some((candidate) => candidate.id === element.id && candidate.isDeleted !== true)) {
      throw new CanvasBoardError('invalid', `element ${element.id} already exists`)
    }
    return [...elements, element]
  }
  const target = elements.find((element) => element.id === operation.id && element.isDeleted !== true)
  if (!target) throw new CanvasBoardError('invalid', `unknown element ${operation.id}`)
  if (operation.op === 'delete') {
    return elements
      .filter((element) => element.id !== target.id && element.containerId !== target.id)
      .map((element) => {
        const next = { ...element }
        if (bindingId(next.startBinding) === target.id) next.startBinding = null
        if (bindingId(next.endBinding) === target.id) next.endBinding = null
        if (Array.isArray(next.boundElements)) {
          next.boundElements = next.boundElements.filter((entry) => record(entry)?.id !== target.id)
        }
        return next
      })
  }
  const patch: Record<string, unknown> = {}
  for (const key of UPDATABLE_PROPS) {
    if (key in operation.props) patch[key] = operation.props[key]
  }
  const label = record(operation.props.label)
  const textId = boundTextId(target)
  return elements.map((element) => {
    if (element.id === target.id) {
      const next: CanvasElement = { ...element, ...patch, kunDirty: true }
      if (label && target.kunSkeleton === true) next.label = { ...record(target.label), ...label }
      if (typeof patch.text === 'string') next.originalText = patch.text
      return next
    }
    if (label && textId && element.id === textId && typeof label.text === 'string') {
      return { ...element, text: label.text, originalText: label.text, kunDirty: true }
    }
    return element
  })
}

/**
 * File-backed canvas documents. One JSON file per board in the server data
 * directory; writes are atomic and every mutation advances the revision.
 */
export class CanvasBoardStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string, private readonly nowIso: () => string = () => new Date().toISOString()) {}

  async create(title: string, elements: readonly Record<string, unknown>[] = []): Promise<CanvasBoard> {
    if (elements.length > CANVAS_MAX_ELEMENTS) throw new CanvasBoardError('too_large', 'too many elements')
    const now = this.nowIso()
    const board: CanvasBoard = {
      version: 1,
      boardId: `cb_${randomBytes(6).toString('hex')}`,
      title: title.trim().slice(0, 120) || 'Canvas',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      elements: elements.map(normalizeSkeleton),
      appState: {},
      files: {},
      pending: elements.length > 0,
      recentOperations: []
    }
    return this.serialize(() => this.write(board))
  }

  async read(boardId: string): Promise<CanvasBoard> {
    if (!BOARD_ID_PATTERN.test(boardId)) throw new CanvasBoardError('not_found', `unknown board ${boardId}`)
    let raw: string
    try {
      raw = await readFile(this.path(boardId), 'utf8')
    } catch {
      throw new CanvasBoardError('not_found', `unknown board ${boardId}`)
    }
    return JSON.parse(raw) as CanvasBoard
  }

  async list(): Promise<Array<Pick<CanvasBoard, 'boardId' | 'title' | 'revision' | 'updatedAt'> & { elementCount: number }>> {
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }
    const boards = await Promise.all(names
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.read(name.slice(0, -5)).catch(() => null)))
    return boards
      .filter((board): board is CanvasBoard => board !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((board) => ({
        boardId: board.boardId,
        title: board.title,
        revision: board.revision,
        updatedAt: board.updatedAt,
        elementCount: board.elements.filter((element) => element.isDeleted !== true).length
      }))
  }

  async apply(input: {
    boardId: string
    expectedRevision?: number
    operationId?: string
    operations: readonly CanvasOperation[]
  }): Promise<{ board: CanvasBoard; replayed: boolean }> {
    return this.serialize(async () => {
      const board = await this.read(input.boardId)
      if (input.operationId && board.recentOperations.includes(input.operationId)) return { board, replayed: true }
      if (input.expectedRevision !== undefined && input.expectedRevision !== board.revision) {
        throw new CanvasBoardError('conflict', `board is at revision ${board.revision}`, board.revision)
      }
      let elements = board.elements
      for (const operation of input.operations) elements = applyOperation(elements, operation)
      if (elements.length > CANVAS_MAX_ELEMENTS) throw new CanvasBoardError('too_large', 'too many elements')
      const next: CanvasBoard = {
        ...board,
        elements,
        pending: board.pending || input.operations.some((operation) => operation.op !== 'delete'),
        revision: board.revision + 1,
        updatedAt: this.nowIso(),
        recentOperations: input.operationId
          ? [...board.recentOperations, input.operationId].slice(-MAX_RECENT_OPERATIONS)
          : board.recentOperations
      }
      return { board: await this.write(next), replayed: false }
    })
  }

  /** Replace the scene with a full draft from the live editor page. */
  async commit(input: {
    boardId: string
    expectedRevision: number
    elements: readonly Record<string, unknown>[]
    appState?: Record<string, unknown>
    files?: Record<string, unknown>
    title?: string
  }): Promise<CanvasBoard> {
    return this.serialize(async () => {
      const board = await this.read(input.boardId)
      if (input.expectedRevision !== board.revision) {
        throw new CanvasBoardError('conflict', `board is at revision ${board.revision}`, board.revision)
      }
      if (input.elements.length > CANVAS_MAX_ELEMENTS) throw new CanvasBoardError('too_large', 'too many elements')
      const elements = input.elements.map((element) => {
        if (typeof element.id !== 'string' || typeof element.type !== 'string') {
          throw new CanvasBoardError('invalid', 'committed elements need id and type')
        }
        const { kunSkeleton: _skeleton, kunDirty: _dirty, ...rest } = element
        return rest as CanvasElement
      })
      return this.write({
        ...board,
        elements,
        appState: input.appState ?? board.appState,
        files: input.files ?? board.files,
        title: input.title?.trim().slice(0, 120) || board.title,
        pending: false,
        revision: board.revision + 1,
        updatedAt: this.nowIso()
      })
    })
  }

  private path(boardId: string): string {
    return join(this.dir, `${boardId}.json`)
  }

  private async write(board: CanvasBoard): Promise<CanvasBoard> {
    const serialized = JSON.stringify(board)
    if (Buffer.byteLength(serialized, 'utf8') > CANVAS_MAX_BOARD_BYTES) {
      throw new CanvasBoardError('too_large', 'board exceeds 6 MiB')
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const temporary = `${this.path(board.boardId)}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.path(board.boardId))
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return board
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(task)
    this.queue = next.catch(() => undefined)
    return next
  }
}
