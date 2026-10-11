import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchHarnessService } from '../workbench-bridge/harnesses.js'
import {
  CODING_AGENT_CATALOG_DISCOVERING_FRESH_MS,
  CODING_AGENT_CATALOG_FAILURE_RETRY_MS,
  CODING_AGENT_CATALOG_FRESH_MS,
  codingAgentCatalog
} from './agent-coding-agents.js'

type Listed = Awaited<ReturnType<WorkbenchHarnessService['list']>>
const codex = (detecting = false) => ({ harnessId: 'codex', displayName: 'Codex', available: !detecting,
  models: detecting ? [] : [{ harnessId: 'codex', model: 'gpt', credentialMode: 'native-login' as const }],
  ...(detecting ? { detecting: true as const, reason: 'Still checking this Agent' } : {}),
  executionModes: ['direct'], orchestration: ['direct'] })

function fakeService(list: () => Promise<unknown>) {
  let key = 'settings-1'
  const service = { list: vi.fn(list), discoveryKey: () => key }
  return { service, harnesses: service as unknown as WorkbenchHarnessService, setKey: (next: string) => { key = next } }
}

afterEach(() => { vi.useRealTimers() })

describe('coding Agent catalog cache', () => {
  it('serves the cached list for minutes and refreshes in the background once stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = fakeService(async () => ({ agents: [codex()] }) as unknown as Listed)
    expect((await codingAgentCatalog(f.harnesses)).agents[0]).toMatchObject({ harnessId: 'codex', available: true })
    vi.setSystemTime(Date.now() + CODING_AGENT_CATALOG_FRESH_MS - 1_000)
    await codingAgentCatalog(f.harnesses)
    expect(f.service.list).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2_000)
    const stale = await codingAgentCatalog(f.harnesses)
    expect(stale.agents).toHaveLength(1)
    expect(f.service.list).toHaveBeenCalledTimes(2)
  })

  it('asks again soon while an engine is still detecting and reports discovering', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let detecting = true
    const f = fakeService(async () => ({ agents: [codex(detecting)] }) as unknown as Listed)
    const first = await codingAgentCatalog(f.harnesses)
    expect(first).toMatchObject({ discovering: true, agents: [{ detecting: true, available: false }] })
    detecting = false
    vi.setSystemTime(Date.now() + CODING_AGENT_CATALOG_DISCOVERING_FRESH_MS + 1)
    await codingAgentCatalog(f.harnesses)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const settled = await codingAgentCatalog(f.harnesses)
    expect(settled.discovering).toBeUndefined()
    expect(settled.agents[0]).toMatchObject({ available: true })
  })

  it('drops the cached list when settings change which engines are listed', async () => {
    const f = fakeService(async () => ({ agents: [codex()] }) as unknown as Listed)
    await codingAgentCatalog(f.harnesses)
    f.setKey('settings-2')
    await codingAgentCatalog(f.harnesses)
    expect(f.service.list).toHaveBeenCalledTimes(2)
  })

  it('does not rerun a failed discovery for every caller', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = fakeService(async () => { throw new Error('discovery timed out') })
    await expect(codingAgentCatalog(f.harnesses)).rejects.toThrow('discovery timed out')
    await expect(codingAgentCatalog(f.harnesses)).rejects.toThrow('discovery timed out')
    expect(f.service.list).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + CODING_AGENT_CATALOG_FAILURE_RETRY_MS + 1)
    await expect(codingAgentCatalog(f.harnesses)).rejects.toThrow('discovery timed out')
    expect(f.service.list).toHaveBeenCalledTimes(2)
  })
})
