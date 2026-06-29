import { describe, expect, it } from 'vitest'
import { loadKunDiagnostics } from './load-kun-diagnostics'

describe('loadKunDiagnostics', () => {
  it('loads runtime info, tool diagnostics, and memory records together', async () => {
    const runtimeInfo = { pid: 42, capabilities: { model: { id: 'deepseek-v4-pro' } } } as any
    const toolDiagnostics = { providers: [{ id: 'builtin' }] } as any
    const memoryRecords = [{ id: 'mem_1', content: 'remember this' }] as any
    const provider = {
      getRuntimeInfo: async () => runtimeInfo,
      getToolDiagnostics: async () => toolDiagnostics,
      listMemories: async (options?: { all?: boolean; includeDeleted?: boolean }) => {
        expect(options).toEqual({ all: true, includeDeleted: false })
        return memoryRecords
      }
    }

    const loaded = await loadKunDiagnostics(provider)

    expect(loaded.runtimeInfo).toBe(runtimeInfo)
    expect(loaded.toolDiagnostics).toBe(toolDiagnostics)
    expect(loaded.memoryRecords).toBe(memoryRecords)
    expect(loaded.errors).toEqual([])
  })

  it('loads all memories by default for global settings diagnostics', async () => {
    const memoryRecords = [{ id: 'mem_1', content: 'remember this' }] as any
    const provider = {
      getRuntimeInfo: async () => null as any,
      getToolDiagnostics: async () => null as any,
      listMemories: async (options?: { all?: boolean }) => {
        expect(options).toEqual({ all: true, includeDeleted: false })
        return memoryRecords
      }
    }

    const loaded = await loadKunDiagnostics(provider)

    expect(loaded.memoryRecords).toBe(memoryRecords)
    expect(loaded.errors).toEqual([])
  })

  it('can scope memory loading to the current workspace when explicitly requested', async () => {
    const memoryRecords = [{ id: 'mem_ws', content: 'workspace only' }] as any
    const provider = {
      getRuntimeInfo: async () => null as any,
      getToolDiagnostics: async () => null as any,
      listMemories: async (options?: { all?: boolean }) => {
        expect(options).toEqual({ includeDeleted: false })
        return memoryRecords
      }
    }

    const loaded = await loadKunDiagnostics(provider, { listAllMemories: false })

    expect(loaded.memoryRecords).toBe(memoryRecords)
    expect(loaded.errors).toEqual([])
  })

  it('keeps successful diagnostics when memory loading fails', async () => {
    const runtimeInfo = { pid: 42 } as any
    const toolDiagnostics = { providers: [{ id: 'builtin' }], mcpServers: [] } as any
    const provider = {
      getRuntimeInfo: async () => runtimeInfo,
      getToolDiagnostics: async () => toolDiagnostics,
      listMemories: async () => {
        throw new Error('memory store is unavailable')
      }
    }

    const loaded = await loadKunDiagnostics(provider)

    expect(loaded.runtimeInfo).toBe(runtimeInfo)
    expect(loaded.toolDiagnostics).toBe(toolDiagnostics)
    expect(loaded.memoryRecords).toBeUndefined()
    expect(loaded.errors).toEqual(['Memory: memory store is unavailable'])
  })
})
