import { describe, expect, it } from 'vitest'
import type { AppSessionOwner } from '../contracts/app-session-owner.js'
import {
  LEGACY_MANAGER_BUSY_MESSAGE,
  LEGACY_MANAGER_OWNED_MESSAGE,
  assertLegacyManagerIdle,
  liveApplicationOwner,
  liveRuntimeSlots
} from './legacy-manager-idle.js'

const liveOwner: AppSessionOwner = {
  ownerSessionId: 'live-session',
  ownerKind: 'gui',
  ownerPid: 4321,
  ownerStartedAt: '2026-09-20T03:00:00.000Z',
  ownerProcessIdentity: 'darwin-v1:Sat Sep 20 11:00:00 2026',
  generation: 1
}

function slot(pid: number, startedAt = '2026-09-20T03:00:00.000Z'): unknown {
  return {
    registration: {
      flavor: 'production',
      instanceId: `runtime-${pid}`,
      pid,
      startedAt,
      host: '127.0.0.1',
      port: 18900,
      baseUrl: 'http://127.0.0.1:18900',
      runtimeToken: 'token'
    },
    lastHeartbeatAt: startedAt
  }
}

describe('legacy Manager idle checks', () => {
  it('treats a verified-dead application owner as absent', () => {
    expect(liveApplicationOwner(liveOwner, () => false)).toBeUndefined()
  })

  it('keeps a live application owner', () => {
    expect(liveApplicationOwner(liveOwner, () => true)).toEqual(liveOwner)
  })

  it('fails closed when an owner record cannot be parsed', () => {
    expect(() => liveApplicationOwner({ ownerPid: 1 }, () => false)).toThrow(LEGACY_MANAGER_OWNED_MESSAGE)
  })

  it('ignores slots whose processes are already dead', () => {
    expect(liveRuntimeSlots([slot(88), slot(89)], () => false)).toEqual([])
  })

  it('keeps slots whose processes are still alive', () => {
    const value = slot(90)
    expect(liveRuntimeSlots([value], (pid) => pid === 90)).toEqual([value])
  })

  it('fails closed when a slot cannot be parsed', () => {
    expect(() => liveRuntimeSlots([{ pid: 12 }], () => false)).toThrow(LEGACY_MANAGER_BUSY_MESSAGE)
  })

  it('allows retirement when recorded owners and slots are verified dead', () => {
    expect(() => assertLegacyManagerIdle({
      discoveryOwner: liveOwner,
      healthOwner: liveOwner,
      statusOwner: liveOwner,
      slots: [slot(91)]
    }, () => false)).not.toThrow()
  })

  it('refuses retirement when the discovery owner is still alive', () => {
    expect(() => assertLegacyManagerIdle({
      discoveryOwner: liveOwner,
      slots: []
    }, () => true)).toThrow(LEGACY_MANAGER_OWNED_MESSAGE)
  })

  it('refuses retirement when a Runtime slot is still alive', () => {
    expect(() => assertLegacyManagerIdle({
      slots: [slot(92)]
    }, () => true)).toThrow(LEGACY_MANAGER_BUSY_MESSAGE)
  })
})
