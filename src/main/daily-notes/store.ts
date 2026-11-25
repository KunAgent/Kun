import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Rectangle } from 'electron'
import { isNoteDay } from '../../shared/daily-notes'
import { atomicWriteFile } from '../atomic-json-file'

type PendingNote = { markdown: string; saved: Promise<void> }
export type NoteWindowState = { bounds: Rectangle; pinned: boolean }

export class DailyNotesStore {
  private readonly pending = new Map<string, PendingNote>()

  constructor(private readonly directory: string) {}

  private notePath(day: string): string {
    if (!isNoteDay(day)) throw new Error('Invalid note date')
    return join(this.directory, day + '.md')
  }

  async listDays(): Promise<string[]> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true })
      return entries.filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name.slice(0, -3)).filter(isNoteDay).sort().reverse()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async read(day: string): Promise<string> {
    const path = this.notePath(day)
    await this.pending.get(day)?.saved
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  save(day: string, markdown: string): Promise<void> {
    const path = this.notePath(day)
    if (typeof markdown !== 'string') throw new Error('Invalid note content')
    const active = this.pending.get(day)
    if (active) {
      active.markdown = markdown
      return active.saved
    }
    const batch: PendingNote = { markdown, saved: Promise.resolve() }
    this.pending.set(day, batch)
    batch.saved = this.persist(day, path, batch)
    return batch.saved
  }

  // A quiet editor usually writes once. Continuous typing also reaches disk at
  // regular intervals. A save acknowledgement includes edits made during I/O.
  private async persist(day: string, path: string, batch: PendingNote): Promise<void> {
    try {
      for (;;) {
        await delay(250)
        const snapshot = batch.markdown
        await atomicWriteFile(path, snapshot)
        if (snapshot === batch.markdown) return
      }
    } finally {
      this.pending.delete(day)
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()].map(note => note.saved))
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
