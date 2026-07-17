import { describe, expect, it, vi } from 'vitest'
import { MlsAdapter, type NativeMlsBinding } from './mls-adapter'

class FakeNativeClient {
  static importEncryptedState = vi.fn(() => new FakeNativeClient(Buffer.from('restored')))
  epoch: number | null = null
  constructor(readonly identity: Buffer) {}
  keyPackage = vi.fn(() => Buffer.from('key-package'))
  createGroup = vi.fn(() => { this.epoch = 0 })
  addMember = vi.fn(() => ({ commit: Buffer.from('commit'), welcome: Buffer.from('welcome'), ratchetTree: Buffer.from('tree') }))
  joinGroup = vi.fn(() => { this.epoch = 1 })
  encrypt = vi.fn((value: Buffer) => Buffer.concat([Buffer.from('encrypted:'), value]))
  decrypt = vi.fn((value: Buffer) => value.subarray('encrypted:'.length))
  processCommit = vi.fn()
  removeMember = vi.fn(() => Buffer.from('remove-commit'))
  checkpointDigest = vi.fn(() => Buffer.alloc(32, 1))
  exportEncryptedState = vi.fn(() => Buffer.from('encrypted-state'))
}

const binding: NativeMlsBinding = {
  openmlsBindingVersion: () => 'openmls-0.8.1/rfc9420',
  NativeMlsClient: FakeNativeClient
}

describe('MlsAdapter', () => {
  it('exposes only opaque messages and encrypted persistence', () => {
    const adapter = new MlsAdapter(binding)
    const session = adapter.createSession('member-1')
    session.createGroup('meeting-1')

    expect(adapter.version()).toContain('rfc9420')
    expect(session.keyPackage()).toEqual(Buffer.from('key-package'))
    expect(session.encrypt(Buffer.from('hello'))).toEqual(Buffer.from('encrypted:hello'))
    expect(session.exportEncryptedState(Buffer.alloc(32, 7))).toEqual(Buffer.from('encrypted-state'))
    expect(session).not.toHaveProperty('groupSecret')
    expect(session).not.toHaveProperty('signer')
  })

  it('uses a stable unavailable error when the native module cannot load', () => {
    expect(() => MlsAdapter.load('missing.node', () => { throw new Error('missing') }))
      .toThrowError(expect.objectContaining({ code: 'collaboration_crypto_unavailable' }))
  })
})
