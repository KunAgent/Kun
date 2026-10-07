import { describe, expect, it } from 'vitest'
import { isNativeNetworkOnlyApply, OfficeCliRunnerReuse, reusableMcpProviders } from './runtime-config-apply-reuse.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

const mcpOptions = (servers: Record<string, unknown>) => ({
  dataDir: '/data',
  capabilities: { mcp: { enabled: true, servers } } as unknown as KunServeRuntimeOptions['capabilities']
})

describe('runtime config apply reuse', () => {
  it('recognizes the desktop network refresh body and nothing broader', () => {
    expect(isNativeNetworkOnlyApply({ nativeAgentNetwork: { mode: 'system' } } as never)).toBe(true)
    expect(isNativeNetworkOnlyApply({ nativeAgentNetwork: { mode: 'system' }, roles: {} } as never)).toBe(false)
    expect(isNativeNetworkOnlyApply({ nativeAgentNetwork: { mode: 'system' }, roles: undefined } as never)).toBe(true)
    expect(isNativeNetworkOnlyApply({} as never)).toBe(false)
  })

  it('reuses live MCP connections only for an unchanged MCP section with healthy servers', () => {
    const current = { diagnostics: [{ status: 'connected' }, { status: 'disabled' }] }
    const servers = { a: { transport: 'stdio', command: 'x' } }
    expect(reusableMcpProviders(current, mcpOptions(servers), mcpOptions({ ...servers }))).toBe(current)
    expect(reusableMcpProviders(current, mcpOptions(servers), mcpOptions({ a: { transport: 'stdio', command: 'y' } }))).toBeUndefined()
    expect(reusableMcpProviders({ diagnostics: [{ status: 'error' }] }, mcpOptions(servers), mcpOptions(servers))).toBeUndefined()
    expect(reusableMcpProviders(current, mcpOptions(servers), { ...mcpOptions(servers), dataDir: '/other' })).toBeUndefined()
  })

  it('keeps one officecli runner per binary and profile', () => {
    const reuse = new OfficeCliRunnerReuse()
    const seeded = { runner: undefined, providers: [] }
    reuse.seed(undefined, '/profile', seeded)
    expect(reuse.resolve(undefined, '/profile')).toBe(seeded)
    const other = reuse.resolve(undefined, '/profile-2')
    expect(other).not.toBe(seeded)
    expect(other.providers).toEqual([])
    expect(reuse.resolve(undefined, '/profile-2')).toBe(other)
  })
})
