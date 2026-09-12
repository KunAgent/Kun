import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem, makeUserItem } from '../domain/item.js'
import type { RoomStoreCommit } from './room-store.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { captureRoomVerification } from './room-verification.js'

function fixture() {
  const sessions = new InMemorySessionStore()
  const commit = vi.fn(async (input: RoomStoreCommit) => ({ duplicate: false, events: [], result: input.result }))
  const deps = { sessions, store: { commit } } as unknown as RoomRuntimeDeps
  const identity = { threadId: 'thread', turnId: 'turn' }
  const append = (item: Parameters<typeof sessions.appendItem>[1]) => sessions.appendItem('thread', item)
  const run = async (id: string, name: string, args: Record<string, unknown>, output: unknown,
    kind: 'tool_call' | 'command_execution' | 'file_change' = 'command_execution', isError = false) => {
    await append(makeToolCallItem({ id: id + '-call', ...identity, callId: id, toolName: name, toolKind: kind, arguments: args }))
    await append(makeToolResultItem({ id: id + '-result', ...identity, callId: id, toolName: name, toolKind: kind, output, isError }))
  }
  const declare = (checks: Array<{ id: string; command: string; cwd?: string; purpose?: string }>) =>
    run('declare', 'declare_room_checks', { checks }, { accepted: true, value: { checks } }, 'tool_call')
  const capture = () => captureRoomVerification(deps, { ...identity, roomId: 'room', taskId: 'task', workspace: '/workspace', deliveryId: 'delivery' })
  return { sessions, commit, append, identity, run, declare, capture }
}

describe('declared Rooms verification evidence', () => {
  it('finds declared command evidence beyond 1000 history items using every page without loading the full log', async () => {
    const f = fixture()
    await f.declare([{ id: 'unit', command: 'npm test', cwd: './package', purpose: 'Verify empty input' }])
    await f.run('validation', 'bash', { command: 'npm test', workdir: '/workspace/package' }, { exit_code: 0 })
    await f.append(makeUserItem({ id: 'steering', ...f.identity, text: 'Also consider the second edge case.' }))
    for (let i = 0; i < 1100; i += 1) await f.append(makeAssistantTextItem({ id: 'text-' + i, ...f.identity,
      text: 'tests pass (prose alone is not evidence)', status: 'completed' }))
    vi.spyOn(f.sessions, 'loadItems').mockRejectedValue(new Error('full history read forbidden'))
    const page = vi.spyOn(f.sessions, 'loadItemPage')
    const result = await f.capture()
    expect(result).toMatchObject({ status: 'passed', incomplete: [], verification: [{ command: 'npm test', cwd: '/workspace/package', exitCode: 0 }] })
    expect(page.mock.calls.length).toBeGreaterThan(5)
    expect(f.commit.mock.calls[0][0]).toMatchObject({ puts: [{ value: { check: { purpose: 'Verify empty input' },
      attempts: [{ callId: 'validation', resultId: 'validation-result' }] } }] })
  })

  it('does not infer checks from command words, late declarations, failed declarations or a different cwd', async () => {
    const f = fixture()
    await f.run('prose-test', 'bash', { command: 'echo tests passed' }, { exit_code: 0 })
    await f.run('too-early', 'bash', { command: 'npm test' }, { exit_code: 0 })
    await f.declare([{ id: 'unit', command: 'npm test' }])
    await f.run('wrong-cwd', 'bash', { command: 'npm test', cwd: '/different' }, { exit_code: 0 })
    const result = await f.capture()
    expect(result.status).toBe('not_run')
    expect(result.verification).toEqual([])
    expect(result.incomplete.join(' ')).toContain('no confirmed completed execution')
  })

  it('matches background polling to the originating command and uses its real final exit', async () => {
    const f = fixture()
    await f.declare([{ id: 'unit', command: 'npm test' }])
    await f.run('background', 'bash', { command: 'npm test', background: true }, { session_id: '1234abcd', status: 'running', exit_code: null })
    await f.run('unrelated', 'background_shell', { action: 'poll', session_id: 'other123' }, { session_id: 'other123', status: 'completed', exit_code: 9 })
    await f.run('poll', 'background_shell', { action: 'poll', session_id: '1234abcd' }, {
      session_id: '1234abcd', status: 'completed', exit_code: 0, output_truncated: true, output_file: '/logs/test.log', finished_at: '2026-09-12T00:00:00.000Z' })
    const result = await f.capture()
    expect(result.status).toBe('passed')
    expect(result.activeBackground).toBe(false)
    expect(f.commit.mock.calls[0][0]).toMatchObject({ puts: [{ value: { attempts: [{ callId: 'background', resultId: 'poll-result',
      sessionId: '1234abcd', outputTruncated: true, outputFile: '/logs/test.log' }] } }] })
  })

  it('keeps failed attempts in the log while the latest rerun supplies the check status', async () => {
    const f = fixture()
    await f.declare([{ id: 'unit', command: 'npm test' }])
    await f.run('failed', 'bash', { command: 'npm test' }, { exit_code: 1 }, 'command_execution', true)
    await f.run('rerun', 'bash', { command: 'npm test' }, { exit_code: 0 })
    expect((await f.capture()).status).toBe('passed')
    expect(f.commit.mock.calls[0][0]).toMatchObject({ puts: [{ value: { attempts: [
      { callId: 'rerun', exitCode: 0 }, { callId: 'failed', exitCode: 1 }] } }] })
  })

  it('marks later file changes unverified and keeps unfinished commands from freezing a delivery', async () => {
    const f = fixture()
    await f.declare([{ id: 'unit', command: 'npm test' }])
    await f.run('unit', 'bash', { command: 'npm test' }, { exit_code: 0 })
    await f.run('edit', 'write', { path: 'source.ts', content: 'changed' }, 'saved', 'file_change')
    const changed = await f.capture()
    expect(changed.status).toBe('partial')
    expect(changed.incomplete.join(' ')).toContain('files changed after validation')
    await f.run('writer', 'bash', { command: 'background writer', background: true }, { session_id: 'writer01', status: 'running', exit_code: null })
    const result = await f.capture()
    expect(result.activeBackground).toBe(true)
    expect(result.status).toBe('not_run')
    expect(result.incomplete.join(' ')).toContain('background command is still running')
  })
})

