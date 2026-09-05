import { describe, expect, it } from 'vitest'
import { ExtensionHostClient, type HostNotification, type HostTransport, type JsonValue } from '../src/index.js'

class TestTransport implements HostTransport {
  readonly requests: Array<{ method: string; params?: JsonValue }> = []
  private readonly listeners = new Set<(notification: HostNotification) => void>()

  async request(method: string, params?: JsonValue): Promise<unknown> {
    this.requests.push({ method, ...(params === undefined ? {} : { params }) })
    if (method === 'secrets.get') return { found: true, value: 'stored-secret' }
    if (method === 'secrets.delete') return { deleted: true }
    return null
  }

  notify(): void {}
  onNotification(listener: (notification: HostNotification) => void) {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  registerHandler() { return { dispose() {} } }
  dispose(): void { this.listeners.clear() }
}

describe('SecretStorageApi', () => {
  it('uses the protected Host methods without projecting secrets into ordinary storage', async () => {
    const transport = new TestTransport()
    const client = new ExtensionHostClient(transport)

    await expect(client.secrets.get('relay-device-key')).resolves.toBe('stored-secret')
    await expect(client.secrets.set('relay-device-key', 'next-secret')).resolves.toBeUndefined()
    await expect(client.secrets.delete('relay-device-key')).resolves.toBe(true)

    expect(transport.requests).toEqual([
      { method: 'secrets.get', params: { key: 'relay-device-key' } },
      { method: 'secrets.set', params: { key: 'relay-device-key', value: 'next-secret' } },
      { method: 'secrets.delete', params: { key: 'relay-device-key' } }
    ])
    expect(transport.requests.some(({ method }) => method.startsWith('storage.'))).toBe(false)
    client.dispose()
  })
})
