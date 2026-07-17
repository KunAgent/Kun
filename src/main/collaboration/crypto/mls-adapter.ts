import { createRequire } from 'node:module'

export type NativeAddMemberResult = {
  commit: Buffer
  welcome: Buffer
  ratchetTree: Buffer
}

export interface NativeMlsClientInstance {
  readonly epoch: number | null
  keyPackage(): Buffer
  createGroup(groupId: Buffer): void
  addMember(keyPackage: Buffer): NativeAddMemberResult
  joinGroup(welcome: Buffer, ratchetTree: Buffer): void
  encrypt(plaintext: Buffer): Buffer
  decrypt(ciphertext: Buffer): Buffer
  processCommit(commit: Buffer): void
  removeMember(identity: Buffer): Buffer
  checkpointDigest(): Buffer
  exportEncryptedState(stateKey: Buffer): Buffer
}

export interface NativeMlsClientConstructor {
  new(identity: Buffer): NativeMlsClientInstance
  importEncryptedState(state: Buffer, stateKey: Buffer): NativeMlsClientInstance
}

export type NativeMlsBinding = {
  openmlsBindingVersion(): string
  NativeMlsClient: NativeMlsClientConstructor
}

export class MlsAdapterError extends Error {
  constructor(
    readonly code: 'collaboration_crypto_unavailable' | 'collaboration_crypto_invalid',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MlsAdapterError'
  }
}

export class MlsAdapter {
  constructor(private readonly binding: NativeMlsBinding) {}

  static load(
    nativePath: string,
    load: (path: string) => unknown = (path) => createRequire(import.meta.url)(path)
  ): MlsAdapter {
    let candidate: unknown
    try {
      candidate = load(nativePath)
    } catch (cause) {
      throw new MlsAdapterError(
        'collaboration_crypto_unavailable',
        `OpenMLS native binding could not be loaded: ${nativePath}`,
        { cause }
      )
    }
    if (!isNativeBinding(candidate)) {
      throw new MlsAdapterError('collaboration_crypto_invalid', 'OpenMLS native binding has an invalid interface')
    }
    return new MlsAdapter(candidate)
  }

  version(): string {
    return this.binding.openmlsBindingVersion()
  }

  createSession(identity: string): MlsSession {
    return new MlsSession(new this.binding.NativeMlsClient(requiredUtf8(identity, 'identity')))
  }

  restoreSession(state: Buffer, stateKey: Buffer): MlsSession {
    requireStateKey(stateKey)
    return new MlsSession(this.binding.NativeMlsClient.importEncryptedState(state, stateKey))
  }
}

export class MlsSession {
  constructor(private readonly native: NativeMlsClientInstance) {}

  epoch(): number | null { return this.native.epoch }
  keyPackage(): Buffer { return Buffer.from(this.native.keyPackage()) }
  createGroup(groupId: string): void { this.native.createGroup(requiredUtf8(groupId, 'groupId')) }
  addMember(keyPackage: Buffer): NativeAddMemberResult { return this.native.addMember(keyPackage) }
  joinGroup(welcome: Buffer, ratchetTree: Buffer): void { this.native.joinGroup(welcome, ratchetTree) }
  encrypt(plaintext: Buffer): Buffer { return Buffer.from(this.native.encrypt(plaintext)) }
  decrypt(ciphertext: Buffer): Buffer { return Buffer.from(this.native.decrypt(ciphertext)) }
  processCommit(commit: Buffer): void { this.native.processCommit(commit) }
  removeMember(identity: string): Buffer { return Buffer.from(this.native.removeMember(requiredUtf8(identity, 'identity'))) }
  checkpointDigest(): Buffer { return Buffer.from(this.native.checkpointDigest()) }
  exportEncryptedState(stateKey: Buffer): Buffer {
    requireStateKey(stateKey)
    return Buffer.from(this.native.exportEncryptedState(stateKey))
  }
}

function isNativeBinding(value: unknown): value is NativeMlsBinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<NativeMlsBinding>
  return typeof candidate.openmlsBindingVersion === 'function' &&
    typeof candidate.NativeMlsClient === 'function'
}

function requiredUtf8(value: string, field: string): Buffer {
  const trimmed = value.trim()
  if (!trimmed) throw new MlsAdapterError('collaboration_crypto_invalid', `${field} is required`)
  return Buffer.from(trimmed, 'utf8')
}

function requireStateKey(key: Buffer): void {
  if (key.byteLength !== 32) {
    throw new MlsAdapterError('collaboration_crypto_invalid', 'MLS state key must be exactly 32 bytes')
  }
}
