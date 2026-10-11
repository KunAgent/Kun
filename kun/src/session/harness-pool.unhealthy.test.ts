import { describe, expect, it, vi } from 'vitest'
import { HarnessAgentPool, type PooledAgent } from './harness-pool.js'

function agent(): PooledAgent & { close: ReturnType<typeof vi.fn> } {
  return {
    closed: false,
    close: vi.fn(async () => undefined),
    onExit: () => undefined,
    sessionThreadIds: () => []
  }
}

describe('HarnessAgentPool unhealthy process handling', () => {
  it('keeps active sibling leases alive and blocks reuse until both release', async () => {
    const pool = new HarnessAgentPool<PooledAgent>({ idleReleaseMs: 60_000 })
    const original = agent()
    const first = await pool.acquire('codex:account', async () => original)
    const sibling = await pool.acquire('codex:account', async () => original)
    pool.markUnhealthy('codex:account')
    expect(original.close).not.toHaveBeenCalled()
    await expect(pool.acquire('codex:account', async () => agent()))
      .rejects.toThrow('draining')
    first.release()
    expect(original.close).not.toHaveBeenCalled()
    sibling.release()
    await vi.waitFor(() => expect(original.close).toHaveBeenCalledTimes(1))
    await pool.dispose()
  })

  it('closes an exclusive unhealthy process immediately', async () => {
    const pool = new HarnessAgentPool<PooledAgent>()
    const original = agent()
    const lease = await pool.acquire('codex:account', async () => original)
    pool.markUnhealthy('codex:account')
    await vi.waitFor(() => expect(original.close).toHaveBeenCalledTimes(1))
    lease.release()
  })
})
