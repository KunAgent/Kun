import type { KunActionApprovalGrant } from '../../ports/tool-host.js'

// Object identity is the proof. A JSON-shaped grant supplied by a caller is never trusted.
const grants = new WeakSet<object>()
export function registerHostActionApprovalGrant(grant: Readonly<KunActionApprovalGrant>): void {
  grants.add(grant)
}
export function consumeHostActionApprovalGrant(grant: Readonly<KunActionApprovalGrant>): boolean {
  if (!grants.has(grant)) return false
  grants.delete(grant)
  return true
}