describe('Rooms durable event evidence', () => {
  it('recovers exact checks after item compaction and consumes the actual background completion event', async () => {
    const f = fixture()
    await f.declare([{ id: 'unit', command: 'npm test', purpose: 'Regression' }])
    await f.run('background', 'bash', { command: 'npm test', background: true }, { session_id: 'abcd1234', status: 'running', exit_code: null })
    const items = await f.sessions.loadItems('thread')
    for (let i = 0; i < items.length; i += 1) await f.sessions.appendEvent('thread', {
      kind: 'item_completed', threadId: 'thread', turnId: 'turn', seq: i + 1,
      timestamp: '2026-09-12T00:00:00.000Z', item: items[i]
    })
    await f.sessions.appendEvent('thread', { kind: 'bash_session_completed', threadId: 'thread', turnId: 'turn', seq: 5,
      timestamp: '2026-09-12T00:00:01.000Z', sessionId: 'abcd1234', command: 'npm test', cwd: '/workspace', shell: 'zsh',
      status: 'completed', startedAt: '2026-09-12T00:00:00.000Z', finishedAt: '2026-09-12T00:00:01.000Z',
      exitCode: 0, detached: true, output: 'All checks pass', outputTruncated: false })
    await f.sessions.rewriteItems('thread', [makeAssistantTextItem({ id: 'summary', ...f.identity, text: 'Compacted history', status: 'completed' })])
    const result = await f.capture()
    expect(result).toMatchObject({ status: 'passed', activeBackground: false, verification: [{ command: 'npm test', exitCode: 0 }] })
    expect(f.commit.mock.calls[0][0]).toMatchObject({ puts: [{ value: { attempts: [{ callId: 'background', eventSeq: 5 }] } }] })
  })
})
