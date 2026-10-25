import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  CanvasBoardError,
  CanvasBoardStore,
  summarizeElements,
  type CanvasBoard,
  type CanvasOperation
} from './canvas-board-store'

export const CANVAS_RESOURCE_URI = 'ui://kun-canvas/index.html'
const RESOURCE_PREFIX = 'ui://kun-canvas/'
const APP_MIME = 'text/html;profile=mcp-app'
const MAX_ASSET_BYTES = 8 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.html': 'text/html', '.map': 'application/json'
}

type LaunchOptions = { dataDir: string; appDir: string; fontsDir?: string }

function argValue(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag)
  return index >= 0 ? (argv[index + 1] ?? '').trim() : ''
}

export function parseCanvasLaunchOptions(argv: readonly string[]): LaunchOptions | null {
  if (!argv.includes('--kun-canvas-mcp-server')) return null
  const dataDir = argValue(argv, '--data-dir')
  const appDir = argValue(argv, '--app-dir')
  const fontsDir = argValue(argv, '--fonts-dir')
  return dataDir && appDir ? { dataDir, appDir, ...(fontsDir ? { fontsDir } : {}) } : null
}

const uiMeta = (visibility: Array<'model' | 'app'>) => ({
  ui: { resourceUri: CANVAS_RESOURCE_URI, surface: 'canvas', visibility }
})

function boardResult(board: CanvasBoard, message: string) {
  const elementCount = board.elements.filter((element) => element.isDeleted !== true).length
  return {
    content: [{ type: 'text' as const, text: `${message} Board ${board.boardId} "${board.title}" is at revision ${board.revision} with ${elementCount} elements.` }],
    structuredContent: { boardId: board.boardId, title: board.title, revision: board.revision, elementCount }
  }
}

function errorResult(error: unknown) {
  const text = error instanceof CanvasBoardError
    ? `${error.message}${error.revision !== undefined ? ` (current revision ${error.revision})` : ''}`
    : error instanceof Error ? error.message : String(error)
  return {
    isError: true,
    content: [{ type: 'text' as const, text }],
    ...(error instanceof CanvasBoardError && error.revision !== undefined
      ? { structuredContent: { code: error.code, revision: error.revision } }
      : {})
  }
}

async function guard<T>(run: () => Promise<T>): Promise<T | ReturnType<typeof errorResult>> {
  try {
    return await run()
  } catch (error) {
    return errorResult(error)
  }
}

/**
 * Read one packaged page asset; paths can never leave the app directory.
 * Excalidraw's hand-drawn fonts (`fonts/...`) come from the renderer's copy.
 */
