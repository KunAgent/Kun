import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createThreadRecord } from '../domain/thread.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createWriteLocalTool } from '../adapters/tool/builtin-file-tools.js'
import { applyRoomToolPolicy } from './room-turn-policy.js'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('room task file boundary', () => {
  it('writes inside the task and rejects source checkout and symlink escapes even after approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-room-file-'))
    temporary.push(root)
    const taskRoot = join(root, 'task')
    const sourceRoot = join(root, 'source')
    await Promise.all([mkdir(taskRoot), mkdir(sourceRoot)])
    await writeFile(join(sourceRoot, 'user.txt'), 'user dirty\n')
    await symlink(sourceRoot, join(taskRoot, 'outside'), 'dir')
    const thread = createThreadRecord({ id: 'task_thread', title: 'Room task', workspace: taskRoot,
      model: 'test', sandboxMode: 'workspace-write', approvalPolicy: 'always', roomContext: {
        roomId: 'room_one', memberId: 'member_one', taskId: 'task_one', kind: 'execution',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: []
      } })
    const context = applyRoomToolPolicy({ threadId: thread.id, turnId: 'turn_one', workspace: taskRoot,
      additionalWorkspaces: [sourceRoot], sandboxMode: 'danger-full-access', approvalPolicy: 'auto',
      abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }, thread)
    const host = new LocalToolHost({ tools: [createWriteLocalTool()] })
    const safe = await host.execute({ callId: 'safe', toolName: 'write',
      arguments: { path: 'result.txt', content: 'task work\n' } }, context)
    expect(safe.item.kind === 'tool_result' && safe.item.isError).not.toBe(true)
    expect(await readFile(join(taskRoot, 'result.txt'), 'utf8')).toBe('task work\n')
    for (const [index, path] of [join(sourceRoot, 'user.txt'), 'outside/user.txt'].entries()) {
      const denied = await host.execute({ callId: `escape_${index}`, toolName: 'write',
        arguments: { path, content: 'overwritten' } }, context)
      expect(denied.item.kind === 'tool_result' && denied.item.isError).toBe(true)
    }
    expect(await readFile(join(sourceRoot, 'user.txt'), 'utf8')).toBe('user dirty\n')
    const review = applyRoomToolPolicy(context, { ...thread, roomContext: { ...thread.roomContext!, kind: 'review' } })
    expect(await host.listTools(review)).toEqual([])
    await expect(host.execute({ callId: 'review_write', toolName: 'write',
      arguments: { path: 'result.txt', content: 'review must not write' } }, review)).rejects.toThrow('active tool policy')
    expect(await readFile(join(taskRoot, 'result.txt'), 'utf8')).toBe('task work\n')
  })
})
