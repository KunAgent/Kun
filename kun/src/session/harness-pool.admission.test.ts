import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessAgentPool, type PooledAgent } from './harness-pool.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function agent() {
  let closed = false
  return {
    get closed() { return closed },
    close: vi.fn(async () => { closed = true }),
    onExit: vi.fn(),
    sessionThreadIds: () => []
  } satisfies PooledAgent
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason })
  )
}

// Flush promise continuations without a timing-dependent sleep or polling loop.
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('HarnessAgentPool admission races', () => {
  const pools: HarnessAgentPool<PooledAgent>[] = []

  function createPool() {
    const pool = new HarnessAgentPool<PooledAgent>({ idleReleaseMs: 60_000 })
    pools.push(pool)
    return pool
  }

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.dispose()))
  })

  it.each(['resolves', 'rejects'] as const)(
    'rejects a newly disabled waiter after the preceding factory %s',
    async (precedingResult) => {
      const pool = createPool()
      const original = agent()
      const connected = deferred<PooledAgent>()
      const started = deferred<void>()
      const first = outcome(pool.acquire('codex:account', async () => {
        started.resolve(undefined)
        return connected.promise
      }))
      await started.promise

      let enabled = true
      const disabled = new Error('agent disabled')
      const validate = vi.fn(async () => {
        if (!enabled) throw disabled
      })
      const waitingFactory = vi.fn(async () => agent())
      const waiting = outcome(pool.acquire('codex:account', waitingFactory, { validate }))
      await nextTurn()
      expect(validate).not.toHaveBeenCalled()
      expect(waitingFactory).not.toHaveBeenCalled()

      enabled = false
      const connectFailure = new Error('connection failed')
      if (precedingResult === 'resolves') connected.resolve(original)
      else connected.reject(connectFailure)

      expect(await waiting).toEqual({ status: 'rejected', reason: disabled })
      expect(validate).toHaveBeenCalledTimes(1)
      expect(waitingFactory).not.toHaveBeenCalled()
      expect(original.close).not.toHaveBeenCalled()

      const firstResult = await first
      if (precedingResult === 'resolves') {
        expect(firstResult.status).toBe('fulfilled')
        if (firstResult.status === 'fulfilled') firstResult.value.release()
      } else {
        expect(firstResult).toEqual({ status: 'rejected', reason: connectFailure })
      }
    }
  )

  it.each(['resolves', 'rejects'] as const)(
    'cancels a waiter promptly and never retries after the preceding factory %s',
    async (precedingResult) => {
      const pool = createPool()
      const original = agent()
      const connected = deferred<PooledAgent>()
      const started = deferred<void>()
      const first = outcome(pool.acquire('codex:account', async () => {
        started.resolve(undefined)
        return connected.promise
      }))
      await started.promise

      const controller = new AbortController()
      const cancelled = new Error('acquisition cancelled')
      const validate = vi.fn(async () => undefined)
      const waitingFactory = vi.fn(async () => agent())
      let waitingSettled = false
      const waiting = outcome(pool.acquire('codex:account', waitingFactory, {
        signal: controller.signal,
        validate
      })).then((result) => {
        waitingSettled = true
        return result
      })

      controller.abort(cancelled)
      await nextTurn()
      const settledBeforeConnect = waitingSettled
      // Always unblock the original acquisition, even if prompt abort regresses.
      if (precedingResult === 'resolves') connected.resolve(original)
      else connected.reject(new Error('connection failed'))
      const firstResult = await first
      expect(await waiting).toEqual({ status: 'rejected', reason: cancelled })
      await nextTurn()

      expect(settledBeforeConnect).toBe(true)
      expect(validate).not.toHaveBeenCalled()
      expect(waitingFactory).not.toHaveBeenCalled()
      expect(original.close).not.toHaveBeenCalled()
      if (firstResult.status === 'fulfilled') firstResult.value.release()

      const replacement = agent()
      const freshFactory = vi.fn(async () => replacement)
      const fresh = await pool.acquire('codex:account', freshFactory)
      expect(fresh.agent).toBe(precedingResult === 'resolves' ? original : replacement)
      expect(freshFactory).toHaveBeenCalledTimes(precedingResult === 'resolves' ? 0 : 1)
      fresh.release()
    }
  )

  it.each(['disabled', 'cancelled'] as const)(
    'closes an unpublished process when admission becomes %s during its own factory',
    async (change) => {
      const pool = createPool()
      const unused = agent()
      const connected = deferred<PooledAgent>()
      const started = deferred<void>()
      const controller = new AbortController()
      let enabled = true
      const denied = new Error(`agent ${change}`)
      const validate = vi.fn(async () => {
        if (!enabled) throw denied
      })
      const acquired = outcome(pool.acquire('codex:account', async () => {
        started.resolve(undefined)
        return connected.promise
      }, { signal: controller.signal, validate }))
      await started.promise
      expect(validate).toHaveBeenCalledTimes(1)

      if (change === 'disabled') enabled = false
      else controller.abort(denied)
      connected.resolve(unused)

      expect(await acquired).toEqual({ status: 'rejected', reason: denied })
      expect(unused.close).toHaveBeenCalledTimes(1)
      expect(unused.onExit).not.toHaveBeenCalled()

      enabled = true
      const replacement = agent()
      const replacementFactory = vi.fn(async () => replacement)
      const fresh = await pool.acquire('codex:account', replacementFactory, { validate })
      expect(fresh.agent).toBe(replacement)
      expect(replacementFactory).toHaveBeenCalledTimes(1)
      expect(unused.close).toHaveBeenCalledTimes(1)
      fresh.release()
    }
  )

  it('still shares a valid process after pending admission and idle reuse', async () => {
    const pool = createPool()
    const original = agent()
    const connected = deferred<PooledAgent>()
    const started = deferred<void>()
    const firstValidate = vi.fn(async () => undefined)
    const first = pool.acquire('codex:account', async () => {
      started.resolve(undefined)
      return connected.promise
    }, { validate: firstValidate })
    await started.promise

    const reuseValidate = vi.fn(async () => undefined)
    const reuseFactory = vi.fn(async () => agent())
    const second = pool.acquire('codex:account', reuseFactory, { validate: reuseValidate })
    await nextTurn()
    expect(reuseValidate).not.toHaveBeenCalled()
    connected.resolve(original)

    const [firstLease, secondLease] = await Promise.all([first, second])
    expect(firstLease.agent).toBe(original)
    expect(secondLease.agent).toBe(original)
    expect(firstValidate).toHaveBeenCalledTimes(2)
    expect(reuseValidate).toHaveBeenCalledTimes(1)
    expect(reuseFactory).not.toHaveBeenCalled()
    firstLease.release()
    expect(original.close).not.toHaveBeenCalled()
    secondLease.release()

    const idleLease = await pool.acquire('codex:account', reuseFactory, { validate: reuseValidate })
    expect(idleLease.agent).toBe(original)
    expect(reuseValidate).toHaveBeenCalledTimes(2)
    expect(reuseFactory).not.toHaveBeenCalled()
    expect(original.close).not.toHaveBeenCalled()
    idleLease.release()
  })
})
