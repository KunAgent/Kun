import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Envelope } from '../../../kun/src/remote/contracts'
import { RemoteDailyNotes } from '../../../kun/src/remote/daily-notes/service'
import type { ServerRuntime } from '../../../kun/src/server/routes/server-runtime'
import { DailyNotesStore } from './store'

describe('daily notes on disk', () => {
  let directory: string
  let notes: DailyNotesStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kun-daily-notes-test-'))
    notes = new DailyNotesStore(directory)
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('only creates a dated Markdown file after an edit and keeps the latest edit for each date', async () => {
    const today = '2026-11-25'
    const yesterday = '2026-11-24'
    const todayBase = await notes.read(today)
    const yesterdayBase = await notes.read(yesterday)
    expect(todayBase.markdown).toBe('')
    expect(await notes.listDays()).toEqual([])
    const saves = [
      notes.save(today, '- [ ] 反馈', todayBase.revision),
      notes.save(yesterday, 'Other day', yesterdayBase.revision)
    ]
    await notes.flush()
    await Promise.all(saves)
    await notes.save(today, '- [x] 反馈', (await notes.read(today)).revision)
    expect(await readFile(join(directory, today + '.md'), 'utf8')).toBe('- [x] 反馈')
    const reopened = new DailyNotesStore(directory)
    expect(await reopened.listDays()).toEqual([today, yesterday])
    expect(await reopened.read(yesterday)).toMatchObject({ markdown: 'Other day' })
  })

  it('keeps non-note files and invalid dates out of the file API', async () => {
    await writeFile(join(directory, '2026-02-30.md'), 'invalid')
    await mkdir(join(directory, '2026-11-25.md'))
    const state = { bounds: { x: -450, y: 50, width: 400, height: 600 }, pinned: false }
    await notes.saveWindowState(state)
    expect(await notes.readWindowState()).toEqual(state)
    expect(await notes.listDays()).toEqual([])
    await expect(notes.read('../other')).rejects.toThrow('Invalid note date')
    const leapDay = await notes.read('2024-02-29')
    expect(leapDay.markdown).toBe('')
    await expect(notes.save('2026-02-30', '', leapDay.revision)).rejects.toThrow('Invalid note date')
    await expect(notes.save('2024-02-29', 'invalid revision', '')).rejects.toThrow('Invalid note revision')
  })

  it('reports a failed save and accepts a retry with the complete draft', async () => {
    const day = '2026-11-25'
    const path = join(directory, day + '.md')
    const { revision } = await notes.read(day)
    await mkdir(path)
    await expect(notes.save(day, 'unsaved', revision)).rejects.toThrow()
    await rm(path, { recursive: true })
    await notes.save(day, 'unsaved plus new text', revision)
    expect(await notes.read(day)).toMatchObject({ markdown: 'unsaved plus new text' })
  })
})

const day = '2026-11-27'
const base = '- [ ] Review\r\n'
const checked = '- [x] Review\r\n'
const localDraft = base + 'Desktop draft'

describe('desktop and remote Daily Notes writes', () => {
  let directory: string
  let path: string
  let desktop: DailyNotesStore
  let remote: RemoteDailyNotes

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kun-daily-note-saves-'))
    path = join(directory, day + '.md')
    await writeFile(path, base, 'utf8')
    desktop = new DailyNotesStore(directory)
    remote = new RemoteDailyNotes({ dailyNotesDir: directory } as ServerRuntime)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function toggleParams(expectedRevision: string) {
    const params = { day, line: 0, done: true, expectedRevision }
    const envelope: Envelope = {
      accountId: 'test-account', deviceId: 'test-device', authorizationId: 'test-auth', scopes: ['personal'],
      call: { method: 'daily.notes.update', requestId: 'check-task', expiresAt: Date.now() + 10_000, params }
    }
    return { envelope, params }
  }

  it('preserves a successful remote check when the desktop submits its older draft', async () => {
    const desktopBase = await desktop.read(day)
    const remoteBase = await remote.get(day)
    expect(desktopBase.revision).toBe(remoteBase.revision)
    const { envelope, params } = toggleParams(remoteBase.revision)

    const remoteSave = await remote.dispatch(envelope, params)
    expect(remoteSave).toMatchObject({ page: { completed: 1 } })
    const localSave = await desktop.save(day, localDraft, desktopBase.revision)
    expect(localSave).toEqual({
      status: 'conflict',
      current: { markdown: checked, revision: (await remote.get(day)).revision }
    })
    expect(await readFile(path, 'utf8')).toBe(checked)
  })

  it('rechecks the remote revision at dispatch after the desktop writes', async () => {
    const { revision } = await desktop.read(day)
    const { envelope, params } = toggleParams(revision)
    await remote.preflight(envelope.call.method, params)
    expect(await desktop.save(day, localDraft, revision)).toMatchObject({ status: 'saved' })
    await expect(remote.dispatch(envelope, params)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe(localDraft)
  })
})
