import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const f of open.splice(0)) await f.cleanup() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options)
  open.push(value)
  return value
}

describe('workbench daily notes tools & dispatch binding', () => {
  it('reads, appends idempotently, marks tasks done, and auto-binds kun://dispatch links on create_code_task', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('gui-repo')
    const notesDir = join(f.directory, 'daily-notes')
    f.addCodeThread('t1', project)
    await f.bridge.directory.set({ workRoots: [], codeProjects: [project], dailyNotesRoot: notesDir })

    const day = '2026-11-26'
    await writeFile(join(notesDir, `${day}.md`), '- [ ] 修复会话折叠跳转 bug !1\n  - 复现路径：折叠侧边栏后点击通知\n', 'utf8')

    const read = await f.run('read_daily_notes', { day })
    expect(read.isError).not.toBe(true)
    expect(read.output).toMatchObject({
      authority: 'reference_only',
      day,
      recentDays: [day],
      tasks: [{
        line: 0,
        done: false,
        text: '修复会话折叠跳转 bug',
        quadrant: 1,
        notes: ['- 复现路径：折叠侧边栏后点击通知']
      }]
    })

    // Dispatching a code task from this daily note automatically binds kun://dispatch/<roomId>/<linkId>.
    const created = await f.run('create_code_task', {
      title: '修复会话折叠跳转 bug',
      goal: '排查并修复侧边栏折叠后的跳转异常',
      projectRoot: project,
      dailyNote: { day, taskText: '修复会话折叠跳转 bug' }
    }, 'call-dispatch')
    expect(created.isError).not.toBe(true)
    const { linkId } = created.output as { linkId: string }

    const afterBind = await readFile(join(notesDir, `${day}.md`), 'utf8')
    expect(afterBind).toContain(`[Bot](kun://dispatch/${f.room.id}/${linkId}) !1`)
    expect(afterBind).toContain('  - 复现路径：折叠侧边栏后点击通知')

    // Adding a task is idempotent for the same toolCallId.
    const added = await f.run('add_daily_note_task', { day, text: '补充回归冒烟用例', quadrant: 2 }, 'call-add')
    const replay = await f.run('add_daily_note_task', { day, text: '补充回归冒烟用例', quadrant: 2 }, 'call-add')
    expect(added.output).toEqual({ added: true, day, text: '补充回归冒烟用例', quadrant: 2 })
    expect(replay.output).toEqual(added.output)

    // Marking done by linkId updates `[ ]` -> `[x]` while keeping link and quadrant intact.
    const checked = await f.run('set_daily_note_task_done', { day, linkId, done: true }, 'call-check')
    expect(checked.output).toEqual({ updated: true, day, text: '修复会话折叠跳转 bug', done: true })

    const finalMd = await readFile(join(notesDir, `${day}.md`), 'utf8')
    expect(finalMd).toBe([
      `- [x] 修复会话折叠跳转 bug [Bot](kun://dispatch/${f.room.id}/${linkId}) !1`,
      '  - 复现路径：折叠侧边栏后点击通知',
      '- [ ] 补充回归冒烟用例 !2'
    ].join('\n'))
  })

  it('withholds personal daily notes from repository-restricted Agents and disabled policies', async () => {
    const allowed = await (await fixture()).makeDirectory('only-this-repo')
    const restricted = await fixture({ allowedRoots: [allowed] })
    await restricted.bridge.directory.set({
      workRoots: [],
      codeProjects: [allowed],
      dailyNotesRoot: join(restricted.directory, 'daily-notes')
    })
    expect((await restricted.run('read_daily_notes', {})).isError).toBe(true)

    const off = await fixture({ policy: { code: 'off', work: 'off' } })
    await off.bridge.directory.set({
      workRoots: [],
      codeProjects: [],
      dailyNotesRoot: join(off.directory, 'daily-notes')
    })
    expect((await off.run('read_daily_notes', {})).isError).toBe(true)
  })
})
