import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'
import { confirmWorkbenchLink } from './actions.js'
import { WorkbenchDirectoryService } from './directory.js'
import { reconcileWorkbench } from './reconcile.js'
import { applyWorkEdits, assertRelativeWorkPath, createWorkFile, readWorkText, replaceWorkFile, searchWorkDocuments, sha256 } from './work-files.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })
beforeEach(() => { vi.mocked(enqueuePrivateContinuation).mockClear() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options ?? { policy: { work: 'confirm' } })
  open.push(value)
  return value
}
const link = async (f: WorkbenchFixture, id: string) => (await f.store.get<WorkbenchLink>('workbench_link', id))!
let sequence = 0
const accept = async (f: WorkbenchFixture, id: string) =>
  confirmWorkbenchLink(f.bridge, f.room.id, id, { clientRequestId: 'accept-' + ++sequence, expectedRevision: (await link(f, id)).revision })
async function workspace(f: WorkbenchFixture) {
  const root = await f.makeDirectory('work')
  await f.bridge.directory.set({ workRoots: [root], defaultWorkRoot: root, codeProjects: [] })
  return root
}

describe('Work file safety', () => {
  it('accepts only plain relative paths', () => {
    expect(assertRelativeWorkPath('notes/plan.md')).toBe('notes/plan.md')
    for (const bad of ['/etc/passwd', '../x.md', 'a/../b.md', 'a\\b.md', 'C:/x.md', '.hidden/x.md', 'a//b.md', '', 'a/\0b']) {
      expect(() => assertRelativeWorkPath(bad), bad).toThrow()
    }
  })

  it('applies exact-match edits only when each target is unambiguous', () => {
    expect(applyWorkEdits('one two three', [{ oldText: 'two', newText: '2' }])).toBe('one 2 three')
    expect(() => applyWorkEdits('a a', [{ oldText: 'a', newText: 'b' }])).toThrow('more than once')
    expect(() => applyWorkEdits('abc', [{ oldText: 'zzz', newText: 'b' }])).toThrow('not found')
    // Later edits see the result of earlier ones.
    expect(applyWorkEdits('x y', [{ oldText: 'x', newText: 'abc' }, { oldText: 'abc', newText: 'z' }])).toBe('z y')
  })

  it('never writes outside the workspace or over existing files', async () => {
    const f = await fixture()
    const root = await workspace(f)
    const outside = await f.makeDirectory('outside')
    await symlink(outside, join(root, 'link'))
    await expect(createWorkFile(root, 'link/escape.md', 'x')).rejects.toThrow('outside the workspace')
    await createWorkFile(root, 'a/b/new.md', '# hi')
    expect(await readFile(join(root, 'a/b/new.md'), 'utf8')).toBe('# hi')
    await expect(createWorkFile(root, 'a/b/new.md', 'again')).rejects.toThrow('already exists')
    await expect(createWorkFile(root, 'a/prog.exe', 'x')).rejects.toThrow('unsupported')
    await expect(readWorkText(root, 'link/../escape.md', 0, 100)).rejects.toThrow()
  })

  it('pages text and refuses a replace when the document changed', async () => {
    const f = await fixture()
    const root = await workspace(f)
    await writeFile(join(root, 'doc.md'), 'x'.repeat(50))
    const first = await readWorkText(root, 'doc.md', 0, 20)
    expect(first).toMatchObject({ totalChars: 50, nextOffset: 20, sha256: sha256('x'.repeat(50)) })
    expect((await readWorkText(root, 'doc.md', 40, 20)).nextOffset).toBeUndefined()
    await expect(replaceWorkFile(root, 'doc.md', [{ oldText: 'xxx', newText: 'y' }], sha256('something else'))).rejects.toThrow('changed after')
    await writeFile(join(root, 'bin.docx'), 'PK')
    await expect(readWorkText(root, 'bin.docx', 0, 10)).rejects.toThrow('cannot be read as text')
  })

  it('searches names and text, skipping hidden and dependency folders', async () => {
    const f = await fixture()
    const root = await workspace(f)
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'weekly-report.md'), 'progress on the sse work')
    await writeFile(join(root, 'ideas.md'), 'the reconnect protocol needs a backoff')
    await writeFile(join(root, 'node_modules/leak.md'), 'reconnect')
    const byName = await searchWorkDocuments(root, 'report', 5)
    expect(byName.map((hit) => [hit.relativePath, hit.match])).toEqual([['weekly-report.md', 'name']])
    const byContent = await searchWorkDocuments(root, 'reconnect', 5)
    expect(byContent.map((hit) => hit.relativePath)).toEqual(['ideas.md'])
    expect(byContent[0].snippet).toContain('reconnect protocol')
  })
})

