import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArtifactSummary } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { GenUiStore } from '../../gen-ui/gen-ui-store.js'
import { RemoteArtifactPreviews } from './artifact-preview-service.js'
import type { ArtifactToolItem } from './artifact-sources.js'

const cleanup: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const resource = { kind: 'code' as const, id: 'thread-1' }
const scope = { accountId: 'account-1', deviceId: 'phone-1', authorizationId: 'grant-1' }
const tool = (id: string, toolName: string, output: unknown, meta?: unknown): ArtifactToolItem => ({
  id, kind: 'tool_result', toolName, output, meta, turnId: 'turn-1', createdAt: '2026-11-09T00:00:00.000Z'
})

async function fixture(items: ArtifactToolItem[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'kun-artifact-preview-'))
  cleanup.push(root)
  const workspace = join(root, 'project'), dataDir = join(root, 'runtime-data')
  await mkdir(workspace); await mkdir(dataDir)
  let epoch = 'history-1', workspacePath = workspace
  const genUi = new GenUiStore(dataDir)
  const runtime = {
    rooms: { deps: { dataDir } }, genUi: { store: genUi },
    threadService: { getMetadata: async (id: string) => id === resource.id ? { id, workspace: workspacePath, agentSurface: 'code' } : null },
    sessionStore: {
      itemHistoryVersion: async () => epoch,
      loadItemPage: async (_threadId: string, options: { before?: string; maxItems?: number; itemId?: string; contentOffset?: number }) => {
        if (options.itemId) {
          const item = items.find(item => item.id === options.itemId)
          const text = JSON.stringify(item?.output), offset = options.contentOffset ?? 0
          return { items: item ? [item] : [], hasMore: false, historyVersion: epoch,
            content: { itemId: options.itemId, field: 'output', text: text.slice(offset), offset, totalChars: text.length } }
        }
        const end = options.before ? items.findIndex(item => item.id === options.before) : items.length
        const start = Math.max(0, end - (options.maxItems ?? 1))
        return { items: items.slice(start, end), hasMore: start > 0,
          ...(start > 0 ? { nextCursor: items[start]!.id } : {}), historyVersion: epoch }
      }
    }, registerRemoteCleanup: () => undefined
  } as unknown as ServerRuntime
  return { root, workspace, genUi, items, runtime, service: new RemoteArtifactPreviews(runtime),
    setEpoch(value: string) { epoch = value }, setWorkspace(value: string) { workspacePath = value } }
}

const request = (artifact: ArtifactSummary) => ({ resource, id: artifact.id, revision: artifact.revision })
const assetRequest = (artifact: ArtifactSummary, assetId: string) => ({
  previewResource: resource, previewId: artifact.id, previewRevision: artifact.revision, previewAssetId: assetId
})

