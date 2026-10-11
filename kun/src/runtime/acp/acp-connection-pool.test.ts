import { describe, expect, it, vi } from 'vitest'
import { AcpConnectionPool } from './acp-connection-pool.js'
import type { AcpConnection } from './acp-connection.js'

function fakeConn(threadIds: string[] = []): {
  conn: AcpConnection
  closed: () => boolean
} {
  let closed = false
  const conn = {
    identity: 'cred-1',
    get closed() {
      return closed
    },
    sessionThreadIds: () => threadIds,
    onExit: () => undefined,
    close: () => {
      closed = true
      return Promise.resolve()
    }
  } as unknown as AcpConnection
  return { conn, closed: () => closed }
}

async function acquire(pool: AcpConnectionPool, key: string, conn: AcpConnection) {
  return pool.acquire(key, () => Promise.resolve(conn))
}

describe('AcpConnectionPool.releaseForUnit', () => {
  it('closes the connection hosting the unit once its lease is idle', async () => {
    const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
    const { conn, closed } = fakeConn(['thread-w1'])
    const lease = await acquire(pool, 'acp-1', conn)
    lease.release()
    pool.releaseForUnit('thread-w1')
    expect(closed()).toBe(true)
  })

  it('leaves a live-leased connection alone', async () => {
    const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
    const { conn, closed } = fakeConn(['thread-w1'])
    const lease = await acquire(pool, 'acp-1', conn)
    pool.releaseForUnit('thread-w1')
    expect(closed()).toBe(false)
    lease.release()
  })

  it('does not touch connections that host no session for the unit', async () => {
    const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
    const { conn, closed } = fakeConn(['thread-other'])
    const lease = await acquire(pool, 'acp-1', conn)
    lease.release()
    pool.releaseForUnit('thread-w1')
    expect(closed()).toBe(false)
  })

  it('keeps a shared connection alive while a sibling session still leases it', async () => {
    const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
    const { conn, closed } = fakeConn(['thread-w1', 'thread-w2'])
    const first = await acquire(pool, 'acp-1', conn)
    const second = await acquire(pool, 'acp-1', conn)
    first.release()
    pool.releaseForUnit('thread-w1')
    expect(closed()).toBe(false)
    second.release()
  })

  it('rebuilds the connection on the next acquire after release', async () => {
    const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
    const { conn, closed } = fakeConn(['thread-w1'])
    const lease = await acquire(pool, 'acp-1', conn)
    lease.release()
    pool.releaseForUnit('thread-w1')
    expect(closed()).toBe(true)
    const next = fakeConn(['thread-w1'])
    const lease2 = await acquire(pool, 'acp-1', next.conn)
    expect(lease2.connection).toBe(next.conn)
    lease2.release()
    await pool.dispose()
  })
})
