import { describe, expect, it } from 'vitest'
import type { ListedTool } from './turn-tool-catalog.js'
import { TurnToolCatalogFreezer } from './turn-tool-catalog.js'

describe('TurnToolCatalogFreezer', () => {
  it('deep-freezes schemas within a turn and reports drift once per live version', () => {
    const freezer = new TurnToolCatalogFreezer()
    const tools = [tool('read', { path: { type: 'string' } })]
    const first = freezer.resolve('thread-1', 'turn-1', tools)

    const liveProperties = tools[0].inputSchema.properties as Record<string, unknown>
    liveProperties.extra = { type: 'boolean' }
    const changed = freezer.resolve('thread-1', 'turn-1', tools)
    const repeated = freezer.resolve('thread-1', 'turn-1', tools)

    expect(changed.pendingDrift.kind).toBe('breaking')
    expect(repeated.pendingDrift.kind).toBe('none')
    expect(changed.tools[0].inputSchema).toEqual(first.tools[0].inputSchema)
    expect(JSON.stringify(changed.tools[0].inputSchema)).not.toContain('extra')
  })

  it('adopts the current catalog at the start of a new turn', () => {
    const freezer = new TurnToolCatalogFreezer()
    const initial = [tool('read')]
    freezer.resolve('thread-1', 'turn-1', initial)

    const next = freezer.resolve('thread-1', 'turn-2', [...initial, tool('search')])

    expect(next.pendingDrift.kind).toBe('none')
    expect(next.tools.map((entry) => entry.name)).toEqual(['read', 'search'])
  })

  it('classifies a pure addition without changing the frozen list', () => {
    const freezer = new TurnToolCatalogFreezer()
    const initial = [tool('read')]
    freezer.resolve('thread-1', 'turn-1', initial)

    const changed = freezer.resolve('thread-1', 'turn-1', [...initial, tool('search')])

    expect(changed.pendingDrift.kind).toBe('additive')
    expect(changed.tools.map((entry) => entry.name)).toEqual(['read'])
    expect(changed.pendingCatalog?.toolNames).toEqual(['read', 'search'])
  })
})

function tool(name: string, properties: Record<string, unknown> = {}): ListedTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties }
  }
}
