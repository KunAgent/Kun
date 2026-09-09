import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LabConfigSchema } from '../src/config/kun-config-application.js'
import { createKunServeRuntime } from '../src/server/runtime-factory.js'
import { getNodeGraph, getNodeGraphFolder } from '../src/server/routes/node-graph.js'

describe('Node Graph Laboratory runtime gate', () => {
  it('defaults off and validates explicit opt-in', () => {
    expect(LabConfigSchema.parse({}).nodeGraph.enabled).toBe(false)
    expect(LabConfigSchema.parse({ nodeGraph: {} }).nodeGraph.enabled).toBe(false)
    expect(LabConfigSchema.parse({ nodeGraph: { enabled: true } }).nodeGraph.enabled).toBe(true)
    expect(() => LabConfigSchema.parse({ nodeGraph: { enabled: 'true' } })).toThrow()
  })

  it('gates both projections before and after hot application', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-node-graph-lab-'))
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'test-token',
      apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'test-model',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false, storage: { backend: 'file' }
    })
    const request = new Request('http://127.0.0.1/v1/node-graph')
    const folder = new Request(`http://127.0.0.1/v1/node-graph/folder?root=${encodeURIComponent(dataDir)}`)
    try {
      expect(runtime.nodeGraphService).toBeUndefined()
      expect((await getNodeGraph(runtime.nodeGraphService, request)).status).toBe(503)
      expect((await getNodeGraphFolder(runtime.nodeGraphService, folder)).status).toBe(503)
      expect(await runtime.applyConfig({ lab: LabConfigSchema.parse({ nodeGraph: { enabled: true } }) }))
        .toEqual({ ok: true })
      expect(runtime.nodeGraphService).toBeDefined()
      expect((await getNodeGraph(runtime.nodeGraphService, request)).status).toBe(200)
      expect((await getNodeGraphFolder(runtime.nodeGraphService, folder)).status).toBe(200)
      expect(await runtime.applyConfig({ lab: LabConfigSchema.parse({ nodeGraph: { enabled: false } }) }))
        .toEqual({ ok: true })
      expect((await getNodeGraph(runtime.nodeGraphService, request)).status).toBe(503)
      expect((await getNodeGraphFolder(runtime.nodeGraphService, folder)).status).toBe(503)
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
