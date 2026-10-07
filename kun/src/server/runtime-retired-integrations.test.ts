import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'
import { buildRouter } from './routes/index.js'
import { RuntimeInfoResponse } from '../contracts/runtime-info.js'
import type { ToolHostContext } from '../ports/tool-host.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const task of cleanup.splice(0).reverse()) await task()
})

describe('Retired built-in integrations', () => {
  it('does not expose Google Workspace tools or runtime metadata, including after hot configuration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-retired-integrations-'))
    cleanup.push(() => rm(dataDir, { recursive: true, force: true }))
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'retired-integrations-test',
      apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'fake-model',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false
    })
    cleanup.push(async () => { await runtime.shutdown?.() })
    const context = {
      threadId: 'test-thread', turnId: 'test-turn', workspace: dataDir,
      approvalPolicy: 'auto', sandboxMode: 'read-only',
      abortSignal: new AbortController().signal, awaitApproval: async () => 'deny'
    } as ToolHostContext
    const assertRetired = async () => {
      expect(runtime).not.toHaveProperty('googleWorkspace')
      expect(RuntimeInfoResponse.parse(runtime.info())).not.toHaveProperty('integrations')
      const names = (await runtime.toolHost!.listTools(context)).map((tool) => tool.name)
      expect(names.length).toBeGreaterThan(0)
      expect(names.filter((name) => name.startsWith('google_workspace_'))).toEqual([])
      const router = buildRouter(runtime)
      for (const operation of ['status', 'authorization-url', 'login', 'setup', 'test', 'logout', 'cancel']) {
        const method = operation === 'status' || operation === 'authorization-url' ? 'GET' : 'POST'
        expect(router.match(method, `/v1/integrations/google-workspace/${operation}`)).toBeUndefined()
      }
    }
    await assertRetired()
    expect((await runtime.applyConfig({ serve: { model: 'updated-model' } })).ok).toBe(true)
    await assertRetired()
  }, 30_000)
})
