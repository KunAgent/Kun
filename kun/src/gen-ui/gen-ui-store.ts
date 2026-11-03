import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  GEN_UI_HTML_MAX_BYTES,
  isGenUiWidgetId,
  parseGenUiWidgetState,
  utf8ByteLength,
  type GenUiStateEntry,
  type GenUiWidgetState
} from '../contracts/gen-ui.js'

const MAX_STATE_ENTRIES_PER_THREAD = 200

type StateFile = {
  version: 1
  entries: GenUiStateEntry[]
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

/**
 * Durable storage for generated widgets. Widget HTML is content addressed and
 * immutable, so a card in history always renders the snapshot it was created
 * with. Widget state is a per-thread JSON file of page-submitted snapshots;
 * only the runtime writes it and every write replaces one entry atomically.
 */
export class GenUiStore {
  private readonly widgetsDir: string
  private readonly stateDir: string
  private readonly stateQueues = new Map<string, Promise<unknown>>()

  constructor(root: string, private readonly nowIso: () => string = () => new Date().toISOString()) {
    this.widgetsDir = join(root, 'widgets')
    this.stateDir = join(root, 'state')
  }

  async putWidget(html: string): Promise<{ widgetId: string; sha256: string; bytes: number }> {
    const bytes = utf8ByteLength(html)
    if (bytes === 0 || bytes > GEN_UI_HTML_MAX_BYTES) throw new Error('widget HTML is empty or too large')
    const digest = sha256(html)
    const widgetId = `gw_${digest}`
    await mkdir(this.widgetsDir, { recursive: true, mode: 0o700 })
    const path = join(this.widgetsDir, `${digest}.html`)
    try {
      await readFile(path)
    } catch (error) {
      if (!isMissing(error)) throw error
      await writeAtomic(path, html)
    }
    return { widgetId, sha256: digest, bytes }
  }

  async readWidget(widgetId: string): Promise<string | null> {
    if (!isGenUiWidgetId(widgetId)) return null
    try {
      return await readFile(join(this.widgetsDir, `${widgetId.slice(3)}.html`), 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async readState(threadId: string): Promise<GenUiStateEntry[]> {
    return (await this.readStateFile(threadId)).entries
  }

  async writeState(threadId: string, widgetId: string, state: unknown): Promise<GenUiStateEntry> {
    if (!isGenUiWidgetId(widgetId)) throw new Error('invalid widget id')
    const normalized: GenUiWidgetState = parseGenUiWidgetState(state)
    return this.enqueue(threadId, async () => {
      const file = await this.readStateFile(threadId)
      const entry: GenUiStateEntry = { widgetId, state: normalized, updatedAt: this.nowIso() }
      const entries = [...file.entries.filter((candidate) => candidate.widgetId !== widgetId), entry]
        .slice(-MAX_STATE_ENTRIES_PER_THREAD)
      await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
      await writeAtomic(this.statePath(threadId), JSON.stringify({ version: 1, entries } satisfies StateFile))
      return entry
    })
  }

  async copyThreadState(sourceThreadId: string, targetThreadId: string): Promise<void> {
    await this.enqueue(targetThreadId, async () => {
      try {
        await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
        await copyFile(this.statePath(sourceThreadId), this.statePath(targetThreadId))
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    })
  }

  async deleteThreadState(threadId: string): Promise<void> {
    await this.enqueue(threadId, () => rm(this.statePath(threadId), { force: true }))
  }

  private statePath(threadId: string): string {
    return join(this.stateDir, `${sha256(threadId).slice(0, 40)}.json`)
  }

  private async readStateFile(threadId: string): Promise<StateFile> {
    let raw: string
    try {
      raw = await readFile(this.statePath(threadId), 'utf8')
    } catch (error) {
      if (isMissing(error)) return { version: 1, entries: [] }
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StateFile>
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.filter((entry): entry is GenUiStateEntry =>
          Boolean(entry) && isGenUiWidgetId(entry.widgetId) && typeof entry.updatedAt === 'string')
        : []
      return { version: 1, entries }
    } catch {
      return { version: 1, entries: [] }
    }
  }

  private enqueue<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.stateQueues.get(threadId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    const settled = next.finally(() => {
      if (this.stateQueues.get(threadId) === settled) this.stateQueues.delete(threadId)
    })
    this.stateQueues.set(threadId, settled)
    return next
  }
}
