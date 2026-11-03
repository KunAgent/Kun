import { describe, expect, it, vi } from 'vitest'
import type { AcpConnection } from './acp-connection.js'
import type { AcpConfigOption, AcpSessionModes } from './acp-schema.js'
import { acpSessionModeSelector } from './acp-session-modes.js'
import { applyAcpSessionAgent } from './acp-session-agent.js'
import { acpPermissionModeUnoffered, applyAcpSessionPermission } from './acp-session-permissions.js'

function fixture(result: unknown = {}) {
  const request = vi.fn(async () => result)
  return { request, conn: { rpc: { request } } as unknown as AcpConnection }
}
// OpenCode 1.18 reports its primary agents only as the `mode` config option;
// a plugin can replace build/plan with its own agents.
const pluginModes = (currentValue = 'Sisyphus'): AcpConfigOption => ({
  id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue,
  options: [
    { value: 'Sisyphus', name: 'Sisyphus', description: 'orchestrator' },
    { value: 'Prometheus', name: 'Prometheus' }
  ]
})
const builtinModes = (): AcpConfigOption => ({
  id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'build',
  options: [{ value: 'build', name: 'build' }, { value: 'plan', name: 'plan' }]
})
const legacyModes = (): AcpSessionModes => ({ currentModeId: 'build',
  availableModes: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] })

describe('acpSessionModeSelector', () => {
  it('reads the mode config option when the agent reports no legacy modes', () => {
    expect(acpSessionModeSelector({ configOptions: [pluginModes()] })).toEqual({
      source: 'config-option', configId: 'mode', currentModeId: 'Sisyphus',
      availableModes: [{ id: 'Sisyphus', name: 'Sisyphus', description: 'orchestrator' }, { id: 'Prometheus', name: 'Prometheus' }]
    })
  })
  it('keeps legacy modes first and ignores non-mode options', () => {
    expect(acpSessionModeSelector({ modes: legacyModes(), configOptions: [pluginModes()] })?.source).toBe('modes')
    expect(acpSessionModeSelector({ configOptions: [{ ...pluginModes(), category: 'model' }] })).toBeUndefined()
  })
})

describe('applyAcpSessionAgent', () => {
  it('selects a config-option Agent and validates the echo', async () => {
    const f = fixture({ configOptions: [pluginModes('Prometheus')] })
    const session = { sessionId: 's', configOptions: [pluginModes()] }
    await applyAcpSessionAgent(f.conn, session, 'Prometheus')
    expect(f.request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 's', configId: 'mode', value: 'Prometheus' })
    expect(session.configOptions[0]).toMatchObject({ currentValue: 'Prometheus' })
  })
  it('rejects an Agent the session does not offer or a mismatched echo', async () => {
    const f = fixture({ configOptions: [pluginModes('Sisyphus')] })
    await expect(applyAcpSessionAgent(f.conn, { sessionId: 's', configOptions: [pluginModes()] }, 'build'))
      .rejects.toMatchObject({ code: 'policy_denied' })
    expect(f.request).not.toHaveBeenCalled()
    await expect(applyAcpSessionAgent(f.conn, { sessionId: 's', configOptions: [pluginModes()] }, 'Prometheus'))
      .rejects.toMatchObject({ code: 'policy_denied' })
  })
  it('still uses session/set_mode for legacy modes', async () => {
    const f = fixture()
    const session = { sessionId: 's', modes: legacyModes() }
    await applyAcpSessionAgent(f.conn, session, 'plan')
    expect(f.request).toHaveBeenCalledWith('session/set_mode', { sessionId: 's', modeId: 'plan' })
    expect(session.modes.currentModeId).toBe('plan')
  })
})

describe('acpPermissionModeUnoffered', () => {
  it('flags a selector that offers only replacement Agents', () => {
    expect(acpPermissionModeUnoffered({ sessionId: 's', configOptions: [pluginModes()] }, 'plan')).toBe(true)
    expect(acpPermissionModeUnoffered({ sessionId: 's', modes: { currentModeId: 'x', availableModes: [{ id: 'x' }] } }, 'plan')).toBe(true)
  })
  it('does not flag offered modes or a missing selector', () => {
    expect(acpPermissionModeUnoffered({ sessionId: 's', configOptions: [builtinModes()] }, 'plan')).toBe(false)
    expect(acpPermissionModeUnoffered({ sessionId: 's', modes: legacyModes() }, 'build')).toBe(false)
    expect(acpPermissionModeUnoffered({ sessionId: 's' }, 'plan')).toBe(false)
  })
  it('keeps Auto turns failing closed and names the offered Agents', async () => {
    const f = fixture()
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 's', configOptions: [pluginModes()] }, 'plan'))
      .rejects.toThrow(/it offers 'Sisyphus', 'Prometheus'/)
    expect(f.request).not.toHaveBeenCalled()
  })
})
