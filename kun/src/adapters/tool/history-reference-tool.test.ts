import { describe, expect, it, vi } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildHistoryReferenceToolProvider } from './history-reference-tool.js'

const context: ToolHostContext = {
  threadId: 'branch', turnId: 'new-turn', workspace: '/workspace', approvalPolicy: 'auto',
  abortSignal: new AbortController().signal, awaitApproval: async () => 'allow'
}

describe('source history tool', () => {
  it('gates discovery and direct execution without reading source data', async () => {
    let enabled = false
    const excerpt = { text: 'selected excerpt', status: 'available' as const, warnings: [] }
    const readForThread = vi.fn(async () => excerpt)
    const provider = buildHistoryReferenceToolProvider({ isEnabled: () => enabled, readForThread })
    const registry = new CapabilityRegistry([provider])
    expect(registry.listTools(context)).toEqual([])
    expect(await provider.tools[0]!.execute({ operation: 'recent' }, context)).toMatchObject({ isError: true })
    expect(readForThread).not.toHaveBeenCalled()
    enabled = true
    expect(registry.listTools(context).map((tool) => tool.name)).toEqual(['read_source_history'])
    expect(await provider.tools[0]!.execute({ operation: 'read', turnId: 'codex:turn' }, context))
      .toEqual({ output: excerpt })
    expect(readForThread).toHaveBeenCalledWith('branch', { operation: 'read', turnId: 'codex:turn' })
  })

  it('rejects paths, invalid operations and excessive limits before reading', async () => {
    const readForThread = vi.fn()
    const tool = buildHistoryReferenceToolProvider({ isEnabled: () => true, readForThread }).tools[0]!
    for (const args of [{ operation: 'read', path: '/private' }, { operation: 'execute' }, { operation: 'recent', limit: 1000 }]) {
      expect(await tool.execute(args, context)).toMatchObject({ isError: true })
    }
    expect(readForThread).not.toHaveBeenCalled()
  })
})
