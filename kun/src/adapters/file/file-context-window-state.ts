import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { assertSafeThreadId } from '../../contracts/thread-id.js'
import { atomicWriteFile } from './atomic-write.js'
import {
  PersistedWindowStateSchema,
  type ContextWindowStateStore,
  type PersistedWindowState
} from '../../services/context-window-state.js'

/**
 * File-backed per-thread window state. One small JSON document per thread,
 * rewritten atomically on every transition/budget change so a crash can
 * never leave a torn record behind.
 */
export class FileContextWindowStateStore implements ContextWindowStateStore {
  private readonly dataDir: string

  constructor(options: { dataDir: string }) {
    this.dataDir = resolve(options.dataDir, 'threads')
  }

  async load(threadId: string): Promise<PersistedWindowState | null> {
    assertSafeThreadId(threadId)
    let raw: string
    try {
      raw = await readFile(this.statePath(threadId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let parsed: ReturnType<typeof PersistedWindowStateSchema.safeParse>
    try {
      parsed = PersistedWindowStateSchema.safeParse(JSON.parse(raw))
    } catch {
      return null
    }
    return parsed.success ? parsed.data : null
  }

  async save(state: PersistedWindowState): Promise<void> {
    assertSafeThreadId(state.threadId)
    const path = this.statePath(state.threadId)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await atomicWriteFile(path, JSON.stringify(state))
  }

  async deleteThreadData(threadId: string): Promise<void> {
    assertSafeThreadId(threadId)
    await rm(this.statePath(threadId), { force: true })
  }

  private statePath(threadId: string): string {
    return join(this.dataDir, threadId, 'context-window-state.json')
  }
}
