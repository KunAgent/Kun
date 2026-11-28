import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  DailyNoteQuadrant,
  RemoteDailyNoteDaySummary,
  RemoteDailyNotePage,
  RemoteDailyNoteRolloverResult,
  RemoteDailyNotesOverview,
  RemoteDailyNoteTask,
  RemoteDailyNoteTaskLink,
  RemoteDailyNoteUpdateResult
} from '@kun/remote-protocol'
import {
  appendDailyNoteTaskChange,
  applyDailyNoteChange,
  parseDailyNoteTasks,
  rolloverIncompleteDailyNoteTasks,
  setDailyNoteTaskLinkChange,
  setDailyNoteTaskQuadrantChange,
  setDailyNoteTaskTitleChange,
  toggleDailyNoteTaskChange,
  type DailyNoteTask,
  type DailyNoteTaskLink
} from '../../contracts/daily-notes-markdown.js'
import type { WorkbenchLink } from '../../contracts/workbench-links.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { pathWithin } from '../../workbench-bridge/directory.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { threadTodoProgress } from '../todos/service.js'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const RECEIPTS_FILE = 'remote-receipts.json'

type CreateLedgerEntry = { day: string; revision: string; createdAt: number }

export function isValidNoteDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false
  const date = new Date(value + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function localNoteDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function dailyNoteRevision(day: string, markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n')
  return 'daily-v1:' + createHash('sha256').update(`${day}\n${normalized}`).digest('hex')
}

function createIdempotencyId(scope: RemoteScope, requestId: string): string {
  return createHash('sha256').update(receiptKey(scope, requestId)).digest('hex').slice(0, 32)
}

function summarizeDayMarkdown(day: string, markdown: string): RemoteDailyNoteDaySummary {
  const tasks = parseDailyNoteTasks(markdown)
  let completed = 0
  const quadrants = { q1: 0, q2: 0, q3: 0, q4: 0, unsorted: 0 }
  for (const task of tasks) {
    if (task.done) completed += 1
    else if (task.quadrant === 1) quadrants.q1 += 1
    else if (task.quadrant === 2) quadrants.q2 += 1
    else if (task.quadrant === 3) quadrants.q3 += 1
    else if (task.quadrant === 4) quadrants.q4 += 1
    else quadrants.unsorted += 1
  }
  const hasProse = tasks.length === 0 && markdown.trim().length > 0
  return {
    day,
    revision: dailyNoteRevision(day, markdown),
    total: tasks.length,
    completed,
    quadrants,
    hasProse
  }
}

function formatPlainNotesInsert(markdown: string, indent: number, notes: readonly string[]): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const cleaned = notes.map((line) => line.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean)
  if (cleaned.length === 0) return ''
  const pad = ' '.repeat(indent + 2)
  return eol + cleaned.map((line) => pad + line).join(eol)
}

function cutTaskSubtree(markdown: string, task: DailyNoteTask): { remaining: string; block: string } {
  const block = markdown.slice(task.lineFrom, task.subtreeEnd)
  let cutFrom = task.lineFrom
  let cutTo = task.subtreeEnd
  if (markdown.slice(cutTo, cutTo + 2) === '\r\n') cutTo += 2
  else if (markdown[cutTo] === '\n') cutTo += 1
  else if (cutFrom > 0 && markdown[cutFrom - 1] === '\n') {
    cutFrom -= markdown[cutFrom - 2] === '\r' ? 2 : 1
  }
  return { remaining: markdown.slice(0, cutFrom) + markdown.slice(cutTo), block }
}

function appendRawBlock(markdown: string, block: string): string {
  const lastLine = markdown.slice(markdown.lastIndexOf('\n') + 1).replace(/\r$/, '')
  const sep = markdown.length === 0 || lastLine.length === 0 ? '' : '\n'
  return markdown + sep + block
}

export function dailyNotesAvailable(runtime: ServerRuntime): boolean {
  return Boolean(runtime.dailyNotesDir?.trim() || runtime.rooms || process.env.KUN_DAILY_NOTES_DIR?.trim())
}

