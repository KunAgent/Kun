import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { buildWebToolProviders } from '../src/adapters/tool/web-tool-provider.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'
import { DeterministicWebProvider } from '../src/ports/web-provider.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function planContext(): ToolHostContext {
  return {
    threadId: 'thr_plan',
    turnId: 'turn_plan',
    workspace: '/tmp/project',
    threadMode: 'plan',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('Plan-mode web tools', () => {
  it('advertises fetch and search as read-only capabilities', () => {
    const config = KunCapabilitiesConfig.parse({
      web: {
        enabled: true,
        fetchEnabled: true,
        searchEnabled: true,
        provider: 'test-web'
      }
    })
    const provider = new DeterministicWebProvider({
      id: 'test-web',
      pages: {},
      searchResults: {}
    })
    const registry = new CapabilityRegistry(
      buildWebToolProviders(config.web, { provider }).providers
    )

    expect(registry.listTools(planContext())).toEqual([
      expect.objectContaining({ name: 'web_fetch', sideEffect: 'read-only' }),
      expect.objectContaining({ name: 'web_search', sideEffect: 'read-only' })
    ])
  })
})
