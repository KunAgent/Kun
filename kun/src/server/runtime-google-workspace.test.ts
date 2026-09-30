import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'
import { RuntimeInfoResponse } from '../contracts/runtime-info.js'
import type { ToolHostContext } from '../ports/tool-host.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task() })

describe('Google Workspace real runtime composition', () => {
  it('exposes only the curated tools and retains the same service through hot configuration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gws-composition-'))
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }))
    const runtime = await createKunServeRuntime({ host: '127.0.0.1', port: 0, dataDir,
      runtimeToken: 'google-workspace-test', apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'fake-model',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false })
    cleanup.push(async () => { await runtime.shutdown?.() })
    expect(runtime.googleWorkspace).toBeDefined()
    const service = runtime.googleWorkspace
    expect(RuntimeInfoResponse.parse(runtime.info()).integrations?.googleWorkspace).toEqual({
      experimental: true, version: '0.22.5', driveReadOnly: true, authControl: 'settings'
    })
    const context = { threadId: 'test-thread', turnId: 'test-turn', workspace: dataDir, approvalPolicy: 'auto', sandboxMode: 'read-only',
      abortSignal: new AbortController().signal, awaitApproval: async () => 'deny' } as ToolHostContext
    const names = async () => (await runtime.toolHost!.listTools(context)).map(x => x.name).filter(x => x.startsWith('google_workspace_')).sort()
    expect(await names()).toEqual(['google_workspace_call', 'google_workspace_describe', 'google_workspace_search'])
    const searched = await runtime.toolHost!.execute({ callId: 'catalog-call', toolName: 'google_workspace_search', arguments: { query: 'drive' } }, context)
    expect(searched.item).toMatchObject({ isError: false, toolName: 'google_workspace_search' })
    expect(JSON.stringify(searched.item)).toContain('drive.files.export')
    const applied = await runtime.applyConfig({ serve: { model: 'updated-model' } })
    expect(applied.ok).toBe(true)
    expect(runtime.googleWorkspace).toBe(service)
    expect(await names()).toEqual(['google_workspace_call', 'google_workspace_describe', 'google_workspace_search'])
  }, 30_000)
})
