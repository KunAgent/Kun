import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CANVAS_RESOURCE_URI, createCanvasMcpServer, parseCanvasLaunchOptions, readCanvasAsset } from './canvas-mcp-server'

describe('canvas MCP server', () => {
  let root: string
  let client: Client

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-canvas-server-'))
    await mkdir(join(root, 'app', 'assets'), { recursive: true })
    await mkdir(join(root, 'fonts', 'Excalifont'), { recursive: true })
    await writeFile(join(root, 'app', 'index.html'), '<!doctype html><div id="root"></div>')
    await writeFile(join(root, 'app', 'assets', 'main.js'), 'console.log(1)')
    await writeFile(join(root, 'fonts', 'Excalifont', 'a.woff2'), 'font')
    await writeFile(join(root, 'secret.txt'), 'secret')
    const server = createCanvasMcpServer({ dataDir: join(root, 'boards'), appDir: join(root, 'app'), fontsDir: join(root, 'fonts') })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: 'test', version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  })
  afterEach(async () => {
    await client.close()
    await rm(root, { recursive: true, force: true })
  })

  it('declares UI metadata and app-only visibility on its tools', async () => {
    const { tools } = await client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    expect(byName.get('canvas_create')?._meta).toEqual({
      ui: { resourceUri: CANVAS_RESOURCE_URI, surface: 'canvas', visibility: ['model', 'app'] }
    })
    expect(byName.get('canvas_commit')?._meta).toEqual({ ui: { visibility: ['app'] } })
    expect(byName.get('canvas_read')?._meta).toBeUndefined()
  })

  it('serves the editor page and its relative assets as ui:// resources', async () => {
    const page = await client.readResource({ uri: CANVAS_RESOURCE_URI })
    expect(page.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', _meta: { 'kun/csp': { wasmUnsafeEval: true } } })
    const asset = await client.readResource({ uri: 'ui://kun-canvas/assets/main.js' })
    expect(asset.contents[0]).toMatchObject({ mimeType: 'text/javascript' })
    expect(Buffer.from(String((asset.contents[0] as { blob?: string }).blob), 'base64').toString()).toBe('console.log(1)')
    const font = await client.readResource({ uri: 'ui://kun-canvas/fonts/Excalifont/a.woff2' })
    expect(font.contents[0]).toMatchObject({ mimeType: 'font/woff2' })
    await expect(client.readResource({ uri: 'ui://kun-canvas/../secret.txt' })).rejects.toThrow()
    expect(await readCanvasAsset(join(root, 'app'), 'ui://kun-canvas/%2e%2e/secret.txt')).toBeNull()
  })

  it('creates, edits, reads and commits boards through tools', async () => {
    const created = await client.callTool({
      name: 'canvas_create',
      arguments: { title: 'Arch', elements: [{ id: 'api', type: 'rectangle', x: 0, y: 0, label: { text: 'API' } }] }
    })
    const { boardId, revision } = created.structuredContent as { boardId: string; revision: number }
    expect(revision).toBe(1)
    const applied = await client.callTool({
      name: 'canvas_apply',
      arguments: { boardId, expectedRevision: 1, operations: [{ op: 'add', element: { id: 'db', type: 'ellipse', x: 200, y: 0 } }] }
    })
    expect(applied.structuredContent).toMatchObject({ revision: 2, elementCount: 2 })
    const conflict = await client.callTool({
      name: 'canvas_apply',
      arguments: { boardId, expectedRevision: 1, operations: [{ op: 'delete', id: 'db' }] }
    })
    expect(conflict.isError).toBe(true)
    expect(conflict.structuredContent).toMatchObject({ code: 'conflict', revision: 2 })
    const read = await client.callTool({ name: 'canvas_read', arguments: { boardId } })
    expect((read.structuredContent as { elements: Array<{ id: string; text?: string }> }).elements)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'api', text: 'API' })]))
    const loaded = await client.callTool({ name: 'canvas_get', arguments: { boardId } })
    expect((loaded.structuredContent as { board: { pending: boolean } }).board.pending).toBe(true)
    const committed = await client.callTool({
      name: 'canvas_commit',
      arguments: { boardId, expectedRevision: 2, elements: [{ id: 'api', type: 'rectangle', x: 1, y: 1 }] }
    })
    expect(committed.structuredContent).toMatchObject({ revision: 3, elementCount: 1 })
  })

  it('exports native scenes only to absolute .excalidraw paths without silent overwrite', async () => {
    const created = await client.callTool({ name: 'canvas_create', arguments: { title: 'Out' } })
    const { boardId } = created.structuredContent as { boardId: string }
    const target = join(root, 'out.excalidraw')
    expect((await client.callTool({ name: 'canvas_export', arguments: { boardId, path: target } })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'canvas_export', arguments: { boardId, path: target } })).isError).toBe(true)
    expect((await client.callTool({ name: 'canvas_export', arguments: { boardId, path: target, overwrite: true } })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'canvas_export', arguments: { boardId, path: 'relative.excalidraw' } })).isError).toBe(true)
  })

  it('requires explicit launch flags', () => {
    expect(parseCanvasLaunchOptions(['node', 'entry.js'])).toBeNull()
    expect(parseCanvasLaunchOptions(['--kun-canvas-mcp-server', '--data-dir', '/d', '--app-dir', '/a']))
      .toEqual({ dataDir: '/d', appDir: '/a' })
  })
})