export class RemoteDailyNotes {
  private readonly dirQueues = new Map<string, Promise<unknown>>()

  constructor(private runtime: ServerRuntime) {}

  private async resolveDirectory(): Promise<string> {
    const explicit = this.runtime.dailyNotesDir?.trim()
    if (explicit) return resolve(explicit)
    const bridged = await this.runtime.rooms?.workbench.directory.dailyNotesDirectory()
    if (bridged) return resolve(bridged)
    const envDir = process.env.KUN_DAILY_NOTES_DIR?.trim()
    if (envDir) return resolve(envDir)
    const fallback = this.runtime.rooms?.deps.dataDir
    if (fallback) return resolve(join(fallback, 'daily-notes'))
    throw new Error('UNSUPPORTED_OPERATION')
  }

  private notePath(dir: string, day: string): string {
    if (!isValidNoteDay(day)) throw new RemoteNoEffect('INVALID_REQUEST')
    const target = resolve(join(dir, `${day}.md`))
    if (!pathWithin(dir, target)) throw new RemoteNoEffect('INVALID_REQUEST')
    return target
  }

  private withDirLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.dirQueues.get(dir) ?? Promise.resolve()
    const run = prev.catch(() => undefined).then(fn)
    this.dirQueues.set(dir, run)
    void run.finally(() => {
      if (this.dirQueues.get(dir) === run) this.dirQueues.delete(dir)
    }).catch(() => undefined)
    return run
  }

  private async readDayMarkdown(dir: string, day: string): Promise<string> {
    const path = this.notePath(dir, day)
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  private async writeDayMarkdown(dir: string, day: string, markdown: string): Promise<void> {
    const path = this.notePath(dir, day)
    await mkdir(dir, { recursive: true })
    const tmp = `${path}.${randomUUID()}.tmp`
    await writeFile(tmp, markdown, 'utf8')
    await rename(tmp, path)
  }

  private async readCreateLedger(dir: string): Promise<Record<string, CreateLedgerEntry>> {
    try {
      const raw = JSON.parse(await readFile(join(dir, RECEIPTS_FILE), 'utf8'))
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, CreateLedgerEntry> : {}
    } catch {
      return {}
    }
  }

  private async writeCreateLedger(dir: string, key: string, entry: CreateLedgerEntry): Promise<void> {
    const current = await this.readCreateLedger(dir)
    current[key] = entry
    const entries = Object.entries(current).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 200)
    await mkdir(dir, { recursive: true })
    const target = join(dir, RECEIPTS_FILE)
    const tmp = `${target}.${randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(entries)), 'utf8')
    await rename(tmp, target)
  }

  private async listDiskDays(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name.slice(0, -3))
        .filter(isValidNoteDay)
        .sort()
        .reverse()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async hydrateLinks(tasks: readonly DailyNoteTask[]): Promise<Map<string, RemoteDailyNoteTaskLink>> {
    const uniqueLinks = new Map<string, DailyNoteTaskLink>()
    for (const task of tasks) {
      if (task.link && !uniqueLinks.has(task.link.url)) uniqueLinks.set(task.link.url, task.link)
    }
    const resolved = new Map<string, RemoteDailyNoteTaskLink>()
    await Promise.all([...uniqueLinks.values()].map(async (link) => {
      if (link.kind === 'thread') {
        const thread = await this.runtime.threadService.getMetadata(link.threadId).catch(() => null)
        if (!thread) {
          resolved.set(link.url, { kind: 'thread', label: link.label, url: link.url, threadId: link.threadId, statusTone: 'idle' })
          return
        }
        const progress = threadTodoProgress(thread)
        const hasActiveTurn = thread.status === 'running' || thread.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')
        const lastTurn = thread.turns.at(-1)
        const statusTone = hasActiveTurn
          ? 'running'
          : lastTurn?.status === 'failed'
            ? 'failed'
            : lastTurn?.status === 'completed'
              ? 'completed'
              : 'idle'
        const statusText = progress
          ? `${hasActiveTurn ? '执行中' : statusTone === 'completed' ? '已完成' : '进度'} ${progress.completed}/${progress.total}`
          : hasActiveTurn
            ? '运行中'
            : thread.title.trim().slice(0, 24) || link.label
        resolved.set(link.url, {
          kind: 'thread',
          label: link.label,
          url: link.url,
          threadId: link.threadId,
          statusTone,
          statusText,
          ...(progress ? { progress: { completed: progress.completed, total: progress.total } } : {})
        })
        return
      }

      if (link.kind === 'dispatch') {
        const row = await this.runtime.rooms?.workbench.store.get<WorkbenchLink>('workbench_link', link.linkId).catch(() => undefined)
        const wb = row?.value
        if (!wb) {
          resolved.set(link.url, { kind: 'dispatch', label: link.label, url: link.url, roomId: link.roomId, linkId: link.linkId, statusTone: 'idle' })
          return
        }
        const statusTone = ['queued', 'running'].includes(wb.status)
          ? 'running'
          : ['needs_attention', 'recovery_required', 'plan_ready'].includes(wb.status)
            ? 'attention'
            : wb.status === 'completed'
              ? 'completed'
              : ['failed', 'missed'].includes(wb.status)
                ? 'failed'
                : ['awaiting_confirmation', 'scheduled'].includes(wb.status)
                  ? 'pending'
                  : 'idle'
        const statusText = statusTone === 'running'
          ? (wb.activity?.action ? `运行中 · ${wb.activity.action.slice(0, 18)}` : '小鲲执行中')
          : statusTone === 'completed'
            ? '已完成'
            : statusTone === 'attention'
              ? '待处理确认'
              : statusTone === 'failed'
                ? '执行失败'
                : link.label
        resolved.set(link.url, {
          kind: 'dispatch',
          label: link.label,
          url: link.url,
          roomId: link.roomId,
          linkId: link.linkId,
          ...(wb.threadId ? { threadId: wb.threadId } : {}),
          statusTone,
          statusText
        })
        return
      }

      resolved.set(link.url, {
        kind: 'room',
        label: link.label,
        url: link.url,
        roomId: link.roomId,
        ...(link.messageId ? { messageId: link.messageId } : {}),
        statusTone: 'idle'
      })
    }))
    return resolved
  }

  private async formatPage(day: string, markdown: string): Promise<RemoteDailyNotePage> {
    const parsed = parseDailyNoteTasks(markdown)
    const hydratedLinks = await this.hydrateLinks(parsed)
    const tasks: RemoteDailyNoteTask[] = parsed.map((task) => ({
      id: `${day}:${task.line}`,
      day,
      line: task.line,
      indent: task.indent,
      parentLine: task.parentLine,
      done: task.done,
      title: task.text,
      quadrant: task.quadrant,
      notes: task.notes,
      subLineCount: task.subLineCount,
      link: task.link ? (hydratedLinks.get(task.link.url) ?? null) : null
    }))
    const completed = tasks.filter((task) => task.done).length
    const prosePreview = tasks.length === 0 && markdown.trim().length > 0
      ? markdown.trim().slice(0, 280)
      : undefined
    return {
      day,
      revision: dailyNoteRevision(day, markdown),
      tasks,
      ...(prosePreview ? { prosePreview } : {}),
      completed,
      total: tasks.length
    }
  }

  async preflight(method: string, p: any): Promise<void> {
    const dir = await this.resolveDirectory()
    if (method === 'daily.notes.create') {
      if (p.expectedRevision !== undefined) {
        const current = await this.readDayMarkdown(dir, p.day)
        if (dailyNoteRevision(p.day, current) !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      }
      return
    }
    if (method === 'daily.notes.rollover') {
      if (p.expectedFromRevision !== undefined) {
        const current = await this.readDayMarkdown(dir, p.fromDay)
        if (dailyNoteRevision(p.fromDay, current) !== p.expectedFromRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      }
      return
    }
    const current = await this.readDayMarkdown(dir, p.day)
    if (dailyNoteRevision(p.day, current) !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    const hit = parseDailyNoteTasks(current).find((task) => task.line === p.line)
    if (!hit) throw new RemoteNoEffect('NOT_FOUND')
  }

  async list(p: { limitDays?: number; month?: string }): Promise<RemoteDailyNotesOverview> {
    const dir = await this.resolveDirectory()
    const today = localNoteDay()
    const diskDays = await this.listDiskDays(dir)
    const limitDays = p.limitDays ?? 14
    const targetMonth = p.month

    const summaryDaySet = new Set<string>([today, ...diskDays.slice(0, 90)])
    if (targetMonth) {
      for (const d of diskDays) {
        if (d.startsWith(targetMonth + '-')) summaryDaySet.add(d)
      }
    }
    const orderedDays = [...summaryDaySet].sort().reverse()
    const markdownByDay = new Map<string, string>()
    await Promise.all(orderedDays.map(async (day) => {
      markdownByDay.set(day, await this.readDayMarkdown(dir, day))
    }))

    const days: RemoteDailyNoteDaySummary[] = orderedDays
      .filter((day) => day === today || (markdownByDay.get(day) ?? '').trim().length > 0)
      .map((day) => summarizeDayMarkdown(day, markdownByDay.get(day) ?? ''))

    const recentDays = [
      today,
      ...orderedDays.filter((day) => day !== today && (markdownByDay.get(day) ?? '').trim().length > 0)
    ].slice(0, limitDays)

    const recentPages = await Promise.all(
      recentDays.map((day) => this.formatPage(day, markdownByDay.get(day) ?? ''))
    )

    return { today, days, recentPages }
  }

  async get(day: string): Promise<RemoteDailyNotePage> {
    const dir = await this.resolveDirectory()
    const markdown = await this.readDayMarkdown(dir, day)
    return this.formatPage(day, markdown)
  }

  async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const { method, requestId } = envelope.call
    if (method === 'daily.notes.list') return this.list(p)
    if (method === 'daily.notes.get') return this.get(p.day)

    const dir = await this.resolveDirectory()
    return this.withDirLock(dir, async () => {
      if (method === 'daily.notes.create') {
        const ledgerKey = createIdempotencyId(envelope, requestId)
        const ledger = await this.readCreateLedger(dir)
        if (ledger[ledgerKey]) {
          const existing = await this.readDayMarkdown(dir, p.day)
          return this.formatPage(p.day, existing)
        }
        const current = await this.readDayMarkdown(dir, p.day)
        if (p.expectedRevision !== undefined && dailyNoteRevision(p.day, current) !== p.expectedRevision) {
          throw new RemoteNoEffect('REVISION_CONFLICT')
        }
        const quadrant: DailyNoteQuadrant | null = p.quadrant ?? null
        const link = p.link ?? null
        let next = applyDailyNoteChange(current, appendDailyNoteTaskChange(current, p.title, quadrant, link))
        if (p.notes && p.notes.length > 0) {
          const appended = parseDailyNoteTasks(next).at(-1)
          if (appended) {
            const notesInsert = formatPlainNotesInsert(next, appended.indent, p.notes)
            if (notesInsert) {
              next = applyDailyNoteChange(next, { from: appended.end, to: appended.blockEnd, insert: notesInsert })
            }
          }
        }
        await this.writeDayMarkdown(dir, p.day, next)
        await this.writeCreateLedger(dir, ledgerKey, {
          day: p.day,
          revision: dailyNoteRevision(p.day, next),
          createdAt: Date.now()
        })
        return this.formatPage(p.day, next)
      }

      if (method === 'daily.notes.update') {
        let current = await this.readDayMarkdown(dir, p.day)
        if (dailyNoteRevision(p.day, current) !== p.expectedRevision) {
          throw new RemoteNoEffect('REVISION_CONFLICT')
        }
        let target = parseDailyNoteTasks(current).find((task) => task.line === p.line)
        if (!target) throw new RemoteNoEffect('NOT_FOUND')

        if (p.done !== undefined && target.done !== p.done) {
          current = applyDailyNoteChange(current, toggleDailyNoteTaskChange(target, p.done))
          target = parseDailyNoteTasks(current).find((task) => task.line === p.line)!
        }
        if (p.title !== undefined) {
          current = applyDailyNoteChange(current, setDailyNoteTaskTitleChange(target, p.title))
          target = parseDailyNoteTasks(current).find((task) => task.line === p.line)!
        }
        if (p.quadrant !== undefined) {
          current = applyDailyNoteChange(current, setDailyNoteTaskQuadrantChange(target, p.quadrant))
          target = parseDailyNoteTasks(current).find((task) => task.line === p.line)!
        }
        if (p.link !== undefined) {
          current = applyDailyNoteChange(current, setDailyNoteTaskLinkChange(target, p.link))
          target = parseDailyNoteTasks(current).find((task) => task.line === p.line)!
        }
        if (p.notes !== undefined) {
          const notesInsert = formatPlainNotesInsert(current, target.indent, p.notes)
          current = applyDailyNoteChange(current, { from: target.end, to: target.blockEnd, insert: notesInsert })
          target = parseDailyNoteTasks(current).find((task) => task.line === p.line)!
        }

        if (p.moveToDay !== undefined) {
          const destCurrent = await this.readDayMarkdown(dir, p.moveToDay)
          const { remaining, block } = cutTaskSubtree(current, target)
          const destNext = appendRawBlock(destCurrent, block)
          await this.writeDayMarkdown(dir, p.moveToDay, destNext)
          await this.writeDayMarkdown(dir, p.day, remaining)
          const [page, movedToPage] = await Promise.all([
            this.formatPage(p.day, remaining),
            this.formatPage(p.moveToDay, destNext)
          ])
          return { page, movedToPage } satisfies RemoteDailyNoteUpdateResult
        }

        await this.writeDayMarkdown(dir, p.day, current)
        return { page: await this.formatPage(p.day, current) } satisfies RemoteDailyNoteUpdateResult
      }

      if (method === 'daily.notes.delete') {
        const current = await this.readDayMarkdown(dir, p.day)
        if (dailyNoteRevision(p.day, current) !== p.expectedRevision) {
          throw new RemoteNoEffect('REVISION_CONFLICT')
        }
        const target = parseDailyNoteTasks(current).find((task) => task.line === p.line)
        if (!target) throw new RemoteNoEffect('NOT_FOUND')
        const { remaining } = cutTaskSubtree(current, target)
        await this.writeDayMarkdown(dir, p.day, remaining)
        return this.formatPage(p.day, remaining)
      }

      if (method === 'daily.notes.rollover') {
        const [fromMarkdown, toMarkdown] = await Promise.all([
          this.readDayMarkdown(dir, p.fromDay),
          this.readDayMarkdown(dir, p.toDay)
        ])
        if (p.expectedFromRevision !== undefined && dailyNoteRevision(p.fromDay, fromMarkdown) !== p.expectedFromRevision) {
          throw new RemoteNoEffect('REVISION_CONFLICT')
        }
        const { nextFrom, nextTo, movedCount } = rolloverIncompleteDailyNoteTasks(fromMarkdown, toMarkdown)
        if (movedCount > 0) {
          await this.writeDayMarkdown(dir, p.toDay, nextTo)
          await this.writeDayMarkdown(dir, p.fromDay, nextFrom)
        }
        const [fromPage, toPage] = await Promise.all([
          this.formatPage(p.fromDay, nextFrom),
          this.formatPage(p.toDay, nextTo)
        ])
        return { movedCount, fromPage, toPage } satisfies RemoteDailyNoteRolloverResult
      }

      throw new RemoteNoEffect('INVALID_REQUEST')
    })
  }

  async recover(scope: RemoteScope, receipt: Receipt): Promise<RemoteDailyNotePage | undefined> {
    if (receipt.method !== 'daily.notes.create') return undefined
    const day = receipt.params?.day
    if (typeof day !== 'string' || !isValidNoteDay(day)) return undefined
    const dir = await this.resolveDirectory().catch(() => null)
    if (!dir) return undefined
    const ledgerKey = createIdempotencyId(scope, receipt.requestId)
    const ledger = await this.readCreateLedger(dir)
    if (!ledger[ledgerKey]) return undefined
    const markdown = await this.readDayMarkdown(dir, day)
    return this.formatPage(day, markdown)
  }
}
