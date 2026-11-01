import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { AcpModelProbe } from './acp-model-probe.js'

const devin = BUILTIN_HARNESSES.find((entry) => entry.id === 'devin')!
const opencode = BUILTIN_HARNESSES.find((entry) => entry.id === 'opencode')!
const catalog = { models: ['native-model'], modelInfo: [{ id: 'native-model' }],
  agents: [{ id: 'build', name: 'build' }], defaultAgentId: 'build' }

const { startAcpProcess } = vi.hoisted(() => ({ startAcpProcess: vi.fn() }))
vi.mock('../runtime/acp/acp-process.js', () => ({ startAcpProcess }))

describe('ACP session-backed model catalog', () => {
  it('does not start an Agent or create a session for a model or detail lookup', async () => {
    const probe = new AcpModelProbe()
    expect(await probe.probeCatalog(devin)).toMatchObject({ models: [], error: { code: 'unavailable' } })
    expect(await probe.probeCatalog(devin, 'native-model')).toMatchObject({ models: [] })
    expect(await probe.probe(devin)).toEqual([])
    expect(startAcpProcess).not.toHaveBeenCalled()
  })

  it('returns metadata observed in a real session and reports its observation time', async () => {
    const onCatalog = vi.fn()
    const probe = new AcpModelProbe({ nowMs: () => 1000, onCatalog })
    probe.seed(opencode, catalog)
    expect(onCatalog).toHaveBeenCalledWith(opencode, catalog)
    expect(probe.peek(opencode)).toEqual(['native-model'])
    expect(probe.peekInfo(opencode)).toEqual(catalog.modelInfo)
    expect(probe.fetchedAt(opencode)).toBe(new Date(1000).toISOString())
    expect(await probe.probeCatalog(opencode, 'native-model')).toEqual(catalog)
    expect(startAcpProcess).not.toHaveBeenCalled()
  })

  it('ignores empty observations and invalidates only the requested Agent', () => {
    const probe = new AcpModelProbe()
    probe.seed(opencode, catalog)
    probe.seed(devin, { models: [], modelInfo: [] })
    expect(probe.peek(devin)).toBeUndefined()
    probe.seed(devin, catalog)
    probe.invalidate('devin')
    expect(probe.peek(devin)).toBeUndefined()
    expect(probe.peek(opencode)).toEqual(['native-model'])
    probe.invalidate()
    expect(probe.peek(opencode)).toBeUndefined()
  })

  it('does not reuse a session catalog after the executable or launch config changes', () => {
    let command = '/agent/one'
    const probe = new AcpModelProbe({ binaryPath: () => command })
    probe.seed(opencode, catalog)
    command = '/agent/two'
    expect(probe.peek(opencode)).toBeUndefined()
    command = '/agent/one'
    expect(probe.peek({ ...opencode, launch: { ...opencode.launch!, env: { CHANGED: 'yes' } } })).toBeUndefined()
  })
})
