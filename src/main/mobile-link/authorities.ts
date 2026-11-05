import { createHash, randomUUID } from 'node:crypto'
import { mobileLinkScopes, type MobileLinkScope } from '../../shared/mobile-link-scopes'
type Grant = { id: string; controllerId: string }
type Advanced = { grantId: string; scopes: MobileLinkScope[]; version: string }
/** Session-bound choices keyed to exact cloud grants; defaults require explicit unified access consent. */
export class MobileLinkAuthorities {
  private entries = new Map<string, Advanced>()
  clear() { this.entries.clear() }
  sync(grants: Grant[], defaults?: MobileLinkScope[]) {
    const changed: string[] = []
    for (const [peer, value] of this.entries) if (!grants.some((g) => g.controllerId === peer && g.id === value.grantId)) {
      this.entries.delete(peer); changed.push(peer)
    }
    if (defaults) for (const grant of grants) if (!this.entries.has(grant.controllerId)) {
      this.set(grant.controllerId, grant.id, defaults)
      if (!changed.includes(grant.controllerId)) changed.push(grant.controllerId)
    }
    return changed
  }
  set(peer: string, grantId: string, scopes: unknown) {
    const normalized = mobileLinkScopes(scopes)
    const old = this.entries.get(peer)
    // Retain explicit personal-only overrides so a later sync cannot reinstate defaults.
    if (old?.grantId === grantId && JSON.stringify(old.scopes) === JSON.stringify(normalized)) return false
    this.entries.set(peer, { grantId, scopes: normalized, version: randomUUID() })
    return true
  }
  remove(peer: string) { return this.entries.delete(peer) }
  scopes(peer: string, grantId: string | undefined): MobileLinkScope[] {
    const entry = this.entries.get(peer)
    return entry && entry.grantId === grantId ? [...entry.scopes] : ['personal']
  }
  identity(transport: string, peer: string, grantId: string | undefined) {
    const entry = this.entries.get(peer)
    return createHash('sha256').update(JSON.stringify([transport, peer, grantId ?? null,
      entry?.grantId === grantId ? entry?.version ?? null : null])).digest('hex')
  }
}
