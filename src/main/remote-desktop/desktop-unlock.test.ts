import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_DEVICE_CAPABILITY,
  DESKTOP_MOBILE_ORIGIN_CAPABILITY,
  DESKTOP_SCOPED_CAPABILITY,
  DESKTOP_UNLOCK_CAPABILITY,
  sealDesktopUnlockPassword
} from '@kun/remote-protocol'
import type { DesktopAuthority } from '@kun/control-runtime/desktop'
import { ControlDesktop } from '../control-host/desktop'
import { DesktopUnlockCoordinator, type DesktopHostLockState } from './desktop-unlock'
import { desktopActivityGate } from './activity-gate'

const hosts: ControlDesktop[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  desktopActivityGate.release('external-owner')
  for (const host of hosts.splice(0)) await host.stopAll()
})

function makeAuthority(overrides: Partial<DesktopAuthority> = {}): DesktopAuthority {
  return {
    accountId: 'owner-1',
    deviceId: 'phone-1',
    hostId: '11111111-1111-4111-8111-111111111111',
    authorizationId: 'grant-1',
    scopes: ['desktop.view', 'desktop.control', 'desktop.unlock'],
    current: () => true,
    emit: () => {},
    ...overrides
  }
}

describe('DesktopUnlockCoordinator', () => {
  it('opens a single-use encrypted challenge, rejects replay, and never leaks password in diagnostics or errors', async () => {
    const diagnostics: unknown[] = []
    const unlockedPasswords: string[] = []
    const coordinator = new DesktopUnlockCoordinator({
      supported: () => true,
      readLockState: async () => ({ lockState: 'locked', inputReady: true }),
      runUnlock: async (password) => { unlockedPasswords.push(password) },
      diagnostic: (event) => diagnostics.push(event)
    })
    const authority = makeAuthority()
    const challenge = await coordinator.prepare(authority)
    const box = sealDesktopUnlockPassword({
      challengeId: challenge.challengeId,
      hostId: authority.hostId!,
      hostPublicKey: challenge.publicKey,
      password: 'CorrectHorseBatteryStaple!99',
      secretKey: randomBytes(32),
      nonce: randomBytes(24)
    })
    await expect(coordinator.submit(authority, box)).resolves.toEqual({ unlocked: true })
    expect(unlockedPasswords).toEqual(['CorrectHorseBatteryStaple!99'])
    await expect(coordinator.submit(authority, box)).rejects.toThrow('DESKTOP_SESSION_EXPIRED')
    expect(JSON.stringify(diagnostics)).not.toContain('CorrectHorseBatteryStaple!99')
  })

  it('rejects unlocked, inactive, missing input permission, and mismatched peer authority', async () => {
    let state: DesktopHostLockState = { lockState: 'unlocked', inputReady: true }
    const coordinator = new DesktopUnlockCoordinator({
      supported: () => true,
      readLockState: async () => state,
      runUnlock: async () => {}
    })
    const authority = makeAuthority()
    await expect(coordinator.prepare(authority)).rejects.toThrow('DESKTOP_ALREADY_UNLOCKED')
    state = { lockState: 'inactive', inputReady: true }
    await expect(coordinator.prepare(authority)).rejects.toThrow('DESKTOP_HOST_INACTIVE')
    state = { lockState: 'locked', inputReady: false }
    await expect(coordinator.prepare(authority)).rejects.toThrow('INPUT_PERMISSION_REQUIRED')

    state = { lockState: 'locked', inputReady: true }
    const challenge = await coordinator.prepare(authority)
    const box = sealDesktopUnlockPassword({
      challengeId: challenge.challengeId,
      hostId: authority.hostId!,
      hostPublicKey: challenge.publicKey,
      password: 'secret',
      secretKey: randomBytes(32),
      nonce: randomBytes(24)
    })
    await expect(coordinator.submit(makeAuthority({ deviceId: 'phone-2' }), box)).rejects.toThrow('DESKTOP_AUTHORITY_CHANGED')
  })

  it('sanitizes unexpected helper errors and rate-limits repeated wrong passwords', async () => {
    let now = 1_000
    const diagnostics: unknown[] = []
    let failMode: 'denied' | 'raw-secret' = 'raw-secret'
    const coordinator = new DesktopUnlockCoordinator({
      supported: () => true,
      now: () => now,
      readLockState: async () => ({ lockState: 'locked', inputReady: true }),
      runUnlock: async (password) => {
        if (failMode === 'raw-secret') throw new Error(`helper crashed with ${password}`)
        throw new Error('DESKTOP_UNLOCK_DENIED')
      },
      diagnostic: (event) => diagnostics.push(event)
    })
    const authority = makeAuthority()
    const attempt = async (password: string) => {
      const challenge = await coordinator.prepare(authority)
      const box = sealDesktopUnlockPassword({
        challengeId: challenge.challengeId,
        hostId: authority.hostId!,
        hostPublicKey: challenge.publicKey,
        password,
        secretKey: randomBytes(32),
        nonce: randomBytes(24)
      })
      return coordinator.submit(authority, box)
    }

    await expect(attempt('MySensitivePass!1')).rejects.toThrow('DESKTOP_UNLOCK_FAILED')
    expect(JSON.stringify(diagnostics)).not.toContain('MySensitivePass!1')

    failMode = 'denied'
    for (let index = 0; index < 5; index += 1) {
      await expect(attempt(`wrong-${index}`)).rejects.toThrow('DESKTOP_UNLOCK_DENIED')
    }
    await expect(coordinator.prepare(authority)).rejects.toThrow('DESKTOP_UNLOCK_RATE_LIMITED')
    now += 60_001
    await expect(coordinator.prepare(authority)).resolves.toMatchObject({ expiresInMs: 60_000 })
  })
})

