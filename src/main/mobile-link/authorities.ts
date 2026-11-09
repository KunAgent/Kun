import { createHash, randomUUID } from 'node:crypto'
import { mobileLinkScopes, computerDesktopScopes, type MobileLinkScope } from '../../shared/mobile-link-scopes'
type Grant = { id: string; controllerId: string; purpose?: 'desktop' }
type Advanced = { grantId: string; scopes: MobileLinkScope[]; version: string }
/** Session-bound choices keyed to exact cloud grants; defaults require explicit unified access consent. */
export class MobileLinkAuthorities {
  private entries = new Map<string, Advanced>()
  private grants = new Map<string, Grant>()
  clear() { this.entries.clear(); this.grants.clear() }
  sync(grants: Grant[], defaults?: MobileLinkScope[], computerDefaults?: MobileLinkScope[]) {
    const changed: string[] = []
    for (const [peer, value] of this.entries) if (!grants.some((g) => g.controllerId === peer && g.id === value.grantId && g.purpose === this.grants.get(peer)?.purpose)) {
      this.entries.delete(peer); changed.push(peer)
    }
    this.grants = new Map(grants.map(grant => [grant.controllerId, grant]))
    for (const grant of grants) {
      const scopes = grant.purpose === 'desktop' ? computerDefaults : defaults
      if (scopes && !this.entries.has(grant.controllerId)) {
        this.set(grant.controllerId, grant.id, scopes)
        if (!changed.includes(grant.controllerId)) changed.push(grant.controllerId)
      }
    }
    return changed
  }
  set(peer: string, grantId: string, scopes: unknown) {
    const normalized = this.purpose(peer, grantId) === 'desktop' ? computerDesktopScopes(scopes) : mobileLinkScopes(scopes)
    const old = this.entries.get(peer)
    // Retain explicit overrides, including no desktop access, across later syncs.
    if (old?.grantId === grantId && JSON.stringify(old.scopes) === JSON.stringify(normalized)) return false
    this.entries.set(peer, { grantId, scopes: normalized, version: randomUUID() })
    return true
  }
  remove(peer: string) { return this.entries.delete(peer) }
  scopes(peer: string, grantId: string | undefined): MobileLinkScope[] {
    const entry = this.entries.get(peer)
    return entry && entry.grantId === grantId ? [...entry.scopes] : this.purpose(peer, grantId) === 'desktop' ? [] : ['personal']
  }
  purpose(peer: string, grantId?: string) { const grant = this.grants.get(peer); return grant?.id === grantId ? grant?.purpose : undefined }
  identity(transport: string, peer: string, grantId: string | undefined) {
    const entry = this.entries.get(peer)
    const identity = [transport, peer, grantId ?? null, entry?.grantId === grantId ? entry?.version ?? null : null]
    if (this.purpose(peer, grantId) === 'desktop') identity.push('desktop')
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  }
}
