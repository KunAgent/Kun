import { createHash, randomUUID } from 'node:crypto'
import { mobileLinkScopes, type MobileLinkScope } from '../../shared/mobile-link-scopes'
type Grant = { id: string; controllerId: string }
type Advanced = { grantId: string; scopes: MobileLinkScope[]; version: string }
/** Volatile enable-session choices. Unknown/rotated cloud grants never inherit advanced access. */
export class MobileLinkAuthorities {
  private entries = new Map<string, Advanced>()
  clear() { this.entries.clear() }
  sync(grants: Grant[]) {
    const changed: string[] = []
    for (const [peer, value] of this.entries) if (!grants.some((g) => g.controllerId === peer && g.id === value.grantId)) {
      this.entries.delete(peer); changed.push(peer)
    }
    return changed
  }
  set(peer: string, grantId: string, scopes: unknown) {
    const normalized = mobileLinkScopes(scopes)
    const old = this.entries.get(peer)
    if (normalized.length === 1) return this.entries.delete(peer)
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
