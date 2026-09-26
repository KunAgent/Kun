import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import {
  buildWindowInitializationText,
  CONTEXT_WINDOW_TOOL_USAGE_INSTRUCTIONS
} from './context-window-initialization.js'

const OLD_WINDOW_SECRET = 'OLD-WINDOW-SECRET-TEXT'
const NOTE_SECRET = 'SECRET-NOTE-CONTENT'
const STABLE_PREFIX_TEXT = 'stable system prefix bytes'

describe('buildWindowInitializationText', () => {
  let dataDir: string
  let service: ContextWindowService

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-init-'))
    const sessionStore = new InMemorySessionStore()
    service = new ContextWindowService({
      sessionStore,
      notes: new ContextWindowNotes({
        store: new FileContextWindowStore({
          dataDir,
          limits: {
            maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
            maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
            maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
          }
        })
      })
    })
    const message = (id: string, text: string): TurnItem => ({
      id, turnId: 'turn-1', threadId: 'threadA',
      kind: 'user_message', role: 'user', status: 'completed',
      createdAt: '2026-09-14T00:00:00.000Z', text
    })
    await sessionStore.appendItem('threadA', message('u1', `first ${OLD_WINDOW_SECRET}`))
    for (let index = 1; index <= 3; index += 1) {
      await service.commitWindowCheckpoint({
        threadId: 'threadA', turnId: 'turn-1', windowId: `win-${index}`,
        reason: 'model', initializationRef: `init-${index}`, operationId: `op-${index}`
      })
    }
    await sessionStore.appendItem('threadA', message('u-task', 'current task'))
    await service.notes.writeFile('threadA', {
      path: 'progress/log.md', text: NOTE_SECRET, expectedRevision: 0
    })
    await service.notes.writeFile('threadA', {
      path: 'progress/plan.md', text: NOTE_SECRET, expectedRevision: 0
    })
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('carries task anchor, capacity, bounded pointers, and tool instructions', async () => {
    const text = await buildWindowInitializationText({
      service,
      threadId: 'threadA',
      windowId: 'win-3',
      windowSeq: 3,
      taskMessageId: 'u-task',
      remainingTokens: 640_000,
      capacityTokens: 1_000_000
    })
    expect(text).toContain('[context window 3 (win-3) initialized]')
    expect(text).toContain('640k of 1000k tokens')
    expect(text).toContain('Current task message: u-task')
    // Bounded pointers: at most the 3 most recent windows.
    const windowLines = text.split('\n').filter((line) => line.startsWith('- window '))
    expect(windowLines).toHaveLength(3)
    expect(windowLines[0]).toContain('win-3')
    expect(text).toContain('- progress/log.md (revision 1,')
    expect(text).toContain('- progress/plan.md (revision 1,')
    expect(text).toContain(CONTEXT_WINDOW_TOOL_USAGE_INSTRUCTIONS)
  })

  it('never inlines note bodies or old conversation text and leaves the prefix alone', async () => {
    const text = await buildWindowInitializationText({
      service,
      threadId: 'threadA',
      windowId: 'win-3',
      windowSeq: 3,
      taskMessageId: 'u-task',
      remainingTokens: 640_000,
      capacityTokens: 1_000_000
    })
    // The stable system prefix is a separate immutable structure; the
    // initialization text is standalone and must not contain it or mutate it.
    expect(text).not.toContain(STABLE_PREFIX_TEXT)
    // No wholesale note injection and no old-window conversation leakage:
    // only ids, counts, revisions, and sizes cross into the new window.
    expect(text).not.toContain(NOTE_SECRET)
    expect(text).not.toContain(OLD_WINDOW_SECRET)
    expect(text).toContain('historical evidence')
  })

  it('points at an empty thread without fabricating entries', async () => {
    const text = await buildWindowInitializationText({
      service,
      threadId: 'threadB',
      windowId: 'win-0',
      windowSeq: 0,
      taskMessageId: 'u-first',
      remainingTokens: 1_000,
      capacityTokens: 1_000_000
    })
    expect(text).toContain('[context window 0 (win-0) initialized]')
    expect(text.split('\n').filter((line) => line === '- (none yet)')).toHaveLength(2)
  })
})
