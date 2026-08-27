import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManagerDataMutex } from './data-mutex.js'

const BASE_URL = 'http://127.0.0.1:19001'

function stubManagerEnv(): void {
  vi.stubEnv('KUN_MANAGER_BASE_URL', BASE_URL)
  vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-token')
  vi.stubEnv('KUN_RUNTIME_INSTANCE_ID', 'runtime-1')
  vi.stubEnv('KUN_RUNTIME_FLAVOR', 'production')
}

describe('withManagerDataMutex', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('runs the operation while token-conditional renewals keep the lease alive', async () => {
    vi.useFakeTimers()
    stubManagerEnv()
    const calls: string[] = []
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      calls.push(operation)
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew') return renewResponse()
      if (operation === 'release') return releaseResponse()
      if (operation === 'validate') return validResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const result = await withManagerDataMutex('retention', async ({ signal, fence }) => {
      expect(signal.aborted).toBe(false)
      expect(fence?.fencingToken).toBe(1)
      await vi.advanceTimersByTimeAsync(7_000)
      return 'done'
    })

    expect(result).toBe('done')
    expect(calls.filter((call) => call === 'renew').length).toBeGreaterThan(1)
    expect(calls).toContain('release')
  })

  it('aborts at the deadline but waits for operation cleanup before release and rejection', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubManagerEnv()
    let releaseCalled = false
    let signalAborted = false
    let finishCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve })
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew') throw new Error('manager unreachable')
      if (operation === 'release') {
        releaseCalled = true
        return releaseResponse()
      }
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const promise = withManagerDataMutex('retention', async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
        signalAborted = true
        resolve()
      }, { once: true }))
      await cleanup
      return 'too late'
    })
    let settled = false
    void promise.finally(() => { settled = true }).catch(() => undefined)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(signalAborted).toBe(true)
    expect(settled).toBe(false)
    expect(releaseCalled).toBe(false)

    finishCleanup()
    await expect(promise).rejects.toThrow('shared data resource lease expired: retention')
    expect(releaseCalled).toBe(true)
  })

  it('tolerates a transient renewal failure within the lease TTL', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubManagerEnv()
    let renewCalls = 0
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew') {
        renewCalls += 1
        if (renewCalls === 1) throw new Error('temporary manager 502')
        return renewResponse()
      }
      if (operation === 'release') return releaseResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const result = await withManagerDataMutex('retention', async () => {
      await vi.advanceTimersByTimeAsync(7_000)
      return 'done'
    })

    expect(result).toBe('done')
    expect(warn).toHaveBeenCalled()
  })

  it('aborts as soon as token-conditional renewal reports takeover', async () => {
    vi.useFakeTimers()
    stubManagerEnv()
    let aborted = false
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew') return staleResponse()
      if (operation === 'release') return releaseResponse(false)
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const promise = withManagerDataMutex('retention', async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
        aborted = true
        resolve()
      }, { once: true }))
    })

    const assertion = expect(promise).rejects.toThrow(
      'shared data resource lease was lost: retention'
    )
    await vi.advanceTimersByTimeAsync(3_000)
    await assertion
    expect(aborted).toBe(true)
  })

  it('expires a commit reservation even when a later lease renewal succeeds', async () => {
    vi.useFakeTimers()
    stubManagerEnv()
    let aborted = false
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire' || operation === 'renew') return acquireResponse(true)
      if (operation === 'commit-begin') return commitResponse(4)
      if (operation === 'commit-renew') throw new Error('manager unreachable')
      if (operation === 'commit-end' || operation === 'release') return releaseResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const promise = withManagerDataMutex('reservation', async ({ signal, withCommit }) => {
      await withCommit(async () => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true }))
      })
    })

    const assertion = expect(promise).rejects.toThrow(
      'shared data resource commit reservation expired: reservation'
    )
    await vi.advanceTimersByTimeAsync(4_000)
    await assertion
    expect(aborted).toBe(true)
  })

  it('does not let a later commit deadline delay lease expiry', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubManagerEnv()
    let aborted = false
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew' || operation === 'commit-renew') {
        throw new Error('manager unreachable')
      }
      if (operation === 'commit-begin') return commitResponse(20)
      if (operation === 'commit-end' || operation === 'release') return releaseResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const promise = withManagerDataMutex('earliest', async ({ signal, withCommit }) => {
      await withCommit(async () => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true }))
      })
    })

    const assertion = expect(promise).rejects.toThrow('shared data resource lease expired: earliest')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(aborted).toBe(true)
  })

  it('returns after a bounded abort grace period when an operation ignores its signal', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stubManagerEnv()
    let releaseCalled = false
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'renew') throw new Error('manager unreachable')
      if (operation === 'release') {
        releaseCalled = true
        return releaseResponse()
      }
      throw new Error(`unexpected operation: ${operation}`)
    }))

    const promise = withManagerDataMutex('bounded', async () => new Promise<never>(() => undefined))
    const assertion = expect(promise).rejects.toThrow('shared data resource lease expired: bounded')
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(releaseCalled).toBe(true)
  })

  it('serializes concurrent same-resource operations before acquiring the Manager lease', async () => {
    stubManagerEnv()
    let acquireCalls = 0
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      if (operation === 'acquire') {
        acquireCalls += 1
        return acquireResponse(true)
      }
      if (operation === 'release') return releaseResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))
    let finishFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { finishFirst = resolve })
    const order: string[] = []
    const first = withManagerDataMutex('serialized', async () => {
      order.push('first-start')
      await firstGate
      order.push('first-end')
    })
    const second = withManagerDataMutex('serialized', async () => {
      order.push('second-start')
    })
    await vi.waitFor(() => expect(order).toEqual(['first-start']))
    expect(acquireCalls).toBe(1)

    finishFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    expect(acquireCalls).toBe(2)
  })

  it('reuses the active context for nested locks on the same resource', async () => {
    stubManagerEnv()
    const calls: string[] = []
    vi.stubGlobal('fetch', managerFetch(async (operation) => {
      calls.push(operation)
      if (operation === 'acquire') return acquireResponse(true)
      if (operation === 'release') return releaseResponse()
      throw new Error(`unexpected operation: ${operation}`)
    }))

    await withManagerDataMutex('nested', async (outer) => {
      await withManagerDataMutex('nested', async (inner) => {
        expect(inner.fence).toEqual(outer.fence)
      })
    })
    expect(calls.filter((call) => call === 'acquire')).toHaveLength(1)
    expect(calls.filter((call) => call === 'release')).toHaveLength(1)
  })

  it('uses a no-op fence when Manager identity is unavailable', async () => {
    const result = await withManagerDataMutex('local', async (context) => {
      expect(context.signal.aborted).toBe(false)
      expect(context.fence).toBeUndefined()
      await context.assertCurrent()
      return 'done'
    })
    expect(result).toBe('done')
  })
})

function managerFetch(
  respond: (operation: string, body: Record<string, unknown>) => Promise<Response>
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const suffix = url.split('/').at(-1) ?? ''
    const operation = url.includes('/commits/') ? `commit-${suffix}` : suffix
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    if (operation !== 'acquire') expect(body.fencingToken).toBe(1)
    return respond(operation, body)
  })
}

function lease(ttlSeconds = 10) {
  const now = Date.now()
  return {
    resource: 'data:test',
    ownerFlavor: 'production',
    ownerInstanceId: 'runtime-1',
    fencingToken: 1,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString()
  }
}

function acquireResponse(acquired: boolean): Response {
  return jsonResponse({ acquired, lease: lease() })
}

function renewResponse(): Response {
  return jsonResponse({ lease: lease() })
}

function commitResponse(ttlSeconds: number): Response {
  return jsonResponse({
    lease: { ...lease(), commitExpiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() }
  })
}

function validResponse(): Response {
  return jsonResponse({ valid: true })
}

function releaseResponse(released = true): Response {
  return jsonResponse({ released })
}

function staleResponse(): Response {
  return jsonResponse({ code: 'resource_fence_stale' }, 409)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