describe('remote artifact previews', () => {
  it('lists inline charts and renders them from a digest-verified data asset', async () => {
    const chart = { version: 1, type: 'bar', title: 'Count', data: [{ label: 'A', value: 2 }], x: { field: 'label' }, series: [{ field: 'value' }] }
    const f = await fixture([tool('chart-1', 'render_chart', { chart })])
    const page = await f.service.list(scope, { resource, limit: 20 })
    expect(page.artifacts).toHaveLength(1)
    expect(page.artifacts[0]).toMatchObject({ kind: 'chart', title: 'Count', available: true })
    const preview = await f.service.get(scope, request(page.artifacts[0]!))
    expect(preview.renderer).toBe('data')
    const file = await f.service.asset(scope, assetRequest(preview.artifact, preview.dataAssetId!))
    expect(JSON.parse(file.data.toString())).toEqual(chart)
    expect(JSON.stringify(preview)).not.toContain(f.workspace)
  })

  it('collects relative HTML, styles, scripts and images but never credential files', async () => {
    const f = await fixture()
    await mkdir(join(f.workspace, 'output'))
    await writeFile(join(f.workspace, 'output/index.html'), '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><img src="./photo.png"><script src="./main.js"></script><iframe src="../.env"></iframe></body></html>')
    await writeFile(join(f.workspace, 'output/style.css'), 'body{background:url(./photo.png)}')
    await writeFile(join(f.workspace, 'output/main.js'), 'document.body.dataset.ready="yes"')
    await writeFile(join(f.workspace, 'output/photo.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(join(f.workspace, '.env'), 'PRIVATE_TOKEN=secret')
    f.items.push(tool('file-1', 'write', { generatedFiles: [{ path: 'output/index.html' }] }))
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    const preview = await f.service.get(scope, request(artifact!))
    expect(preview.renderer).toBe('html')
    expect(preview.assets.map(asset => asset.path).sort()).toEqual(['output/index.html', 'output/main.js', 'output/photo.png', 'output/style.css'])
    expect(preview.assets.find(asset => asset.id === preview.entryAssetId)?.dependencies).toHaveLength(3)
    await expect(f.service.asset(scope, assetRequest(artifact!, 'unknown'))).rejects.toThrow('FILE_NOT_ALLOWED')
    await writeFile(join(f.workspace, 'output/main.js'), 'document.body.dataset.ready="changed"')
    const script = preview.assets.find(asset => asset.path.endsWith('main.js'))!
    await expect(f.service.asset(scope, assetRequest(artifact!, script.id))).rejects.toThrow(/FILE_NOT_ALLOWED|FILE_CHANGED|ARTIFACT_CHANGED/)
  })

  it('blocks symlink escapes and protected aliases while retaining an explicit missing-resource state', async () => {
    const f = await fixture()
    await writeFile(join(f.workspace, '.env'), 'PRIVATE_TOKEN=secret')
    await symlink(join(f.workspace, '.env'), join(f.workspace, 'visible.js'))
    await writeFile(join(f.root, 'outside.js'), 'private outside workspace')
    await symlink(join(f.root, 'outside.js'), join(f.workspace, 'outside.js'))
    await writeFile(join(f.workspace, 'index.html'), '<html><script src="visible.js"></script><script src="outside.js"></script><body>Safe content</body></html>')
    f.items.push(tool('html-1', 'write', { generatedFiles: [{ path: 'index.html' }] }))
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    const preview = await f.service.get(scope, request(artifact!))
    expect(preview.assets).toHaveLength(1)
    expect(preview.missingResources).toEqual(expect.arrayContaining(['visible.js', 'outside.js']))
    expect(JSON.stringify(preview)).not.toContain('PRIVATE_TOKEN')
  })

  it('pins assets to account, phone, authorization, resource history and workspace', async () => {
    const f = await fixture([tool('text-1', 'write', { generatedFiles: [{ path: 'note.txt' }] })])
    await writeFile(join(f.workspace, 'note.txt'), 'hello')
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    const preview = await f.service.get(scope, request(artifact!))
    const params = assetRequest(artifact!, preview.entryAssetId!)
    for (const changed of [{ accountId: 'other' }, { deviceId: 'other' }, { authorizationId: 'other' }])
      await expect(f.service.asset({ ...scope, ...changed }, params)).rejects.toThrow('REFRESH_ARTIFACTS')
    f.setEpoch('history-2')
    await expect(f.service.asset(scope, params)).rejects.toThrow('HISTORY_CHANGED')
    f.setEpoch('history-1'); f.setWorkspace(f.root)
    await expect(f.service.asset(scope, params)).rejects.toThrow('HISTORY_CHANGED')
  })

  it('loads report content from the actual report file rather than its metadata payload', async () => {
    const f = await fixture()
    await mkdir(join(f.workspace, '.kun-reports'))
    const report = { version: 1, reportId: '123456abcd', threadId: resource.id, revision: 2,
      createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
      title: 'Weekly', blocks: [{ type: 'stats', items: [{ label: 'Done', value: 3 }] }] }
    await writeFile(join(f.workspace, '.kun-reports/123456abcd.json'), JSON.stringify(report))
    f.items.push(tool('report-1', 'report_open', { reportRequest: { version: 1, reportId: report.reportId, title: report.title,
      relativePath: '.kun-reports/123456abcd.json', revision: 2, updatedAt: report.updatedAt } }))
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    const preview = await f.service.get(scope, request(artifact!))
    expect(preview.renderer).toBe('data')
    const file = await f.service.asset(scope, assetRequest(artifact!, preview.dataAssetId!))
    expect(JSON.parse(file.data.toString()).blocks).toEqual(report.blocks)
  })

  it('merges separately delivered design boards even when no desktop metadata file exists', async () => {
    const f = await fixture()
    const screens = ['1111aaaa', '2222bbbb'].map((artifactId, index) => ({
      artifactId, name: `Screen ${index + 1}`, relativePath: `.kun-design/1234abcd/${artifactId}/v1.html`, width: 390, height: 844
    }))
    for (const [index, screen] of screens.entries()) {
      await mkdir(join(f.workspace, `.kun-design/1234abcd/${screen.artifactId}`), { recursive: true })
      await writeFile(join(f.workspace, screen.relativePath), `<html><body>${screen.name}</body></html>`)
      f.items.push(tool(`design-${index}`, 'design_open', { designRequest: {
        version: 2, status: 'ready', documentId: '1234abcd', title: 'Screens', screens: [screen]
      } }))
    }
    const page = await f.service.list(scope, { resource })
    expect(page.artifacts).toHaveLength(1)
    const preview = await f.service.get(scope, request(page.artifacts[0]!))
    expect(preview.pages.map(page => page.title)).toEqual(['Screen 1', 'Screen 2'])
    expect(preview.artifact).toMatchObject({ pageCount: 2, available: true })
  })

  it('anchors catalogue pagination against newly appended calls and recovers an expired older-page handle', async () => {
    const chart = { version: 1, type: 'bar', title: 'Count', data: [{ name: 'A', value: 2 }], x: { field: 'name' }, series: [{ field: 'value' }] }
    const f = await fixture(Array.from({ length: 75 }, (_, index) => tool(`chart-${index}`, 'render_chart', { chart })))
    const first = await f.service.list(scope, { resource, limit: 20 })
    f.items.push(tool('new-chart', 'render_chart', { chart }))
    const artifacts = [...first.artifacts]
    let cursor = first.nextCursor
    while (cursor) {
      const page = await f.service.list(scope, { resource, cursor, limit: 20 })
      artifacts.push(...page.artifacts)
      cursor = page.nextCursor
    }
    expect(artifacts).toHaveLength(75)
    expect(artifacts.every(artifact => artifact.available)).toBe(true)
    expect(new Set(artifacts.map(artifact => artifact.id)).size).toBe(75)
    const old = artifacts.at(-1)!
    expect(old.messageId).toBe('chart-0')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 60 * 1000)
    const preview = await f.service.get(scope, request(old))
    expect(preview.artifact).toEqual(old)
    expect((await f.service.asset(scope, assetRequest(old, preview.dataAssetId!))).data.length).toBeGreaterThan(0)
  })

  it('pins MCP HTML and nested relative assets to the original server and delivers its real call context', async () => {
    const target = { serverId: 'example', toolName: 'show', resourceUri: 'ui://example/ui/index.html' }
    const call: ArtifactToolItem = { id: 'call-1', kind: 'tool_call', callId: 'mcp-1', arguments: { filter: 'recent' } }
    const output = { mcpApp: target, structuredContent: { value: 7 } }
    const f = await fixture([call, { ...tool('mcp-result', 'mcp:example/show', output), callId: 'mcp-1' }])
    let enabled = true
    const readResource = vi.fn(async (_server: string, uri: string) => ({ contents: [{
      uri, mimeType: uri.endsWith('.html') ? 'text/html;profile=mcp-app' : 'text/css',
      text: uri.endsWith('.html') ? '<html><link rel="stylesheet" href="./assets/style.css"><body>App</body></html>' : 'body{color:navy}',
      _meta: { ui: { csp: { resourceDomains: [], connectDomains: [] } } }
    }] }))
    Object.assign(f.runtime, { mcpApps: () => ({ catalog: () => enabled ? [target] : [], readResource }) })
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    expect(artifact).toMatchObject({ kind: 'mcp-app', available: true })
    const preview = await f.service.get(scope, request(artifact!))
    expect(readResource.mock.calls.some(([_server, uri]) => uri === 'ui://example/ui/assets/style.css')).toBe(true)
    const context = await f.service.asset(scope, assetRequest(artifact!, preview.dataAssetId!))
    expect(JSON.parse(context.data.toString())).toMatchObject({ input: call.arguments, result: output })
    enabled = false
    await expect(f.service.asset(scope, assetRequest(artifact!, preview.entryAssetId!))).rejects.toThrow('ARTIFACT_UNAVAILABLE')
  })

  it('enforces reference-count bounds in CSS and JavaScript as well as HTML', async () => {
    const f = await fixture()
    for (const [name, text] of [
      ['style.css', Array.from({ length: 513 }, () => '@import "a.css";').join('\n')],
      ['main.js', Array.from({ length: 513 }, () => 'import "./a.js";').join('\n')]
    ]) {
      await writeFile(join(f.workspace, name!), text!)
      await writeFile(join(f.workspace, 'index.html'), `<html><link rel="stylesheet" href="${name}"><script src="${name}"></script></html>`)
      f.items.splice(0, f.items.length, tool('bounded-file', 'write', { generatedFiles: [{ path: 'index.html' }] }))
      const [artifact] = (await f.service.list(scope, { resource })).artifacts
      expect(artifact).toMatchObject({ available: false, detail: 'ARTIFACT_UNAVAILABLE' })
    }
  })

  it('serves immutable widget HTML and writes only that widget state under its source thread', async () => {
    const f = await fixture()
    const ref = { ...await f.genUi.putWidget('<div>Widget</div>'), title: 'Explorer', mode: 'inline' as const }
    f.items.push(tool('widget-1', 'render_widget', { status: 'completed' }, { genUi: ref }))
    const [artifact] = (await f.service.list(scope, { resource })).artifacts
    expect(artifact).toMatchObject({ kind: 'widget', available: true })
    const preview = await f.service.get(scope, request(artifact!))
    expect(preview.renderer).toBe('html')
    const result = await f.service.updateWidgetState(scope, { ...request(artifact!), state: { modelContent: 'Selected summary', privateContent: { selected: 2 } } })
    expect(result.state.modelContent).toBe('Selected summary')
    expect((await f.genUi.readState(resource.id)).find(entry => entry.widgetId === ref.widgetId)?.state.privateContent).toEqual({ selected: 2 })
    const file = await f.service.asset(scope, assetRequest(artifact!, preview.entryAssetId!))
    expect(file.data.toString()).toBe('<div>Widget</div>')
  })
})
