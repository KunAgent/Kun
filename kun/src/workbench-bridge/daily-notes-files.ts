import { DailyNoteFiles } from '../adapters/file/daily-note-files.js'
import { isNoteDay } from '../contracts/daily-notes.js'
import {
  applyDailyNoteChange, findMatchingDailyNoteTask, formatKunDispatchUrl, parseDailyNoteTasks
} from '../contracts/daily-notes-markdown.js'
import type { WorkbenchDailyNoteRef } from '../contracts/workbench-links.js'
import type { WorkbenchDirectoryService } from './directory.js'

/** Binds `kun://dispatch/<roomId>/<linkId>` onto the source daily-note task when available. */
export async function bindDailyNoteForWorkbenchLink(
  directoryService: WorkbenchDirectoryService,
  allowedRoots: readonly string[] | undefined,
  roomId: string,
  linkId: string,
  dailyNote: WorkbenchDailyNoteRef | undefined,
  agentLabel = '小Kun'
): Promise<boolean> {
  if (!dailyNote || !isNoteDay(dailyNote.day)) return false
  const dir = await directoryService.dailyNotesDirectory(allowedRoots)
  if (!dir) return false
  const notes = new DailyNoteFiles(dir)
  return notes.mutate(async write => {
    const current = await notes.readMarkdown(dailyNote.day)
    if (!current) return false
    const target = findMatchingDailyNoteTask(parseDailyNoteTasks(current), { linkId, taskText: dailyNote.taskText })
    if (!target) return false
    const url = formatKunDispatchUrl(roomId, linkId)
    if (target.link?.url === url) return true
    const label = target.link?.label || agentLabel
    const updated = applyDailyNoteChange(current, {
      from: target.metaFrom,
      to: target.end,
      insert: ` [${label.replace(/[\]\r\n]/g, '')}](${url})${target.quadrant ? ` !${target.quadrant}` : ''}`
    })
    await write(dailyNote.day, updated)
    return true
  }).catch(() => false)
}
