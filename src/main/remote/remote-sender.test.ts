import { describe, expect, it } from 'vitest'
import { isRemoteClientSender, RemoteClientSender } from './remote-sender'

describe('RemoteClientSender', () => {
  it('forwards send() payloads to the client sink', () => {
    const sent: Array<{ channel: string; payload: unknown }> = []
    const sender = new RemoteClientSender('client-a', (channel, payload) => {
      sent.push({ channel, payload })
    })
    sender.send('terminal:data', { sessionId: 's', data: 'x' })
    expect(sent).toEqual([{ channel: 'terminal:data', payload: { sessionId: 's', data: 'x' } }])
    expect(sender.isDestroyed()).toBe(false)
  })

  it('uniquely assigns negative ids so they never collide with webContents ids', () => {
    const a = new RemoteClientSender('a', () => undefined)
    const b = new RemoteClientSender('b', () => undefined)
    expect(a.id).toBeLessThan(0)
    expect(b.id).toBeLessThan(a.id)
  })

  it('emits destroyed and stops forwarding after destroy()', () => {
    const sent: string[] = []
    const sender = new RemoteClientSender('c', (channel) => sent.push(channel))
    let destroyed = false
    sender.once('destroyed', () => {
      destroyed = true
    })
    sender.destroy()
    expect(destroyed).toBe(true)
    expect(sender.isDestroyed()).toBe(true)
    sender.send('terminal:data', {})
    expect(sent).toEqual([])
  })

  it('is detected by isRemoteClientSender', () => {
    const sender = new RemoteClientSender('d', () => undefined)
    expect(isRemoteClientSender(sender)).toBe(true)
    expect(isRemoteClientSender({ id: 1 })).toBe(false)
    expect(isRemoteClientSender(null)).toBe(false)
  })
})
