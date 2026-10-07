import { describe, expect, it } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { HarnessDetector } from '../../harness/harness-detector.js'
import { ExtensionAgentProviderSource, type ExtensionAgentProvider } from '../../harness/extension-agent-providers.js'

const TOKEN = 'test-token'

describe('GET /v1/harnesses with extension Agents', () => {
  it('refreshes extension-declared Agents before listing', async () => {
    const source = new ExtensionAgentProviderSource()
    let agents: ExtensionAgentProvider[] = []
    source.setLoader(async () => agents)
    const catalog = new HarnessCatalog({ extensionAgents: () => source.list() })
    const detector = new HarnessDetector({
      definitions: () => catalog.list(), overrides: () => ({}),
      resolveExecutable: async (command) => `/fake/bin/${command}`,
      spawnCaptured: async () => ({ stdout: 'fork 1.0.0', stderr: '', timedOut: false, exitCode: 0 }),
      probeLogin: async () => 'unknown', nowMs: () => 1_000, nowIso: () => '2026-01-01T00:00:00.000Z'
    })
    const router = buildRouter({ runtimeToken: TOKEN, insecure: false, nowIso: () => '2026-01-01T00:00:00.000Z',
      harnesses: { catalog, detector, extensionAgents: source } } as unknown as ServerRuntime)
    const list = async (): Promise<Array<{ definition: { id: string; extension?: { id: string } } }>> => {
      const request = new Request('http://127.0.0.1/v1/harnesses?include_disabled=true', { headers: { authorization: `Bearer ${TOKEN}` } })
      const match = router.match('GET', new URL(request.url).pathname)!
      const result = await match.handler(request, { params: match.params })
      return JSON.parse(result instanceof Response ? await result.text() : result.body).harnesses
    }
    expect((await list()).some((row) => row.definition.extension)).toBe(false)
    agents = [{ harnessId: 'ext-acme-fork-agent-fork', extensionId: 'acme.fork-agent', extensionName: 'Fork Pack',
      override: { extends: 'acp', label: 'Fork', command: 'fork-cli' } }]
    const row = (await list()).find((entry) => entry.definition.id === 'ext-acme-fork-agent-fork')
    expect(row?.definition.extension).toEqual({ id: 'acme.fork-agent', name: 'Fork Pack' })
  })
})
