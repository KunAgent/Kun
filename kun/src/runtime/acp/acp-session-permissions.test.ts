import { describe, expect, it, vi } from 'vitest'
import type { AcpConnection } from './acp-connection.js'
import type { AcpConfigOption, AcpSessionModes } from './acp-schema.js'
import { applyAcpSessionPermission } from './acp-session-permissions.js'
import { AcpError } from './acp-schema.js'

function fixture(result: unknown = {}) {
  const request = vi.fn(async () => result)
  return { request, conn: { rpc: { request } } as unknown as AcpConnection }
}
const modeOption = (currentValue = 'bypass'): AcpConfigOption => ({
  id: 'permissions', name: 'Permissions', category: 'mode', type: 'select', currentValue,
  options: [{ value: 'ask', name: 'Ask' }, { value: 'bypass', name: 'Bypass' }]
})
const legacyModes = (): AcpSessionModes => ({ currentModeId: 'bypass',
  availableModes: [{ id: 'ask', name: 'Ask' }, { id: 'bypass', name: 'Bypass' }] })

describe('ACP permission negotiation', () => {
  it('reapplies the requested safe mode on a restored wider session', async () => {
    const f = fixture()
    const session = { sessionId: 'session', configOptions: [modeOption()] }
    await applyAcpSessionPermission(f.conn, session, 'ask')
    expect(f.request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 'session', configId: 'permissions', value: 'ask' })
    expect(session.configOptions[0]).toMatchObject({ currentValue: 'ask' })
  })
  it('selects only declared equivalent aliases and an explicit config option', async () => {
    const f = fixture()
    const option = { ...modeOption(), category: 'other' }
    await applyAcpSessionPermission(f.conn, { sessionId: 'session', configOptions: [option] }, 'default', {
      modeAliases: { default: ['ask'] }, configOptionId: 'permissions'
    })
    expect(f.request).toHaveBeenLastCalledWith('session/set_config_option', expect.objectContaining({ value: 'ask' }))
  })
  it('uses the legacy selector even when unrelated config options exist', async () => {
    const f = fixture()
    const session = { sessionId: 'session', modes: legacyModes(), configOptions: [{ ...modeOption(), category: 'model' }] }
    await applyAcpSessionPermission(f.conn, session, 'ask')
    expect(f.request).toHaveBeenCalledWith('session/set_mode', { sessionId: 'session', modeId: 'ask' })
  })
  it('rejects missing or mismatched modes without sending a protocol mutation', async () => {
    const f = fixture()
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 'session' }, 'default')).rejects.toMatchObject({ code: 'policy_denied' })
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 'session', configOptions: [modeOption()] }, 'default'))
      .rejects.toMatchObject({ code: 'policy_denied' })
    expect(f.request).not.toHaveBeenCalled()
  })
  it.each([
    { configOptions: [modeOption('bypass')] },
    { modes: { ...legacyModes(), currentModeId: 'bypass' } },
    { currentModeId: 'bypass' }
  ])('rejects an authoritative echo that retained wider permission %#', async (result) => {
    const f = fixture(result)
    const session = 'configOptions' in result ? { sessionId: 'session', configOptions: [modeOption()] }
      : { sessionId: 'session', modes: legacyModes() }
    await expect(applyAcpSessionPermission(f.conn, session, 'ask')).rejects.toMatchObject({ code: 'policy_denied' })
  })
  it('accepts only an explicit no-mode declaration, never an unsupported advertised value', async () => {
    const f = fixture()
    await applyAcpSessionPermission(f.conn, { sessionId: 'session' }, 'ask', { requireMode: false })
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 'session', modes: legacyModes() }, 'default', { requireMode: false }))
      .rejects.toMatchObject({ code: 'policy_denied' })
    expect(f.request).not.toHaveBeenCalled()
  })
  it('classifies a rejected selector as policy denial instead of rebasing a saved session', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new AcpError('agent_error', 'selector unavailable'))
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 'session', modes: legacyModes() }, 'ask'))
      .rejects.toMatchObject({ code: 'policy_denied' })
  })
  it('rejects a selector echo that dropped the requested mode entirely', async () => {
    const f = fixture({ configOptions: [] })
    await expect(applyAcpSessionPermission(f.conn, { sessionId: 'session', configOptions: [modeOption()] }, 'ask'))
      .rejects.toMatchObject({ code: 'policy_denied' })
  })
})