describe('Work directory', () => {
  it('persists across restarts and drops roots that no longer exist', async () => {
    const f = await fixture()
    const root = await f.makeDirectory('work')
    const path = join(f.directory, 'dir.json')
    const first = new WorkbenchDirectoryService(path)
    expect(await first.set({ workRoots: [root, join(f.directory, 'gone')], defaultWorkRoot: root, codeProjects: [] })).toEqual({
      workRoots: [root], defaultWorkRoot: root, codeProjects: [] })
    expect(await new WorkbenchDirectoryService(path).get()).toMatchObject({ workRoots: [root], defaultWorkRoot: root })
    // Without an Agent-specific list, writes are limited to the default workspace.
    expect(await first.writableWorkRoots()).toEqual([root])
    expect(await first.readableWorkRoots([join(f.directory, 'elsewhere')])).toEqual([])
  })
})

describe('Work tools', () => {
  it('lists, searches and reads documents inside registered workspaces only', async () => {
    const f = await fixture({ policy: { work: 'read' } })
    const root = await workspace(f)
    await writeFile(join(root, 'plan.md'), '# Plan\nship the bridge')
    const spaces = (await f.run('list_work_spaces', {})).output as { workspaces: Array<{ path: string; recent: Array<{ relativePath: string }> }> }
    expect(spaces.workspaces).toEqual([expect.objectContaining({ path: root, recent: [expect.objectContaining({ relativePath: 'plan.md' })] })])
    const found = (await f.run('search_work_documents', { query: 'bridge' })).output as { documents: Array<{ relativePath: string }> }
    expect(found.documents.map((doc) => doc.relativePath)).toEqual(['plan.md'])
    const read = await f.run('read_work_document', { workspaceRoot: root, relativePath: 'plan.md' })
    expect(read.output).toMatchObject({ authority: 'reference_only', text: '# Plan\nship the bridge', sha256: sha256('# Plan\nship the bridge') })
    const stranger = await f.makeDirectory('not-registered')
    await writeFile(join(stranger, 'secret.md'), 'nope')
    expect((await f.run('read_work_document', { workspaceRoot: stranger, relativePath: 'secret.md' })).isError).toBe(true)
    expect((await f.run('create_work_document', { relativePath: 'x.md', content: 'x' })).isError).toBe(true) // read-only policy
  })

  it('creates a document only after the user confirms, then reports nothing to the model', async () => {
    const f = await fixture()
    const root = await workspace(f)
    const requested = (await f.run('create_work_document', { relativePath: 'notes/idea.md', content: '# Idea', title: 'Idea' })).output as { linkId: string; status: string }
    expect(requested.status).toBe('awaiting_confirmation')
    await reconcileWorkbench(f.bridge)
    await expect(readFile(join(root, 'notes/idea.md'), 'utf8')).rejects.toThrow() // nothing before confirmation
    await accept(f, requested.linkId)
    await reconcileWorkbench(f.bridge)
    expect(await readFile(join(root, 'notes/idea.md'), 'utf8')).toBe('# Idea')
    expect((await link(f, requested.linkId)).value).toMatchObject({ status: 'completed', result: { summary: 'Created notes/idea.md.', path: join(root, 'notes/idea.md') } })
    expect(enqueuePrivateContinuation).not.toHaveBeenCalled()
    expect((await f.run('create_work_document', { relativePath: 'notes/idea.md', content: 'again' }, 'call-2')).isError).toBe(true)
  })

  it('proposes an edit against a hash and applies it only if the document is unchanged', async () => {
    const f = await fixture()
    const root = await workspace(f)
    await writeFile(join(root, 'doc.md'), 'alpha beta gamma')
    const bad = await f.run('propose_work_edit', { workspaceRoot: root, relativePath: 'doc.md', summary: 's', edits: [{ oldText: 'zzz', newText: 'y' }] })
    expect(bad.isError).toBe(true) // fails at proposal time, so the Agent can correct itself
    const proposal = (await f.run('propose_work_edit', { workspaceRoot: root, relativePath: 'doc.md', summary: 'Rename beta',
      edits: [{ oldText: 'beta', newText: 'BETA' }] }, 'call-2')).output as { linkId: string }
    expect((await link(f, proposal.linkId)).value.request.baseSha256).toBe(sha256('alpha beta gamma'))
    await accept(f, proposal.linkId)
    await reconcileWorkbench(f.bridge)
    expect(await readFile(join(root, 'doc.md'), 'utf8')).toBe('alpha BETA gamma')
    expect((await link(f, proposal.linkId)).value.status).toBe('completed')

    await writeFile(join(root, 'doc2.md'), 'one two')
    const stale = (await f.run('propose_work_edit', { workspaceRoot: root, relativePath: 'doc2.md', summary: 'Edit',
      edits: [{ oldText: 'one', newText: '1' }] }, 'call-3')).output as { linkId: string }
    await writeFile(join(root, 'doc2.md'), 'one two (edited by the user)')
    await accept(f, stale.linkId)
    await reconcileWorkbench(f.bridge)
    expect((await link(f, stale.linkId)).value).toMatchObject({ status: 'failed', error: expect.stringContaining('changed after') })
    expect(await readFile(join(root, 'doc2.md'), 'utf8')).toBe('one two (edited by the user)')
  })

  it('starts a Work task as a write-surface session in the Work workspace', async () => {
    const f = await fixture()
    const root = await workspace(f)
    const requested = (await f.run('create_work_task', { title: 'Survey papers', goal: 'Summarize recent SSE papers', relativePath: 'survey.md' })).output as { linkId: string }
    await accept(f, requested.linkId)
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    const started = (await link(f, requested.linkId)).value
    expect(f.stub.threads.get(started.threadId!)).toMatchObject({ workspace: root, agentSurface: 'write', workbenchOrigin: { kind: 'bot', linkId: requested.linkId } })
    expect(f.stub.calls.enqueued[0].request).toMatchObject({ agentSurface: 'write' })
    expect(String(f.stub.calls.enqueued[0].request.prompt)).toContain('Document in focus: survey.md')
  })

  it('requires confirmation for a scheduled Work task even under an auto policy', async () => {
    const f = await fixture({ policy: { work: 'auto' } })
    await workspace(f)
    const runAt = new Date(Date.now() + 120_000).toISOString()
    const requested = (await f.run('create_work_task', { title: 'Scheduled notes', goal: 'Write notes',
      schedule: { kind: 'once', runAt, timeZone: 'UTC' } }, 'work-schedule')).output as { linkId: string }
    expect((await link(f, requested.linkId)).value.status).toBe('awaiting_confirmation')
    await accept(f, requested.linkId)
    expect((await link(f, requested.linkId)).value.status).toBe('scheduled')
  })

  it('adds a project board card after confirmation', async () => {
    const f = await fixture({ policy: { code: 'confirm' } })
    const project = await f.makeDirectory('project')
    const created: Array<Record<string, unknown>> = []
    f.bridge.attach({ projectBoard: { createManualCard: async (input: Record<string, unknown>) => {
      created.push(input)
      return { cards: [{ id: 'manual:card-1', kind: 'manual', title: 'Write docs' }] }
    } } as never })
    const requested = (await f.run('add_board_card', { projectRoot: project, title: 'Write docs', description: 'Explain the bridge', category: 'docs', priority: 'P1' })).output as { linkId: string }
    await accept(f, requested.linkId)
    await reconcileWorkbench(f.bridge)
    expect(created).toEqual([expect.objectContaining({ workspace: project, title: 'Write docs', status: 'pending', category: 'docs', priority: 'P1' })])
    expect((await link(f, requested.linkId)).value).toMatchObject({ status: 'completed', result: { cardId: 'manual:card-1' } })
  })

  it('recovers an interrupted document create by content, and otherwise asks the user', async () => {
    const f = await fixture()
    const root = await workspace(f)
    const requested = (await f.run('create_work_document', { relativePath: 'crash.md', content: 'body' })).output as { linkId: string }
    await accept(f, requested.linkId)
    // Simulate a runtime that died after writing the file but before recording the outcome.
    await writeFile(join(root, 'crash.md'), 'body')
    const row = await link(f, requested.linkId)
    await f.store.commit({ requestId: 'claimed', checks: [{ kind: 'workbench_link', id: requested.linkId, expectedRevision: row.revision }],
      puts: [{ kind: 'workbench_link', id: requested.linkId, roomId: f.room.id, value: { ...row.value, status: 'running' } }] })
    await reconcileWorkbench(f.bridge)
    expect((await link(f, requested.linkId)).value.status).toBe('completed')
    // A different file with the same name is not proof of completion.
    const other = (await f.run('create_work_document', { relativePath: 'other.md', content: 'mine' }, 'call-2')).output as { linkId: string }
    await accept(f, other.linkId)
    await writeFile(join(root, 'other.md'), 'someone else wrote this')
    const claimed = await link(f, other.linkId)
    await f.store.commit({ requestId: 'claimed-2', checks: [{ kind: 'workbench_link', id: other.linkId, expectedRevision: claimed.revision }],
      puts: [{ kind: 'workbench_link', id: other.linkId, roomId: f.room.id, value: { ...claimed.value, status: 'running' } }] })
    await reconcileWorkbench(f.bridge)
    expect((await link(f, other.linkId)).value.status).toBe('recovery_required')
  })
})
