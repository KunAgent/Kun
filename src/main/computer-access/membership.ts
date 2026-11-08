import { RemoteError, type AccountEntitlements } from '@kun/remote-protocol'
import { computerRemoteAllowed, COMPUTER_MAX_REQUIRED } from '../../shared/computer-membership'
import { readAccountEntitlements } from '../account-entitlements'
import type { ArtAccountAccess } from '../art-assets/account-access'

export const COMPUTER_MEMBERSHIP_LEASE_MS = 30000
export function computerMembershipError() { return Object.assign(new RemoteError(COMPUTER_MAX_REQUIRED), { status: 403 }) }
export async function requireComputerRemote(account: ArtAccountAccess, fetcher: typeof fetch, origin?: string) {
  let value: AccountEntitlements
  try { value = await readAccountEntitlements(account, fetcher, origin) }
  catch (error) {
    if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED'].includes((error as Error)?.message)) throw error
    throw new RemoteError('ENTITLEMENTS_UNAVAILABLE')
  }
  if (!computerRemoteAllowed(value)) throw computerMembershipError()
  return value
}

/** A cached positive result has a hard monotonic deadline, including slow responses and expiry. */
export class ComputerMembershipLease {
  private deadline = -Infinity
  private pending?: Promise<void>
  private generation = 0
  constructor(readonly owner: string, private readonly read: () => Promise<AccountEntitlements>, private readonly now = () => performance.now()) {}
  remaining() { return Math.max(0, this.deadline - this.now()) }
  current() { return this.remaining() > 0 }
  invalidate() { ++this.generation; this.deadline = -Infinity; this.pending = undefined }
  async require(force = false): Promise<void> {
    if (!force && this.current()) return
    if (this.pending) return this.pending
    const started = this.now(), generation = this.generation
    const task = (async () => {
      let value: AccountEntitlements
      try { value = await this.read() }
      catch (error) {
        if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED'].includes((error as Error)?.message)) throw error
        throw new RemoteError('ENTITLEMENTS_UNAVAILABLE')
      }
      if (generation !== this.generation || value.userId !== this.owner) throw Error('ACCOUNT_CHANGED')
      if (!computerRemoteAllowed(value)) throw computerMembershipError()
      const remaining = value.expiresAt === null ? COMPUTER_MEMBERSHIP_LEASE_MS : Date.parse(value.expiresAt) - Date.parse(value.checkedAt)
      const deadline = started + Math.min(COMPUTER_MEMBERSHIP_LEASE_MS, remaining)
      if (!Number.isFinite(deadline) || deadline <= this.now()) throw new RemoteError('ENTITLEMENTS_UNAVAILABLE')
      this.deadline = deadline
    })().catch(error => { if (generation === this.generation) this.deadline = -Infinity; throw error })
    this.pending = task
    try { await task } finally { if (this.pending === task) this.pending = undefined }
  }
}
