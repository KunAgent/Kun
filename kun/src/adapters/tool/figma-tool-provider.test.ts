import { describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { FigmaError, type FigmaReadServicePort } from '../../figma/ports.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildFigmaToolProvider, FIGMA_TOOL_PROVIDER_ID } from './figma-tool-provider.js'

function context(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace',
    clientSurface: 'gui',
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  } as ToolHostContext
}

function service(overrides: Partial<FigmaReadServicePort> = {}): FigmaReadServicePort {
  return {
    identify: vi.fn(async () => ({ id: '1', handle: 'designer' })),
    readFile: vi.fn(async () => ({
      fileKey: 'abcdefghij', name: 'Doc', lastModified: null, version: null, role: null, depth: 2, pages: []
    })),
    readNodes: vi.fn(async () => ({ fileKey: 'abcdefghij', nodes: [], missingNodeIds: [] })),
    exportImages: vi.fn(async () => ({
      fileKey: 'abcdefghij', images: [], missingNodeIds: [], download: { supported: false, reason: 'gap' }
    })),
    ...overrides
  }
}

const LINK = 'https://www.figma.com/design/abcdefghij/Name?node-id=1-2'

describe('Figma REST tool provider', () => {
  it('offers no tools until a token is stored, and none are available offline', () => {
    const state = { connected: false }
    const provider = buildFigmaToolProvider(service(), state)
    expect(provider.id).toBe(FIGMA_TOOL_PROVIDER_ID)
    expect(provider.tools).toHaveLength(3)
    const registry = new CapabilityRegistry([provider])
    expect(registry.listTools(context())).toEqual([])
    state.connected = true
    expect(registry.listTools(context()).map((tool) => tool.name))
      .toEqual(['figma_read_file', 'figma_read_nodes', 'figma_export_images'])
  })

  it('hides every tool when the Agent blocks Figma under any known id', () => {
    for (const id of ['figma', 'native:figma', 'figma-desktop', 'figma-api']) {
      const registry = new CapabilityRegistry([buildFigmaToolProvider(service(), { connected: true })])
      expect(registry.listTools(context({ blockedProviderIds: [id] }))).toEqual([])
    }
  })

  it('refuses to execute a blocked provider even when called directly', async () => {
    const provider = buildFigmaToolProvider(service(), { connected: true })
    const result = await provider.tools[0].execute({ link: LINK },
      context({ blockedProviderIds: ['figma'] }))
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ code: 'provider_blocked' })
  })

  it('asks the user to connect Figma instead of failing after a disconnect', async () => {
    const provider = buildFigmaToolProvider(service(), { connected: false })
    const result = await provider.tools[0].execute({ link: LINK }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ code: 'credential_missing' })
  })

  it('maps provider errors to stable codes without echoing the token', async () => {
    const readFile = vi.fn(async () => {
      throw new FigmaError('access_denied', 'This Figma token cannot read that file.')
    })
    const provider = buildFigmaToolProvider(service({ readFile }), { connected: true })
    const result = await provider.tools[0].execute({ link: LINK }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ code: 'access_denied' })
    expect(JSON.stringify(result.output)).not.toContain('figd_')
  })

  it('reports the rate-limit window so the model can back off', async () => {
    const readNodes = vi.fn(async () => {
      throw new FigmaError('rate_limited', 'Figma is rate limiting Kun.', 2_000)
    })
    const provider = buildFigmaToolProvider(service({ readNodes }), { connected: true })
    const result = await provider.tools[1].execute({ link: LINK }, context())
    expect(result.output).toMatchObject({ code: 'rate_limited', retryAfterMs: 2_000 })
  })

  it('rejects an oversized node batch before any request', async () => {
    const exported = vi.fn()
    const provider = buildFigmaToolProvider(service({ exportImages: exported }), { connected: true })
    const result = await provider.tools[2].execute({
      link: LINK, nodeIds: Array.from({ length: 51 }, (_, index) => `1:${index}`)
    }, context())
    expect(result.isError).toBe(true)
    expect(exported).not.toHaveBeenCalled()
  })
})
