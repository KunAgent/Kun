import { describe, expect, it, vi } from 'vitest'
import { HarnessSettingValuesSchema } from '../../contracts/harness-session-settings.js'
import { StartTurnRequest } from '../../contracts/turns.js'
import { acpSessionCatalog } from '../../harness/acp-model-catalog.js'
import type { AcpConnection } from './acp-connection.js'
import type { AcpConfigOption } from './acp-schema.js'
import { acpSessionSettings, applyAcpSessionSettings } from './acp-session-settings.js'

const options = [
  { id: 'model', category: 'model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
  { id: 'mode', category: 'mode', type: 'select', currentValue: 'build', options: [{ value: 'build' }] },
  { id: 'thinking', category: 'thought_level', type: 'select', currentValue: 'on', options: [{ value: 'on' }] },
  { id: 'verbosity', name: 'Verbosity', category: '_custom', type: 'select', currentValue: 'normal',
    options: [{ group: 'g', name: 'Group', options: [{ value: 'terse', name: 'Terse' }, { value: 'normal' }] }] },
  { id: 'web', name: 'Web search', type: 'boolean', currentValue: false },
  { id: 'approval', name: 'Approval preset', type: 'select', currentValue: 'ask', options: [{ value: 'ask' }] }
] as unknown as AcpConfigOption[]

describe('ACP session settings', () => {
  it('publishes only the options Kun does not map itself', () => {
    expect(acpSessionSettings(options, 'approval')).toEqual([
      { kind: 'select', id: 'verbosity', label: 'Verbosity', value: 'normal',
        options: [{ value: 'terse', label: 'Terse' }, { value: 'normal', label: 'normal' }] },
      { kind: 'toggle', id: 'web', label: 'Web search', value: false }
    ])
    expect(acpSessionSettings(undefined)).toEqual([])
  })

  it('applies offered values and keeps the Agent default for anything else', async () => {
    const request = vi.fn(async (_method: string, _params: unknown) => ({}))
    const conn = { rpc: { request } } as unknown as AcpConnection
    await applyAcpSessionSettings(conn, { sessionId: 's1', configOptions: options }, {
      verbosity: 'terse', web: true, approval: 'ask', model: 'a', unknown: 'x'
    }, 'approval')
    expect(request.mock.calls.map(([, params]) => params)).toEqual([
      { sessionId: 's1', configId: 'verbosity', value: 'terse' },
      { sessionId: 's1', configId: 'web', value: true }
    ])
    request.mockClear()
    await applyAcpSessionSettings(conn, { sessionId: 's1', configOptions: options }, { verbosity: 'loud', web: 'yes' })
    await applyAcpSessionSettings(conn, { sessionId: 's1', configOptions: options }, { verbosity: 'normal' })
    expect(request).not.toHaveBeenCalled()
  })

  it('carries settings in the session catalog and the turn request', () => {
    const catalog = acpSessionCatalog({ id: 'fixture', nativeAgents: undefined, acpPermission: undefined }, { configOptions: options })
    expect(catalog.settings?.map((setting) => setting.id)).toEqual(['verbosity', 'web', 'approval'])
    expect(StartTurnRequest.parse({ prompt: 'x', harnessSettings: { web: true } }).harnessSettings).toEqual({ web: true })
    expect(HarnessSettingValuesSchema.safeParse(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, true]))).success)
      .toBe(false)
  })
})