describe('ControlDesktop manual lock-screen unlock', () => {
  async function createConfiguredHost(getState: () => DesktopHostLockState, runUnlock: (password: string) => Promise<void> = async () => {}) {
    const unlock = new DesktopUnlockCoordinator({
      supported: () => true,
      readLockState: async () => getState(),
      runUnlock
    })
    const rpc = {
      closed: false,
      call: vi.fn(async (_method: string, value: any) => {
        if (value?.method === 'status' || value?.method === 'configure' || value?.method === 'configureRemoteAccess') {
          return {
            supported: true,
            enabled: value?.method === 'configure' ? value.value.enabled : value?.value !== false,
            ready: true,
            displays: [{ token: 'disp-1', revision: 'rev-1', label: 'Built-in', primary: true, width: 1440, height: 900, allowed: true }]
          }
        }
        if (value?.method === 'capabilities') return [DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY, DESKTOP_MOBILE_ORIGIN_CAPABILITY]
        if (value?.method === 'invoke') return { state: 'viewing', session: { startId: value.value.params.startId } }
      })
    }
    const host = new ControlDesktop({
      supported: () => true,
      unlockSupported: () => true,
      lockState: async () => getState(),
      unlock,
      mobileOriginSupported: () => true,
      displays: () => [],
      indicator: { hide() {} },
      arbiter: { release: async () => {} }
    } as any, async () => rpc as any)
    hosts.push(host)
    await host.configureRemoteAccess(true)
    return { host, rpc }
  }

  it('ends start cleanly when locked, reports lock status by scope, and unlocks only for authorized phones', async () => {
    let state: DesktopHostLockState = { lockState: 'locked', inputReady: true }
    const unlocked: string[] = []
    const { host, rpc } = await createConfiguredHost(() => state, async (password) => {
      unlocked.push(password)
      state = { lockState: 'unlocked', inputReady: true }
    })

    const fullPhone = makeAuthority()
    const viewOnlyPhone = makeAuthority({ deviceId: 'phone-view', scopes: ['desktop.view'] })
    const controlOnlyPhone = makeAuthority({ deviceId: 'phone-ctrl', scopes: ['desktop.view', 'desktop.control'] })
    const computerPeer = makeAuthority({ deviceId: 'mac-peer', purpose: 'desktop', scopes: ['desktop.view', 'desktop.control'] })

    const fullAccess = await host.invoke('desktop.access.get', {}, fullPhone)
    expect(fullAccess.capabilities).toContain(DESKTOP_UNLOCK_CAPABILITY)
    expect((await host.invoke('desktop.access.get', {}, controlOnlyPhone)).capabilities).not.toContain(DESKTOP_UNLOCK_CAPABILITY)
    expect((await host.invoke('desktop.access.get', {}, computerPeer)).capabilities).not.toContain(DESKTOP_UNLOCK_CAPABILITY)

    const startId = randomUUID()
    const ended = await host.invoke('desktop.session.start', {
      startId,
      origin: { kind: 'device', id: fullPhone.hostId! },
      displayToken: 'disp-1',
      displayRevision: 'rev-1',
      quality: 'balanced'
    }, fullPhone)
    expect(ended).toEqual({ state: 'ended', startId, reason: 'host_inactive', confirmed: true })
    expect(desktopActivityGate.busy()).toBe(false)
    expect(rpc.call.mock.calls.some(([, payload]) => payload?.method === 'invoke')).toBe(false)

    await expect(host.invoke('desktop.unlock.status', {}, fullPhone)).resolves.toEqual({
      lockState: 'locked',
      unlockAllowed: true,
      inputReady: true
    })
    await expect(host.invoke('desktop.unlock.status', {}, viewOnlyPhone)).resolves.toEqual({
      lockState: 'locked',
      unlockAllowed: false,
      inputReady: true
    })
    await expect(host.invoke('desktop.unlock.prepare', {}, controlOnlyPhone)).rejects.toThrow('DESKTOP_CONTROL_REQUIRED')

    const challenge = await host.invoke('desktop.unlock.prepare', {}, fullPhone)
    const box = sealDesktopUnlockPassword({
      challengeId: challenge.challengeId,
      hostId: fullPhone.hostId!,
      hostPublicKey: challenge.publicKey,
      password: 'mac-login-pass',
      secretKey: randomBytes(32),
      nonce: randomBytes(24)
    })
    await expect(host.invoke('desktop.unlock.submit', box, fullPhone)).resolves.toEqual({ unlocked: true })
    expect(unlocked).toEqual(['mac-login-pass'])

    const started = await host.invoke('desktop.session.start', {
      startId: randomUUID(),
      origin: { kind: 'device', id: fullPhone.hostId! },
      displayToken: 'disp-1',
      displayRevision: 'rev-1',
      quality: 'balanced'
    }, fullPhone)
    expect(started).toMatchObject({ state: 'viewing' })
  })

  it('disables unlock capability and rejects prepare when Mac owner turns allowUnlock off or desktop is busy', async () => {
    const state: DesktopHostLockState = { lockState: 'locked', inputReady: true }
    const { host } = await createConfiguredHost(() => state)
    const authority = makeAuthority()

    desktopActivityGate.claim('external-owner', 'incoming')
    await expect(host.invoke('desktop.unlock.prepare', {}, authority)).rejects.toThrow('DESKTOP_BUSY')
    desktopActivityGate.release('external-owner')

    await host.configure({ enabled: true, displayTokens: ['disp-1'], allowUnlock: false })
    expect((await host.invoke('desktop.access.get', {}, authority)).capabilities).not.toContain(DESKTOP_UNLOCK_CAPABILITY)
    await expect(host.invoke('desktop.unlock.status', {}, authority)).resolves.toEqual({
      lockState: 'locked',
      unlockAllowed: false,
      inputReady: true
    })
    await expect(host.invoke('desktop.unlock.prepare', {}, authority)).rejects.toThrow('DESKTOP_UNLOCK_UNAVAILABLE')
  })
})
