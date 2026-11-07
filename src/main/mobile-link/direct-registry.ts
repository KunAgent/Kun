import { randomBytes, randomUUID } from 'node:crypto'
import { directAddresses, encodeDirectPairing, type DirectPairing } from '@kun/remote-protocol'
import { mobileLinkScopes, type MobileLinkScope } from '../../shared/mobile-link-scopes'

export type DirectGrant = { id: string; secret: string; deviceId: string; name: string; scopes: MobileLinkScope[]; expiresAt: number }
export type DirectSettings = { enabled: boolean; port: number; bind: 'lan' | 'loopback'; addresses: string[];
  iceServers: { urls: string | string[]; username?: string; credential?: string }[]; grants: DirectGrant[] }
export const emptyDirectSettings = (): DirectSettings => ({ enabled: false, port: 0, bind: 'lan', addresses: [], iceServers: [], grants: [] })

export class DirectRegistry {
  private pairing?: DirectPairing & { scopes: MobileLinkScope[] }
  private queue = Promise.resolve()
  private denied = new Set<string>()
  private closed = false
  constructor(readonly hostId: string, readonly name: string, readonly settings: DirectSettings,
    private persist: (settings: DirectSettings) => Promise<void>, private now = Date.now,
    private persistRevocation?: (id: string) => Promise<void>) {}
  pair(addresses: string[], scopes: unknown): string {
    if (this.closed) throw Error('DIRECT_NOT_RUNNING')
    const granted = mobileLinkScopes(scopes)
    if (granted.includes('shares.manage')) throw Error('INVALID_SCOPES')
    if (!granted.includes('personal')) throw Error('INVALID_SCOPE')
    if (this.settings.grants.length >= 16) throw Error('DIRECT_DEVICE_LIMIT')
    this.pairing = { v: 1, hostId: this.hostId, name: this.name, id: randomUUID(), secret: randomBytes(32).toString('hex'),
      addresses: directAddresses(addresses), expiresAt: this.now() + 5 * 60000, scopes: granted }
    const { scopes: _scopes, ...link } = this.pairing
    return encodeDirectPairing(link)
  }
  credential(id: string, pairing: boolean): { secret: string; scopes: MobileLinkScope[] } | undefined {
    const value = pairing ? this.pairing?.id === id ? this.pairing : undefined : this.settings.grants.find(grant => grant.id === id)
    return !this.closed && !this.denied.has(id) && value && value.expiresAt > this.now() ? value : undefined
  }
  valid(grant: DirectGrant) { return !this.closed && !this.denied.has(grant.id) && grant.expiresAt > this.now() && this.settings.grants.some(item => item === grant) }
  accept(id: string, pairing: boolean, deviceId: string, name: string): Promise<DirectGrant> {
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId) || typeof name !== 'string' || !name.trim() || name.length > 180) return Promise.reject(Error('DIRECT_AUTH_FAILED'))
    let result!: DirectGrant
    const task = this.queue.then(async () => {
      if (this.closed) throw Error('DIRECT_NOT_RUNNING')
      const existing = this.settings.grants.find(grant => grant.id === id)
      if (!pairing) {
        if (!existing || !this.valid(existing) || existing.deviceId !== deviceId) throw Error('DIRECT_AUTH_FAILED')
        result = existing; return
      }
      const bootstrap = this.pairing
      if (!bootstrap || bootstrap.id !== id || bootstrap.expiresAt <= this.now() || this.settings.grants.length >= 16) throw Error('DIRECT_AUTH_FAILED')
      this.pairing = undefined
      result = { id: randomUUID(), secret: randomBytes(32).toString('hex'), deviceId, name: name.trim(), scopes: bootstrap.scopes,
        expiresAt: this.now() + 90 * 86400000 }
      const grants = [...this.settings.grants.filter(item => item.deviceId !== deviceId), result]
      await this.persist({ ...this.settings, grants })
      if (this.closed) throw Error('DIRECT_NOT_RUNNING')
      this.settings.grants = grants
    })
    this.queue = task.catch(() => {})
    return task.then(() => result)
  }
  async revoke(id: string) {
    this.denied.add(id)
    this.pairing = undefined
    const task = this.queue.then(async () => {
      if (!this.settings.grants.some(grant => grant.id === id)) throw Error('INVALID_GRANT')
      if (this.persistRevocation) await this.persistRevocation(id)
      this.settings.grants = this.settings.grants.filter(grant => grant.id !== id)
      if (!this.persistRevocation) await this.persist(this.settings)
    })
    this.queue = task.catch(() => {})
    await task
  }
  cancelPairing() { this.pairing = undefined }
  async close() { this.closed = true; this.pairing = undefined; await this.queue }
}
