import { describe, expect, it } from 'vitest'
import type { MarketMcpEntry } from '../../../shared/market/market-types'
import { parseNpmSpec, planMarketMcpInstall } from './market-mcp-plan'

function stdio(args: string[], overrides: Partial<Extract<MarketMcpEntry, { transport: 'stdio' }>> = {}): MarketMcpEntry {
  return {
    sourceId: 'demo',
    id: 'demo-mcp',
    name: { en: 'Demo' },
    description: {},
    transport: 'stdio',
    command: 'npx',
    args,
    requiredEnvKeys: ['DEMO_KEY'],
    optionalEnvKeys: [],
    ...overrides
  }
}

function registry(versions: Record<string, string>, failHosts: string[] = []) {
  const calls: string[] = []
  const fetcher = async (url: string): Promise<Response> => {
    calls.push(url)
    if (failHosts.some((host) => url.startsWith(host))) return new Response('', { status: 503 })
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, '').replace(/\/latest$/, ''))
    const version = versions[name]
    return version
      ? new Response(JSON.stringify({ name, version }), { status: 200 })
      : new Response('', { status: 404 })
  }
  return { fetcher, calls }
}

describe('parseNpmSpec', () => {
  it('splits plain, tagged, scoped and scoped+versioned specs', () => {
    expect(parseNpmSpec('tavily-mcp')).toEqual({ name: 'tavily-mcp', version: '' })
    expect(parseNpmSpec('tavily-mcp@latest')).toEqual({ name: 'tavily-mcp', version: 'latest' })
    expect(parseNpmSpec('@scope/pkg')).toEqual({ name: '@scope/pkg', version: '' })
    expect(parseNpmSpec('@scope/pkg@1.2.3')).toEqual({ name: '@scope/pkg', version: '1.2.3' })
  })
})

describe('planMarketMcpInstall', () => {
  it('pins @latest to the registry version', async () => {
    const { fetcher, calls } = registry({ 'tavily-mcp': '0.2.9' })
    const plan = await planMarketMcpInstall(stdio(['-y', 'tavily-mcp@latest']), fetcher)
    expect(plan).toMatchObject({
      transport: 'stdio',
      args: ['-y', 'tavily-mcp@0.2.9'],
      pinned: { packageName: 'tavily-mcp', version: '0.2.9' },
      requiredEnvKeys: ['DEMO_KEY']
    })
    expect(calls).toEqual(['https://registry.npmjs.org/tavily-mcp/latest'])
  })

  it('pins unversioned scoped packages and encodes the scope separator', async () => {
    const { fetcher, calls } = registry({ '@modelcontextprotocol/server-github': '2025.4.8' })
    const plan = await planMarketMcpInstall(stdio(['-y', '@modelcontextprotocol/server-github']), fetcher)
    expect(plan).toMatchObject({ args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'] })
    expect(calls[0]).toContain('@modelcontextprotocol%2Fserver-github/latest')
  })

  it('leaves an already exact pin alone without any network call', async () => {
    const { fetcher, calls } = registry({})
    const plan = await planMarketMcpInstall(stdio(['-y', '@zereight/mcp-gitlab@2.1.30']), fetcher)
    expect(plan).toMatchObject({ args: ['-y', '@zereight/mcp-gitlab@2.1.30'] })
    expect(plan).not.toHaveProperty('pinned')
    expect(calls).toEqual([])
  })

  it('falls back to the mirror when npmjs is unreachable', async () => {
    const { fetcher, calls } = registry({ pkg: '1.0.0' }, ['https://registry.npmjs.org'])
    const plan = await planMarketMcpInstall(stdio(['pkg']), fetcher)
    expect(plan).toMatchObject({ args: ['pkg@1.0.0'] })
    expect(calls.map((url) => new URL(url).host)).toEqual(['registry.npmjs.org', 'registry.npmmirror.com'])
  })

  it('fails closed instead of installing an unpinned package', async () => {
    const { fetcher } = registry({})
    await expect(planMarketMcpInstall(stdio(['-y', 'missing-pkg@latest']), fetcher))
      .rejects.toThrow('missing-pkg')
  })

  it('does not rewrite non-npx commands and passes remote servers through', async () => {
    const { fetcher, calls } = registry({})
    const uvx = await planMarketMcpInstall(stdio(['some-tool'], { command: 'uvx' }), fetcher)
    expect(uvx).toMatchObject({ command: 'uvx', args: ['some-tool'] })
    const remote = await planMarketMcpInstall({
      sourceId: 'demo',
      id: 'remote',
      name: { en: 'Remote' },
      description: {},
      transport: 'remote',
      url: 'https://example.com/mcp',
      requiredEnvKeys: [],
      optionalEnvKeys: []
    }, fetcher)
    expect(remote).toMatchObject({ transport: 'remote', url: 'https://example.com/mcp' })
    expect(calls).toEqual([])
  })
})
