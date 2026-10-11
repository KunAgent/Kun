import { mkdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

// Explicit opt-in: uses the developer's installed Devin account in an empty temporary workspace.
it.skipIf(process.env.KUN_DEVIN_LIVE_SMOKE !== '1')('streams a resumed Devin tool turn through the Kun runtime', async () => {
  const definition = BUILTIN_HARNESSES.find((entry) => entry.id === 'devin')!
  const user = (turnId: string, text: string): TurnItem => ({ id: `user_${turnId}`, threadId: 'thread_1', turnId,
    role: 'user', kind: 'user_message', status: 'completed', createdAt: new Date().toISOString(), text })
  const h = await makeHarness('basic-chat.json', { definition,
    deps: { harnessDefaults: () => ({ permissionMode: 'bypass' }) },
    turn: { harnessId: 'devin', approvalPolicy: 'auto', sandboxMode: 'danger-full-access' },
    thread: { harnessId: 'devin' },
    items: [user('turn_1', 'Reply with exactly OK. Do not use tools.')]
  })
  await mkdir(h.workspace, { recursive: true })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', AbortSignal.timeout(45_000)), JSON.stringify(h.finished)).toBe('completed')
  const before = h.deltas.length
  h.thread.turns.push({ id: 'turn_2', harnessId: 'devin', status: 'running',
    approvalPolicy: 'auto', sandboxMode: 'danger-full-access' })
  h.items.push(user('turn_2', "Run exactly printf 'KUN_DEVIN_TERMINAL_OK' once using your terminal tool, then reply DONE. Do not inspect files or run any other commands."))
  expect(await h.runtime.runTurn('thread_1', 'turn_2', AbortSignal.timeout(45_000)), JSON.stringify(h.finished)).toBe('completed')
  expect(h.applied.some((item) => item.turnId === 'turn_2' && item.kind === 'tool_call')).toBe(true)
  expect(h.applied.some((item) => item.turnId === 'turn_2' && item.kind === 'tool_result' &&
    item.status === 'completed' && !item.isError)).toBe(true)
  expect(h.deltas.length).toBeGreaterThan(before)
  expect(h.deltas.slice(before).map((entry) => entry.delta).join('')).toContain('DONE')
}, 100_000)
