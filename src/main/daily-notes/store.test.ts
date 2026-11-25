import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect(await notes.read(today)).toBe('')
    expect(await notes.listDays()).toEqual([])
    const saves = [notes.save(today, '- [ ] 反馈'), notes.save(yesterday, 'Other day'), notes.save(today, '- [x] 反馈')]
    await notes.flush()
    await Promise.all(saves)
    expect(await readFile(join(directory, today + '.md'), 'utf8')).toBe('- [x] 反馈')
    const reopened = new DailyNotesStore(directory)
    expect(await reopened.listDays()).toEqual([today, yesterday])
    expect(await reopened.read(yesterday)).toBe('Other day')
  })

  it('keeps non-note files and invalid dates out of the file API', async () => {
    await writeFile(join(directory, '2026-02-30.md'), 'invalid')
    await mkdir(join(directory, '2026-11-25.md'))
    const state = { bounds: { x: -450, y: 50, width: 400, height: 600 }, pinned: false }
    await notes.saveWindowState(state)
    expect(await notes.readWindowState()).toEqual(state)
    expect(await notes.listDays()).toEqual([])
    await expect(notes.read('../other')).rejects.toThrow('Invalid note date')
    expect(() => notes.save('2026-02-30', '')).toThrow('Invalid note date')
    await expect(notes.read('2024-02-29')).resolves.toBe('')
  })

  it('reports a failed save and accepts a retry with the complete draft', async () => {
    const day = '2026-11-25'
    const path = join(directory, day + '.md')
    await mkdir(path)
    await expect(notes.save(day, 'unsaved')).rejects.toThrow()
    await rm(path, { recursive: true })
    await notes.save(day, 'unsaved plus new text')
    expect(await notes.read(day)).toBe('unsaved plus new text')
  })
})
