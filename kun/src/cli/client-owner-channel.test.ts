import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  monitorRuntimeClientOwnerChannel,
  RuntimeClientOwnerChannelUnavailableError,
  type RuntimeClientOwnerChannel
} from './client-owner-channel.js'

class FakeOwnerChannel extends EventEmitter implements RuntimeClientOwnerChannel {
  connected = true
  send: unknown = vi.fn()
}

describe('runtime client owner IPC channel', () => {
  it.each(['gui', 'tui'] as const)('rejects a %s owner without a live IPC channel', (ownerKind) => {
    const channel = new FakeOwnerChannel()
    channel.connected = false

    expect(() => monitorRuntimeClientOwnerChannel(ownerKind, channel)).toThrow(
      RuntimeClientOwnerChannelUnavailableError
    )
    expect(channel.listenerCount('disconnect')).toBe(0)
  })

  it('signals Runtime shutdown when the owner IPC channel disconnects', async () => {
    const channel = new FakeOwnerChannel()
    const monitor = monitorRuntimeClientOwnerChannel('gui', channel)
    const shutdown = vi.fn()
    void monitor.disconnected.then(shutdown)

    channel.emit('disconnect')
    await monitor.disconnected

    expect(shutdown).toHaveBeenCalledOnce()
    monitor.dispose()
    expect(channel.listenerCount('disconnect')).toBe(0)
  })
})
