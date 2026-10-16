import { remoteFixture } from '../testing/runtime.test-support.js'
import { SharedTaskFacade } from './guest.js'
import { localCaller } from '../runtime/local-call.js'
import type { ShareActor } from './contracts.js'
export async function shareFixture() {
  const f = await remoteFixture(), task = await f.code('Shared task'), other = await f.code('Unshared task')
  const facade = new SharedTaskFacade(f.runtime, localCaller(f.router, f.runtime)), journal = facade.journal
  const owner = { ownerAccountId: 'owner', hostDeviceId: 'host', controllerId: 'ownerphone' }
  const prepared = await journal.prepare(owner, 'share_create', { action: 'create', threadId: task.id })
  const share = { id: 'share', ownerAccountId: owner.ownerAccountId, hostDeviceId: owner.hostDeviceId,
    resourceHandle: prepared.receipt.resourceHandle!, version: 1, state: 'active' as const, expiresAt: Date.now() + 86400000 }
  await journal.settle(owner, 'share_create', { share, secret: 'must-not-persist' })
  const actor: ShareActor = { ownerAccountId: 'owner', hostDeviceId: 'host', shareId: share.id,
    resourceHandle: share.resourceHandle, shareVersion: 1, guestAccountId: 'guest', deviceId: 'guestphone',
    memberId: 'member', memberVersion: 1, mode: 'write', expiresAt: Date.now() + 59000, sessionId: 'connection' }
  await journal.admit(actor)
  let sequence = 0
  const call = (method: string, params: Record<string, unknown>, requestId = 'guest_' + ++sequence) => ({ method, params, requestId, expiresAt: Date.now() + 60000 })
  return { ...f, task, other, facade, journal, owner, share, actor, call,
    invoke: (method: string, params: Record<string, unknown>, requestId?: string) => facade.execute(actor, call(method, params, requestId)) as Promise<any> }
}
