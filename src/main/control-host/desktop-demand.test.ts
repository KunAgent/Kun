import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ControlDesktop } from './desktop'

const dependencies = () => ({ supported: () => true, displays: () => [], arbiter: {release: async () => {}}, indicator: {hide() {}} })
it('desktop status and disable at startup never demand a first package installation', async () => {
  const ready = vi.fn(async (_required: boolean) => undefined)
  const desktop = new ControlDesktop(dependencies() as any, ready)
  expect(await desktop.status()).toEqual({supported: true, enabled: false, ready: false, reason: 'CONTROL_PACKAGE_NOT_INSTALLED', displays: []})
  expect((await desktop.configureRemoteAccess(false)).enabled).toBe(false)
  expect((await desktop.configure({enabled: false, displayTokens: []})).enabled).toBe(false)
  await desktop.stopAll()
  expect(ready.mock.calls.every(([required]) => required === false)).toBe(true)
})
it('an explicit desktop enable requests the control package', async () => {
  const ready = vi.fn(async (_required: boolean) => undefined)
  const desktop = new ControlDesktop(dependencies() as any, ready)
  await expect(desktop.configureRemoteAccess(true)).rejects.toThrow('CONTROL_PROCESS_UNAVAILABLE')
  expect(ready).toHaveBeenCalledWith(true)
  await desktop.stopAll()
})
it.each([
  ['desktop.session.stop', {sessionId: randomUUID(), observedEpoch: 1, reason: 'user_ended'}],
  ['desktop.session.cancel', {startId: randomUUID(), reason: 'user_ended'}],
  ['desktop.session.get', {startId: randomUUID()}],
  ['desktop.control.release', {sessionId: randomUUID(), epoch: 1}]
] as const)('%s without an installed package neither downloads nor confirms cleanup', async (method, params) => {
  const ready = vi.fn(async (_required: boolean) => undefined)
  const desktop = new ControlDesktop(dependencies() as any, ready)
  const authority = {accountId: 'owner', deviceId: 'peer', authorizationId: 'grant', scopes: [], current: () => true, emit() {}}
  await expect(desktop.invoke(method, params, authority)).rejects.toThrow('CONTROL_PACKAGE_NOT_INSTALLED')
  expect(ready).toHaveBeenCalledOnce()
  expect(ready).toHaveBeenCalledWith(false)
  await desktop.stopAll()
})
