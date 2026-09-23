import { describe, expect, it, vi } from 'vitest'
import type { AppSessionOwner } from '../contracts/app-session-owner.js'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import {
  drainManagerAfterOwnerLoss,
  ownedManagerRuntimes,
  stopManagerAfterOwnerLoss
} from './manager-owner-channel.js'

const owner: AppSessionOwner = {
  ownerSessionId: 'gui-session',
  ownerKind: 'gui',
  ownerPid: process.pid,
  ownerStartedAt: new Date().toISOString(),
  ownerProcessIdentity: 'test-identity',
  generation: 1
}

const foreign: AppSessionOwner = { ...owner, ownerSessionId: 'foreign-session' }

function registration(input: {
  pid: number
  appOwner?: AppSessionOwner
  instanceId?: string
}): RuntimeRegistration {
  return {
    flavor: 'production',
    instanceId: input.instanceId ?? `runtime-${input.pid}`,
    pid: input.pid,
    startedAt: new Date().toISOString(),
    host: '127.0.0.1',
    port: 18900,
    baseUrl: 'http://127.0.0.1:18900',
    runtimeToken: 'token',
    ...(input.appOwner ? { appOwner: input.appOwner } : {})
  }
}

function handle(slots: RuntimeRegistration[]) {
  return {
    beginDrain: vi.fn(),
    close: vi.fn(async () => undefined),
    discovery: { appOwner: owner },
    state: {
      snapshot: () => slots.map((item) => ({
        registration: item,
        lastHeartbeatAt: new Date().toISOString()
      }))
    }
  }
}

describe('manager owner-loss drain', () => {
  it('ignores Runtime slots that belong to a different application owner', () => {
    const foreignRuntime = registration({ pid: process.pid, appOwner: foreign })
    expect(ownedManagerRuntimes(handle([foreignRuntime]))).toEqual([])
  })

  it('does not wait on a foreign live Runtime during owner-loss drain', async () => {
    const foreignRuntime = registration({ pid: process.pid, appOwner: foreign })
    await expect(drainManagerAfterOwnerLoss(handle([foreignRuntime]), {
      deadlineMs: 50,
      fetchImpl: (async () => { throw new Error('should not shutdown a foreign runtime') }) as typeof fetch
    })).resolves.toBeUndefined()
  })

  it('still waits for foreign live Runtimes on a requested all-consumer drain', async () => {
    const foreignRuntime = registration({ pid: process.pid, appOwner: foreign })
    await expect(drainManagerAfterOwnerLoss(handle([foreignRuntime]), {
      deadlineMs: 40,
      wait: 'all',
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch
    })).rejects.toThrow(/Owned Runtime remained alive/)
  })

  it('times out only on owned live Runtimes', async () => {
    const ownedRuntime = registration({ pid: process.pid, appOwner: owner })
    await expect(drainManagerAfterOwnerLoss(handle([ownedRuntime]), {
      deadlineMs: 40,
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch
    })).rejects.toThrow(/Owned Runtime remained alive/)
  })

  it('still closes and unpublishes when owned drain times out', async () => {
    const ownedRuntime = registration({ pid: process.pid, appOwner: owner })
    const manager = handle([ownedRuntime])
    await stopManagerAfterOwnerLoss(manager, {
      deadlineMs: 40,
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch
    })
    expect(manager.close).toHaveBeenCalledOnce()
  })
})
