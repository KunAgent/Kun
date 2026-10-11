import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import { resolveRoomContent } from '../rooms/room-content-service.js'
import { bindImMessageService, roomImMessageTool } from '../rooms/room-im-message-tool.js'
import { resolveBotReferences } from './references.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options)
  open.push(value)
  return value
}
async function workspace(f: WorkbenchFixture) {
  const root = await f.makeDirectory('work')
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes/plan.md'), '# Plan\nship it')
  await f.bridge.directory.set({ workRoots: [root], defaultWorkRoot: root, codeProjects: [] })
  return root
}

describe('bot references', () => {
  it('cites Code sessions and Work documents the Agent may see, and nothing else', async () => {
    const f = await fixture({ policy: { work: 'read' } })
    const root = await workspace(f)
    const project = await f.makeDirectory('project')
    f.addCodeThread('t1', project)
    const references = await resolveBotReferences(f.deps.threadStore, 'agent-1', [
      { kind: 'code_thread', threadId: 't1' }, { kind: 'work_document', workspaceRoot: root, relativePath: 'notes/plan.md' }])
    expect(references).toEqual([{ kind: 'code_thread', threadId: 't1', titleSnapshot: 'Session t1' },
      { kind: 'work_document', workspaceRoot: root, relativePath: 'notes/plan.md', titleSnapshot: 'plan.md' }])
    // A subdirectory of a registered workspace is normalized back to the workspace.
    expect((await resolveBotReferences(f.deps.threadStore, 'agent-1', [
      { kind: 'work_document', workspaceRoot: join(root, 'notes'), relativePath: 'plan.md' }]))[0])
      .toMatchObject({ workspaceRoot: root, relativePath: 'notes/plan.md' })
    await expect(resolveBotReferences(f.deps.threadStore, 'agent-1', [{ kind: 'code_thread', threadId: 'missing' }])).rejects.toThrow('not found')
    await expect(resolveBotReferences(f.deps.threadStore, 'agent-1', [
      { kind: 'work_document', workspaceRoot: root, relativePath: 'notes/missing.md' }])).rejects.toThrow()
    await expect(resolveBotReferences(f.deps.threadStore, 'agent-1', [
      { kind: 'work_document', workspaceRoot: project, relativePath: 'x.md' }])).rejects.toThrow('not a Work workspace')
  })

  it('respects the policy and the room-owned boundary', async () => {
    const f = await fixture({ policy: { code: 'off', work: 'off' } })
    const project = await f.makeDirectory('project')
    f.addCodeThread('t1', project)
    await expect(resolveBotReferences(f.deps.threadStore, 'agent-1', [{ kind: 'code_thread', threadId: 't1' }])).rejects.toThrow('turned off')
    const open = await fixture()
    open.stub.threads.set('room-thread', { ...open.thread, roomContext: open.thread.roomContext })
    await expect(resolveBotReferences(open.deps.threadStore, 'agent-1', [{ kind: 'code_thread', threadId: 'room-thread' }])).rejects.toThrow('not found')
  })

  it('lets send_im_message publish reference cards', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    f.addCodeThread('t1', project)
    bindImMessageService(f.deps.threadStore, f.service)
    const tool = roomImMessageTool(f.deps.threadStore)
    const sent = await tool.execute({ text: 'This is the session I mean.', phase: 'final', references: [{ kind: 'code_thread', threadId: 't1' }] }, f.context())
    expect(sent.isError).not.toBe(true)
    const message = (await f.store.get<RoomMessage>('message', (sent.output as { messageId: string }).messageId))!.value
    expect(message.references).toEqual([{ kind: 'code_thread', threadId: 't1', titleSnapshot: 'Session t1' }])
    const forged = await tool.execute({ text: 'x', references: [{ kind: 'code_thread', threadId: 'nope' }] }, f.context('call-2'))
    expect(forged.isError).toBe(true)
  })
})

describe('reference content', () => {
  const runtimeOf = (f: WorkbenchFixture) => ({ rooms: { deps: f.deps, workbench: f.bridge } }) as never

  it('previews a Code session and opens it in Code', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    f.addCodeThread('t1', project)
    const room = await f.service.get(f.room.id)
    const summary = await resolveRoomContent(runtimeOf(f), room, { kind: 'code_thread', threadId: 't1' }, 'summary')
    expect(summary).toMatchObject({ state: 'available', kind: 'code_thread', title: 'Session t1', openTarget: { kind: 'thread', threadId: 't1' } })
    const preview = await resolveRoomContent(runtimeOf(f), room, { kind: 'code_thread', threadId: 't1' }, 'preview')
    expect(preview.preview).toMatchObject({ type: 'text' })
    f.stub.threads.delete('t1')
    expect((await resolveRoomContent(runtimeOf(f), room, { kind: 'code_thread', threadId: 't1' }, 'summary')).state).toBe('unavailable')
  })

  it('previews a Work document only inside a registered workspace', async () => {
    const f = await fixture()
    const root = await workspace(f)
    const room = await f.service.get(f.room.id)
    const preview = await resolveRoomContent(runtimeOf(f), room, { kind: 'work_document', workspaceRoot: root, relativePath: 'notes/plan.md' }, 'preview')
    expect(preview).toMatchObject({ state: 'available', kind: 'work_document', title: 'plan.md',
      openTarget: { kind: 'work_file', workspaceRoot: root, relativePath: 'notes/plan.md' }, preview: { type: 'text', text: '# Plan\nship it' } })
    const stranger = await f.makeDirectory('stranger')
    await writeFile(join(stranger, 'secret.md'), 'no')
    const blocked = await resolveRoomContent(runtimeOf(f), room, { kind: 'work_document', workspaceRoot: stranger, relativePath: 'secret.md' }, 'preview')
    expect(blocked).toMatchObject({ state: 'unavailable', reason: 'workspace_unavailable' })
  })
})
