import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostBrokerOptions } from './extension-host-broker.js'
import { requiredExtensionBrokerPermission } from './extension-host-broker.js'
import { dispatchExtensionRead } from './extension-host-broker-read-operations.js'
import { createExtensionAgentHarness, extensionAgentPrincipal } from './extension-agent-service.test-support.js'

function createHarness(permissions: string[]) {
  const h = createExtensionAgentHarness()
  return {
    ...h,
    principal: { ...extensionAgentPrincipal(), permissions },
    options: { agent: h.service } as ExtensionHostBrokerOptions
  }
}

describe('extension read-only broker dispatch', () => {
  it.each(['rooms.list', 'rooms.listMessages', 'rooms.listTasks', 'rooms.listEvents'])(
    'checks permission before revealing unavailable Rooms composition for %s', async (method) => {
      const denied = createHarness([])
      await expect(dispatchExtensionRead(denied.options, denied.principal, method, {}))
        .rejects.toMatchObject({ code: 'permission_denied' })

      const allowed = createHarness(['rooms.read'])
      await expect(dispatchExtensionRead(allowed.options, allowed.principal, method, {}))
        .rejects.toMatchObject({ code: 'conflict', message: 'Room data is temporarily unavailable' })
      expect(requiredExtensionBrokerPermission(method, {})).toBe('rooms.read')
    }
  )

  it('accepts capacity scope alone while keeping other agent operations separately gated', async () => {
    const h = createHarness(['agent.capacity.read'])
    expect(await dispatchExtensionRead(h.options, h.principal, 'agent.capacity', {})).toEqual({
      activeTurns: 0, queuedTurns: 0, maxConcurrentTurns: 256, busy: false
    })
    expect(requiredExtensionBrokerPermission('agent.capacity', {})).toBe('agent.capacity.read')
    expect(requiredExtensionBrokerPermission('agent.createRun', {})).toBe('agent.run')
    expect(requiredExtensionBrokerPermission('threads.listOwn', {})).toBe('agent.threads.readOwn')
  })

  it('rejects extra capacity input fields before calling the service', async () => {
    const h = createHarness(['agent.capacity.read'])
    const capacity = vi.spyOn(h.service, 'capacity')
    await expect(dispatchExtensionRead(h.options, h.principal, 'agent.capacity', {
      ownerExtensionId: 'com.example.foreign'
    })).rejects.toMatchObject({ name: 'ZodError' })
    expect(capacity).not.toHaveBeenCalled()
  })

  it.each([
    { activeTurns: -1, queuedTurns: 0, maxConcurrentTurns: 256, busy: false },
    { activeTurns: 0, queuedTurns: 0, maxConcurrentTurns: 256, busy: false, lease: 'private-lease' }
  ])('rejects malformed or private capacity output at the broker boundary', async (snapshot) => {
    const h = createHarness(['agent.capacity.read'])
    vi.spyOn(h.service, 'capacity').mockResolvedValue(snapshot)
    await expect(dispatchExtensionRead(h.options, h.principal, 'agent.capacity', {}))
      .rejects.toMatchObject({ name: 'ZodError' })
  })
})
