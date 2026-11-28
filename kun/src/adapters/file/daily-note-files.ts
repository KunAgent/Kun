import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDailyNoteRevision, isNoteDay, type DailyNoteSaveResult, type DailyNoteSnapshot } from '../../contracts/daily-notes.js'
import { atomicWriteFile } from './atomic-write.js'
import { withExclusiveFileLock } from './exclusive-file-lock.js'

export function dailyNoteRevision(day: string, markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n')
  return 'daily-v1:' + createHash('sha256').update(`${day}\n${normalized}`).digest('hex')
}

type WriteDailyNote = (day: string, markdown: string) => Promise<void>

export class DailyNoteFiles {
  constructor(private readonly directory: string) {}

  async readMarkdown(day: string): Promise<string> {
    const path = this.notePath(day)
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  async read(day: string): Promise<DailyNoteSnapshot> {
    const markdown = await this.readMarkdown(day)
    return { markdown, revision: dailyNoteRevision(day, markdown) }
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

  async save(day: string, markdown: string, expectedRevision: string): Promise<DailyNoteSaveResult> {
    if (!isNoteDay(day)) throw new Error('Invalid note date')
    if (typeof markdown !== 'string') throw new Error('Invalid note content')
    if (!isDailyNoteRevision(expectedRevision)) throw new Error('Invalid note revision')
    return this.mutate(async write => {
      const current = await this.read(day)
      if (markdown === current.markdown) return { status: 'saved', revision: current.revision }
      if (current.revision !== expectedRevision) return { status: 'conflict', current }
      await write(day, markdown)
      return { status: 'saved', revision: dailyNoteRevision(day, markdown) }
    })
  }

  // Desktop, remote, and agent writes hold the same directory lock from read
  // through commit. A directory lock also covers rollover and task moves.
  mutate<T>(operation: (write: WriteDailyNote) => Promise<T>): Promise<T> {
    return withExclusiveFileLock(join(this.directory, '.daily-notes-write.lock'), () =>
      operation((day, markdown) => atomicWriteFile(this.notePath(day), markdown, {
        durable: true,
        allowDirectWriteFallback: false
      })))
  }

  private notePath(day: string): string {
    if (!isNoteDay(day)) throw new Error('Invalid note date; expected YYYY-MM-DD')
    return join(this.directory, `${day}.md`)
  }
}