export async function readCanvasAsset(
  appDir: string,
  uri: string,
  fontsDir?: string
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!uri.startsWith(RESOURCE_PREFIX)) return null
  let relativePath = decodeURIComponent(uri.slice(RESOURCE_PREFIX.length).split(/[?#]/)[0] ?? '')
  let base = appDir
  if (fontsDir && relativePath.startsWith('fonts/')) {
    base = fontsDir
    relativePath = relativePath.slice('fonts/'.length)
  }
  const target = normalize(join(base, relativePath))
  const inside = relative(base, target)
  if (!relativePath || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..')) return null
  try {
    const info = await stat(target)
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) return null
    return { bytes: await readFile(target), mimeType: MIME_BY_EXTENSION[extname(target).toLowerCase()] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

const skeletonSchema = z.record(z.string(), z.unknown())
const operationSchema = z.union([
  z.object({ op: z.literal('add'), element: skeletonSchema }).strict(),
  z.object({ op: z.literal('update'), id: z.string().min(1).max(64), props: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ op: z.literal('delete'), id: z.string().min(1).max(64) }).strict()
])

const ELEMENT_GUIDE = 'Elements are Excalidraw skeletons: { id?, type: rectangle|ellipse|diamond|text|arrow|line|frame, x, y, width?, height?, ' +
  'text? (text elements), label?: { text } (shapes and arrows), strokeColor?, backgroundColor?, fillStyle?: solid|hachure|cross-hatch, ' +
  'strokeWidth?, strokeStyle?: solid|dashed|dotted, roughness?: 0|1|2, fontSize?, start?: { id }, end?: { id } (arrow bindings), points? }. ' +
  'Give elements short stable ids so later edits can target them.'

export function createCanvasMcpServer(options: LaunchOptions): McpServer {
  const store = new CanvasBoardStore(options.dataDir)
  const server = new McpServer({ name: 'kun-canvas', version: '1.0.0' }, { capabilities: { resources: {}, tools: {} } })

  server.registerResource('canvas-editor', CANVAS_RESOURCE_URI, {
    title: 'Kun canvas editor',
    mimeType: APP_MIME,
    _meta: { ui: { prefersBorder: false }, 'kun/csp': { wasmUnsafeEval: true } }
  }, async (uri) => {
    const asset = await readCanvasAsset(options.appDir, uri.href, options.fontsDir)
    if (!asset) throw new Error('The canvas editor is not built. Run npm run build:canvas-app.')
    return {
      contents: [{
        uri: uri.href,
        mimeType: APP_MIME,
        text: asset.bytes.toString('utf8'),
        _meta: { ui: { prefersBorder: false }, 'kun/csp': { wasmUnsafeEval: true } }
      }]
    }
  })
  server.registerResource('canvas-assets', new ResourceTemplate('ui://kun-canvas/{+path}', { list: undefined }), {
    title: 'Kun canvas editor assets'
  }, async (uri) => {
    const asset = await readCanvasAsset(options.appDir, uri.href, options.fontsDir)
    if (!asset) throw new Error(`asset not found: ${uri.href}`)
    return { contents: [{ uri: uri.href, mimeType: asset.mimeType, blob: asset.bytes.toString('base64') }] }
  })

  server.registerTool('canvas_create', {
    title: 'Create canvas',
    description: `Create an editable whiteboard canvas that opens in the Kun App panel, where the user can edit it too. ${ELEMENT_GUIDE}`,
    inputSchema: { title: z.string().min(1).max(120), elements: z.array(skeletonSchema).max(500).optional() },
    _meta: uiMeta(['model', 'app'])
  }, async ({ title, elements }) => guard(async () => boardResult(await store.create(title, elements ?? []), 'Created the canvas.')))

  server.registerTool('canvas_open', {
    title: 'Open canvas',
    description: 'Open an existing canvas in the Kun App panel.',
    inputSchema: { boardId: z.string().min(1).max(64) },
    _meta: uiMeta(['model', 'app'])
  }, async ({ boardId }) => guard(async () => boardResult(await store.read(boardId), 'Opened the canvas.')))

  server.registerTool('canvas_read', {
    title: 'Read canvas',
    description: 'Read the latest revision of a canvas as compact element summaries (the user may have edited it). Optionally limit to elementIds.',
    inputSchema: { boardId: z.string().min(1).max(64), elementIds: z.array(z.string().max(64)).max(500).optional() },
    annotations: { readOnlyHint: true }
  }, async ({ boardId, elementIds }) => guard(async () => {
    const board = await store.read(boardId)
    const elements = summarizeElements(board.elements, elementIds)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ boardId, title: board.title, revision: board.revision, elements }) }],
      structuredContent: { boardId, title: board.title, revision: board.revision, elements }
    }
  }))

  server.registerTool('canvas_apply', {
    title: 'Edit canvas',
    description: `Apply element operations to a canvas by id without redrawing it. Read it first and pass expectedRevision; ` +
      `reuse operationId when retrying. Operations: { op: "add", element } | { op: "update", id, props } | { op: "delete", id }. ${ELEMENT_GUIDE}`,
    inputSchema: {
      boardId: z.string().min(1).max(64),
      expectedRevision: z.number().int().positive(),
      operationId: z.string().min(1).max(128).optional(),
      operations: z.array(operationSchema).min(1).max(500)
    },
    _meta: uiMeta(['model', 'app'])
  }, async ({ boardId, expectedRevision, operationId, operations }) => guard(async () => {
    const { board, replayed } = await store.apply({
      boardId, expectedRevision, ...(operationId ? { operationId } : {}), operations: operations as CanvasOperation[]
    })
    return boardResult(board, replayed ? 'The operation was already applied.' : `Applied ${operations.length} operations.`)
  }))

  server.registerTool('canvas_list', {
    title: 'List canvases',
    description: 'List saved canvases, newest first.',
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => guard(async () => {
    const boards = await store.list()
    return { content: [{ type: 'text' as const, text: JSON.stringify({ boards }) }], structuredContent: { boards } }
  }))

  server.registerTool('canvas_export', {
    title: 'Export canvas',
    description: 'Write a canvas as a native .excalidraw file to an absolute path. Existing files need overwrite: true.',
    inputSchema: { boardId: z.string().min(1).max(64), path: z.string().min(1).max(4_096), overwrite: z.boolean().optional() }
  }, async ({ boardId, path, overwrite }) => guard(async () => {
    if (!isAbsolute(path) || extname(path).toLowerCase() !== '.excalidraw') {
      throw new CanvasBoardError('invalid', 'path must be an absolute .excalidraw file path')
    }
    const board = await store.read(boardId)
    const scene = { type: 'excalidraw', version: 2, source: 'kun', elements: board.elements, appState: board.appState, files: board.files }
    await writeFile(path, JSON.stringify(scene, null, 2), { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' })
    return { content: [{ type: 'text' as const, text: `Exported ${board.title} to ${path}.` }], structuredContent: { boardId, path } }
  }))

  server.registerTool('canvas_get', {
    title: 'Load canvas scene',
    description: 'Page only: load the full scene of a canvas.',
    inputSchema: { boardId: z.string().min(1).max(64) },
    _meta: { ui: { visibility: ['app'] } }
  }, async ({ boardId }) => guard(async () => {
    const board = await store.read(boardId)
    return { content: [{ type: 'text' as const, text: `Loaded ${board.boardId}.` }], structuredContent: { board } }
  }))

  server.registerTool('canvas_commit', {
    title: 'Save canvas scene',
    description: 'Page only: save the full scene edited in the canvas page.',
    inputSchema: {
      boardId: z.string().min(1).max(64),
      expectedRevision: z.number().int().positive(),
      elements: z.array(skeletonSchema).max(5_000),
      appState: z.record(z.string(), z.unknown()).optional(),
      files: z.record(z.string(), z.unknown()).optional()
    },
    _meta: { ui: { visibility: ['app'] } }
  }, async (input) => guard(async () => boardResult(await store.commit(input), 'Saved the canvas.')))

  return server
}

export async function runCanvasMcpServerFromArgv(argv: readonly string[]): Promise<boolean> {
  const options = parseCanvasLaunchOptions(argv)
  if (!options) return false
  const server = createCanvasMcpServer(options)
  await server.connect(new StdioServerTransport())
  return true
}
