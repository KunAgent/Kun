import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Rectangle } from 'electron'
import { DailyNoteFiles } from '../../../kun/src/adapters/file/daily-note-files'
import { rolloverIncompleteDailyNoteTasks } from '../../../kun/src/contracts/daily-notes-markdown'
import type { DailyNoteRolloverResult, DailyNoteSaveResult, DailyNoteSnapshot } from '../../shared/daily-notes'
import { atomicWriteFile } from '../atomic-json-file'

export type NoteWindowState = { bounds: Rectangle; pinned: boolean }

export class DailyNotesStore {
  private readonly pending = new Map<string, Promise<DailyNoteSaveResult>>()
  private readonly files: DailyNoteFiles

  constructor(private readonly directory: string) {
    this.files = new DailyNoteFiles(directory)
  }

  getDirectory(): string {
    return this.directory
  }

  listDays(): Promise<string[]> {
    return this.files.listDays()
  }

  async read(day: string): Promise<DailyNoteSnapshot> {
    await this.pending.get(day)?.catch(() => undefined)
    return this.files.read(day)
  }

  async save(day: string, markdown: string, expectedRevision: string): Promise<DailyNoteSaveResult> {
    const previous = this.pending.get(day) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => {
      await delay(250)
      return this.files.save(day, markdown, expectedRevision)
    })
    this.pending.set(day, pending)
    try {
      return await pending
    } finally {
      if (this.pending.get(day) === pending) this.pending.delete(day)
    }
  }

  async mutateDay(day: string, updater: (markdown: string) => string | null): Promise<boolean> {
    await this.pending.get(day)
    return this.files.mutate(async write => {
      const current = await this.files.readMarkdown(day)
      const next = updater(current)
      if (next === null || next === current) return false
      await write(day, next)
      return true
    })
  }

  async rollover(fromDay: string, toDay: string): Promise<DailyNoteRolloverResult> {
    if (fromDay === toDay) {
      const { markdown } = await this.read(fromDay)
      return { movedCount: 0, fromMarkdown: markdown, toMarkdown: markdown }
    }
    await this.flush()
    return this.files.mutate(async write => {
      const [from, to] = await Promise.all([this.files.readMarkdown(fromDay), this.files.readMarkdown(toDay)])
      const { nextFrom, nextTo, movedCount } = rolloverIncompleteDailyNoteTasks(from, to)
      if (movedCount > 0) {
        await write(toDay, nextTo)
        await write(fromDay, nextFrom)
      }
      return { movedCount, fromMarkdown: nextFrom, toMarkdown: nextTo }
    })
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending.values())
  }

  async readWindowState(): Promise<NoteWindowState | null> {
    try {
      const state = JSON.parse(await readFile(join(this.directory, 'window.json'), 'utf8'))
      const bounds = state?.bounds
      if (typeof state?.pinned === 'boolean' && bounds &&
          [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) &&
          bounds.width > 0 && bounds.height > 0) {
        return { bounds, pinned: state.pinned }
      }
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  saveWindowState(state: NoteWindowState): Promise<void> {
    return atomicWriteFile(join(this.directory, 'window.json'), JSON.stringify(state) + '\n')
  }
}
