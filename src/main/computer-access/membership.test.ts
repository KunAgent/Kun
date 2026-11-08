import { expect, it } from 'vitest'
import type { AccountEntitlements, VipTier } from '@kun/remote-protocol'
import { computerRemoteAllowed } from '../../shared/computer-membership'
import { ComputerMembershipLease } from './membership'

const owner = '11111111-1111-4111-8111-111111111111'
function snapshot(tier: VipTier, expired = false): AccountEntitlements {
  return { version:1,userId:owner,tier,effectiveTier:expired?'free':tier,status:expired?'expired':tier==='free'?'free':'active',
    expiresAt:expired?'2026-11-01T00:00:00Z':null,checkedAt:'2026-11-08T00:00:00Z',revision:1,
    features:{mobileRemote:!expired&&tier!=='free',personalAssistant:!expired&&['pro','max'].includes(tier)} }
}
it('admits active Max only without narrowing the phone entitlement', async () => {
  for (const tier of ['free','plus','pro','max'] as const) {
    const value=snapshot(tier), lease=new ComputerMembershipLease(owner,async()=>value)
    expect(computerRemoteAllowed(value)).toBe(tier==='max')
    if(tier==='max') { await lease.require(); expect(lease.current()).toBe(true) }
    else await expect(lease.require()).rejects.toMatchObject({code:'vip_computer_remote_required',status:403})
    expect(value.features.mobileRemote).toBe(tier!=='free')
  }
  expect(computerRemoteAllowed(snapshot('max',true))).toBe(false)
})
it('expires a cached decision on a monotonic deadline and fences downgrade and failed revalidation', async () => {
  let now=0, value=snapshot('max'), fail=false
  const lease=new ComputerMembershipLease(owner,async()=>{if(fail)throw Error('offline');return value},()=>now)
  await lease.require(); now=30001; expect(lease.current()).toBe(false)
  await lease.require(); expect(lease.current()).toBe(true)
  value=snapshot('pro'); await expect(lease.require(true)).rejects.toThrow('vip_computer_remote_required');expect(lease.current()).toBe(false)
  value=snapshot('max');await lease.require();fail=true
  await expect(lease.require(true)).rejects.toThrow('ENTITLEMENTS_UNAVAILABLE');expect(lease.current()).toBe(false)
})
it('bounds membership expiry by server time and never accepts a late or wrong-account result', async () => {
  let now=0
  const value={...snapshot('max'),expiresAt:'2026-11-08T00:00:01Z'}
  const lease=new ComputerMembershipLease(owner,async()=>value,()=>now)
  await lease.require();now=1001;expect(lease.current()).toBe(false)
  const late=new ComputerMembershipLease(owner,async()=>{now+=2000;return value},()=>now)
  await expect(late.require()).rejects.toThrow('ENTITLEMENTS_UNAVAILABLE')
  const wrong=new ComputerMembershipLease('other',async()=>snapshot('max'))
  await expect(wrong.require()).rejects.toThrow('ACCOUNT_CHANGED')
})
