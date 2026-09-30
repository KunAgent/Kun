import { describe, expect, it, vi } from 'vitest'
const electronMock = vi.hoisted(() => ({ expose: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electronMock.expose }, ipcRenderer: { send: electronMock.send } }))
import './protected-room-dialog'

describe('protected consent preload bridge', () => {
  it('exposes only a frozen nonce-bound decision method', () => {
    const [name, bridge] = electronMock.expose.mock.calls[0]
    expect(name).toBe('kunProtectedRoom')
    expect(Object.keys(bridge)).toEqual(['confirm'])
    expect(Object.isFrozen(bridge)).toBe(true)
    bridge.confirm(true, 'a'.repeat(48))
    expect(electronMock.send).toHaveBeenLastCalledWith('protected-room:confirm', { confirmed: true, nonce: 'a'.repeat(48) })
    bridge.confirm(false, 'b'.repeat(48))
    expect(electronMock.send).toHaveBeenLastCalledWith('protected-room:confirm', { confirmed: false, nonce: 'b'.repeat(48) })
    bridge.confirm(true)
    bridge.confirm('allow', 'a'.repeat(48))
    bridge.confirm(true, 'not-a-session')
    expect(electronMock.send).toHaveBeenCalledTimes(2)
  })
})
