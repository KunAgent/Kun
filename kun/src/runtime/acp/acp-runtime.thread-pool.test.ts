import { spawn } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import type { AcpSpawnFn } from './acp-process.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

it('isolates single-session ACP connections by thread while continuing later turns on the live session', async () => {
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  const spawnAgent = vi.fn<AcpSpawnFn>(async (command, args, options) => spawn(command, [...args], {
    env: options.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe']
  }))
  try {
    const first = await makeHarness('resume.json', { definition: { poolScope: 'thread' },
      deps: { connectionPool: pool, spawn: spawnAgent } })
    const second = await makeHarness('resume.json', {
      definition: { poolScope: 'thread', launch: first.definition.launch },
      thread: { id: 'thread_2', workspace: first.workspace },
      items: [{ id: 'second-user', threadId: 'thread_2', turnId: 'turn_1', role: 'user', kind: 'user_message',
        status: 'completed', text: 'another thread', createdAt: '2026-01-01T00:00:00.000Z' } as TurnItem],
      deps: { connectionPool: pool, spawn: spawnAgent }
    })
    expect(await Promise.all([
      first.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal),
      second.runtime.runTurn('thread_2', 'turn_1', new AbortController().signal)
    ])).toEqual(['completed', 'completed'])
    expect(spawnAgent).toHaveBeenCalledTimes(2)
    expect(first.requests('initialize')).toHaveLength(2)
    expect(first.requests('session/new')).toHaveLength(2)

    first.thread.turns.push({ id: 'turn_2', harnessId: first.definition.id })
    first.items.push({ id: 'continued-user', threadId: 'thread_1', turnId: 'turn_2', role: 'user',
      kind: 'user_message', status: 'completed', text: 'continue the first thread',
      createdAt: '2026-01-01T00:01:00.000Z' } as TurnItem)
    expect(await first.runtime.runTurn('thread_1', 'turn_2', new AbortController().signal)).toBe('completed')
    expect(spawnAgent).toHaveBeenCalledTimes(2)
    expect(first.requests('session/new')).toHaveLength(2)
    expect(first.requests('session/load')).toHaveLength(0)
    expect(first.requests('session/prompt')).toHaveLength(3)
    expect(first.recorded.filter((event) => event.kind === 'delegated_runtime').at(-1)).toMatchObject({
      phase: 'resumed', capabilitiesV2: { statuses: { nativeResume: { supported: true } } }
    })
    expect(first.deltas.map((delta) => delta.delta).join('')).toContain('second reply')
  } finally { await pool.dispose() }
})
