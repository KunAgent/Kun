import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyDailyNoteChange, findMatchingDailyNoteTask, formatKunDispatchUrl, parseDailyNoteTasks
} from '../contracts/daily-notes-markdown.js'
import type { WorkbenchDailyNoteRef } from '../contracts/workbench-links.js'
import type { WorkbenchDirectoryService } from './directory.js'

export function isValidNoteDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function localNoteDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export async function atomicWriteNote(directory: string, day: string, markdown: string): Promise<void> {
  if (!isValidNoteDay(day)) throw new Error('Invalid note date; expected YYYY-MM-DD')
  await mkdir(directory, { recursive: true })
  const target = join(directory, `${day}.md`)
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, markdown, 'utf8')
  await rename(temp, target)
}

export async function readNoteText(directory: string, day: string): Promise<string> {
  if (!isValidNoteDay(day)) throw new Error('Invalid note date; expected YYYY-MM-DD')
  try {
    return await readFile(join(directory, `${day}.md`), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function listSavedNoteDays(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name.slice(0, -3))
      .filter(isValidNoteDay)
      .sort()
      .reverse()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Binds `kun://dispatch/<roomId>/<linkId>` onto the source daily-note task when available. */
export async function bindDailyNoteForWorkbenchLink(
  directoryService: WorkbenchDirectoryService,
  allowedRoots: readonly string[] | undefined,
  roomId: string,
  linkId: string,
  dailyNote: WorkbenchDailyNoteRef | undefined,
  agentLabel = '小Kun'
): Promise<boolean> {
  if (!dailyNote || !isValidNoteDay(dailyNote.day)) return false
  const dir = await directoryService.dailyNotesDirectory(allowedRoots)
  if (!dir) return false
  const current = await readNoteText(dir, dailyNote.day).catch(() => '')
  if (!current) return false
  const tasks = parseDailyNoteTasks(current)
  const target = findMatchingDailyNoteTask(tasks, { linkId, taskText: dailyNote.taskText })
  if (!target) return false
  const url = formatKunDispatchUrl(roomId, linkId)
  if (target.link?.url === url) return true
  const label = target.link?.label || agentLabel
  const updated = applyDailyNoteChange(current, {
    from: target.metaFrom,
    to: target.end,
    insert: ` [${label.replace(/[\]\r\n]/g, '')}](${url})${target.quadrant ? ` !${target.quadrant}` : ''}`
  })
  await atomicWriteNote(dir, dailyNote.day, updated).catch(() => undefined)
  return true
}
