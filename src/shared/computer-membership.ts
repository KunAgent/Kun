import type { AccountEntitlements } from '@kun/remote-protocol'

export const COMPUTER_MAX_REQUIRED = 'vip_computer_remote_required'
/** The established v1 entitlement snapshot stays compatible with existing phone clients. */
export function computerRemoteAllowed(value: AccountEntitlements | null | undefined): boolean {
  return value?.effectiveTier === 'max' && value.status === 'active' &&
    (value.expiresAt === null || Date.parse(value.expiresAt) > Date.parse(value.checkedAt))
}
