import {
  appendDailyNoteTaskChange, applyDailyNoteChange, buildDailyNoteTaskPrompt,
  DAILY_NOTE_QUADRANT_NUMERALS, DAILY_NOTE_QUADRANTS, extractDailyNoteTaskSubtree,
  formatKunDispatchUrl, formatKunRoomUrl, formatKunThreadUrl, moveDailyNoteTaskBlockChange,
  parseDailyNoteTasks, parseKunTaskUrl, replaceDailyNoteTaskSubtreeChange,
  rolloverIncompleteDailyNoteTasks, setDailyNoteTaskLinkChange,
  setDailyNoteTaskQuadrantChange, setDailyNoteTaskTitleChange, toggleDailyNoteTaskChange,
  type DailyNoteLinkSpec, type DailyNoteQuadrant, type DailyNoteTask,
  type DailyNoteTaskLink, type DailyNoteTextChange
} from '../../../../kun/src/contracts/daily-notes-markdown'

export type Quadrant = DailyNoteQuadrant
export type NoteTask = DailyNoteTask
export type NoteTaskLink = DailyNoteTaskLink
export type NoteLinkSpec = DailyNoteLinkSpec
export type NoteChange = DailyNoteTextChange
export type DaySummary = { done: number; total: number; hasContent: boolean }

export const QUADRANTS = DAILY_NOTE_QUADRANTS
export const QUADRANT_NUMERALS = DAILY_NOTE_QUADRANT_NUMERALS

export {
  buildDailyNoteTaskPrompt,
  extractDailyNoteTaskSubtree,
  formatKunDispatchUrl,
  formatKunRoomUrl,
  formatKunThreadUrl,
  moveDailyNoteTaskBlockChange,
  parseKunTaskUrl,
  replaceDailyNoteTaskSubtreeChange,
  rolloverIncompleteDailyNoteTasks,
  setDailyNoteTaskQuadrantChange,
  setDailyNoteTaskTitleChange,
  toggleDailyNoteTaskChange
}

export function parseTasks(markdown: string): NoteTask[] {
  return parseDailyNoteTasks(markdown)
}

export function countTasks(markdown: string): { done: number; total: number } {
  const tasks = parseDailyNoteTasks(markdown)
  return { done: tasks.filter(task => task.done).length, total: tasks.length }
}

export function summarizeDay(markdown: string): DaySummary {
  const { done, total } = countTasks(markdown)
  return { done, total, hasContent: markdown.trim().length > 0 }
}

export function taskAt(markdown: string, line: number): NoteTask | undefined {
  return parseDailyNoteTasks(markdown).find(task => task.line === line)
}

export function toggleChange(task: NoteTask, done = !task.done): NoteChange {
  return toggleDailyNoteTaskChange(task, done)
}

export function quadrantChange(task: NoteTask, quadrant: Quadrant | null): NoteChange {
  return setDailyNoteTaskQuadrantChange(task, quadrant)
}

export function linkChange(task: NoteTask, link: NoteLinkSpec | null): NoteChange {
  return setDailyNoteTaskLinkChange(task, link)
}

export function appendTaskChange(
  markdown: string,
  text: string,
  quadrant: Quadrant | null,
  link: NoteLinkSpec | null = null
): NoteChange {
  return appendDailyNoteTaskChange(markdown, text, quadrant, link)
}

export function applyNoteChange(markdown: string, change: NoteChange): string {
  return applyDailyNoteChange(markdown, change)
}
