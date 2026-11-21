import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { FileAttachmentStore, type AttachmentContent, type AttachmentStore } from '../../attachments/attachment-store.js'
import { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import { TurnSchema } from '../../contracts/turns.js'
import { makeUserItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import { png } from '../../../tests/support/attachment-store-fixtures.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore
} from '../delegated-session-binding.js'
import { removeAntigravityAttachmentDirectory } from './antigravity-attachments.js'
import { AntigravityCliRuntime } from './antigravity-cli-runtime.js'

const tempDirs: string[] = []
const stagedThreads = new Set<string>()

afterEach(async () => {
  for (const threadId of stagedThreads) {
    await removeAntigravityAttachmentDirectory(threadId)
  }
  stagedThreads.clear()
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function scriptedSpawn(
  steps: Array<{ stdout?: string; stderr?: string; exitCode?: number }>,
  calls: Array<readonly string[]>
): typeof spawn {
  let index = 0
  return ((_command: string, args: readonly string[]) => {
    calls.push([...args])
    const step = steps[Math.min(index, steps.length - 1)]!
    index += 1
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: () => boolean
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      if (step.stdout) child.stdout.write(step.stdout)
      child.stdout.end()
      if (step.stderr) child.stderr.write(step.stderr)
      child.stderr.end()
      child.emit('exit', step.exitCode ?? 0, null)
    })
    return child as unknown as ChildProcess
  }) as typeof spawn
}

async function createAttachmentTestHarness(options?: {
  attachmentStore?: AttachmentStore | null
  steps?: Array<{ stdout?: string; stderr?: string; exitCode?: number }>
}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-agy-attachments-'))
  tempDirs.push(root)
  const workspace = join(root, 'workspace')
  await mkdtemp(join(root, 'ws-'))
  const config = KunCapabilitiesConfig.parse({ attachments: { enabled: true } })
  const defaultStore = new FileAttachmentStore({
    rootDir: join(root, 'store'),
    config: config.attachments
  })
  const attachmentStore = options?.attachmentStore === null
    ? undefined
    : (options?.attachmentStore ?? defaultStore)
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const coordinator = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(join(root, 'bindings'))
  )
  const calls: Array<readonly string[]> = []
  let seq = 0
  const turns = {
    applyItem: vi.fn(async (threadId: string, item: Parameters<InMemorySessionStore['appendItem']>[1]) => {
      await sessionStore.appendItem(threadId, item)
    }),
    applyAssistantDelta: vi.fn(async () => undefined),
    updateTurnMetadata: vi.fn(async () => undefined),
    finishTurn: vi.fn(async () => undefined)
  } as unknown as TurnService
  const runtime = new AntigravityCliRuntime({
    providerConfigs: {},
    providerIds: new Set(['gemini-subscription']),
    defaultIsAntigravity: false,
    threadStore,
    sessionStore,
    turns,
    events: {
      record: vi.fn(async (_event: RuntimeEvent) => undefined)
    } as unknown as RuntimeEventRecorder,
    ids: { next: (prefix) => `${prefix}_${++seq}` },
    ...(attachmentStore ? { attachmentStore } : {}),
    sessionCoordinator: coordinator,
    spawnFn: scriptedSpawn(
      options?.steps ?? [{
        stdout: JSON.stringify({
          conversation_id: 'conv-agy-att',
          status: 'SUCCESS',
          response: 'Inspected attachment'
        })
      }],
      calls
    )
  })
  return { root, workspace, store: defaultStore, threadStore, sessionStore, runtime, calls }
}

describe('AntigravityCliRuntime attachments and file references', () => {
  it('stages pasted image attachments read-only, passes --add-dir, and supports empty-text image turns', async () => {
    const h = await createAttachmentTestHarness()
    const threadId = 'thread_img_only'
    stagedThreads.add(threadId)
    const imageBytes = png(16, 12)
    const created = await h.store.create({
      name: 'clipboard-screenshot.png',
      data: imageBytes,
      mimeType: 'image/png',
      threadId,
      workspace: h.root
    })
    const turn = TurnSchema.parse({
      id: 'turn_1',
      threadId,
      status: 'running',
      prompt: '',
      model: 'gemini-3.6-flash',
      attachmentIds: [created.id],
      createdAt: '2026-11-16T00:00:00.000Z'
    })
    await h.threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Image turn',
        workspace: h.root,
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({
        id: 'item_user_1',
        threadId,
        turnId: turn.id,
        text: '',
        attachmentIds: [created.id]
      })
    )

    await expect(
      h.runtime.runTurn(threadId, turn.id, new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    const args = h.calls[0]!
    const addDirIdx = args.indexOf('--add-dir')
    expect(addDirIdx).toBeGreaterThan(-1)
    const stagedDir = args[addDirIdx + 1]!
    const stagedPath = join(stagedDir, `${created.id}.png`)
    expect(await readFile(stagedPath)).toEqual(imageBytes)
    if (process.platform !== 'win32') {
      expect((await stat(stagedPath)).mode & 0o777).toBe(0o400)
    }

    const prompt = String(args[1] ?? '')
    expect(prompt).toContain('clipboard-screenshot.png (image/png, 16x12)')
    expect(prompt).toContain(stagedPath)
  })

  it('inlines pasted text documents without adding --add-dir when no binary file is staged', async () => {
    const h = await createAttachmentTestHarness()
    const threadId = 'thread_doc_inline'
    stagedThreads.add(threadId)
    const body = 'PASTE-START\n第一行内容\nPASTE-END'
    const doc = await h.store.create({
      name: 'pasted-text-20261116.txt',
      data: Buffer.from(body, 'utf8'),
      mimeType: 'text/plain',
      documentText: body,
      documentFormat: 'text',
      threadId,
      workspace: h.root
    })
    const turn = TurnSchema.parse({
      id: 'turn_doc',
      threadId,
      status: 'running',
      prompt: '总结附件内容',
      model: 'gemini-3.6-flash',
      attachmentIds: [doc.id],
      createdAt: '2026-11-16T00:00:00.000Z'
    })
    await h.threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Doc turn',
        workspace: h.root,
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({
        id: 'item_doc_user',
        threadId,
        turnId: turn.id,
        text: turn.prompt,
        attachmentIds: [doc.id]
      })
    )

    await expect(
      h.runtime.runTurn(threadId, turn.id, new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    const args = h.calls[0]!
    expect(args).not.toContain('--add-dir')
    const prompt = String(args[1] ?? '')
    expect(prompt).toContain('<attached_document name="pasted-text-20261116.txt" mime="text/plain">')
    expect(prompt).toContain(body)
  })

  it('stages scanned PDFs with empty extracted text so agy can read them directly', async () => {
    const pdfBytes = Buffer.from('%PDF-1.7 scanned page bytes', 'utf8')
    const fakePdfStore: AttachmentStore = {
      resolveContent: async (id: string): Promise<AttachmentContent> => ({
        id,
        name: 'scanned-spec.pdf',
        kind: 'document',
        mimeType: 'application/pdf',
        documentFormat: 'pdf',
        documentText: '',
        byteSize: pdfBytes.byteLength,
        hash: 'pdfhash',
        threadIds: ['thread_pdf'],
        workspaces: ['/tmp'],
        createdAt: '2026-11-16T00:00:00.000Z',
        updatedAt: '2026-11-16T00:00:00.000Z',
        data: pdfBytes
      })
    } as unknown as AttachmentStore
    const h = await createAttachmentTestHarness({ attachmentStore: fakePdfStore })
    const threadId = 'thread_pdf'
    stagedThreads.add(threadId)
    const turn = TurnSchema.parse({
      id: 'turn_pdf',
      threadId,
      status: 'running',
      prompt: '读取这份扫描版PDF',
      model: 'gemini-3.6-flash',
      createdAt: '2026-11-16T00:00:00.000Z'
    })
    await h.threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'PDF turn',
        workspace: h.root,
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({
        id: 'item_pdf_user',
        threadId,
        turnId: turn.id,
        text: turn.prompt,
        attachmentIds: ['att_scanned_pdf']
      })
    )

    await expect(
      h.runtime.runTurn(threadId, turn.id, new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    const args = h.calls[0]!
    const addDirIdx = args.indexOf('--add-dir')
    expect(addDirIdx).toBeGreaterThan(-1)
    const stagedPdf = join(args[addDirIdx + 1]!, 'att_scanned_pdf.pdf')
    expect(await readFile(stagedPdf)).toEqual(pdfBytes)
    expect(String(args[1] ?? '')).toContain(`scanned-spec.pdf (application/pdf): ${stagedPdf}`)
    expect(String(args[1] ?? '')).not.toContain('could not be read')
  })

  it('redacts private host filenames under attachmentAliases, filters outside fileReferences, and reports missing attachments', async () => {
    const h = await createAttachmentTestHarness()
    const threadId = 'thread_privacy'
    stagedThreads.add(threadId)
    const secretImage = await h.store.create({
      name: 'PRIVATE_HOST_NAME.png',
      data: png(8, 8),
      mimeType: 'image/png',
      localFilePath: join(h.root, 'PRIVATE_HOST_NAME.png'),
      threadId,
      workspace: h.root
    })
    const turn = TurnSchema.parse({
      id: 'turn_privacy',
      threadId,
      status: 'running',
      prompt: 'check files',
      model: 'gemini-3.6-flash',
      createdAt: '2026-11-16T00:00:00.000Z'
    })
    await h.threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Privacy turn',
        workspace: h.root,
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({
        id: 'item_privacy_user',
        threadId,
        turnId: turn.id,
        text: turn.prompt,
        attachmentIds: [secretImage.id, 'att_missing_00000000000000'],
        attachmentAliases: [{ attachmentId: secretImage.id, displayName: 'visitor.png' }],
        fileReferences: [
          { path: join(h.root, 'src/index.ts'), relativePath: 'src/index.ts', name: 'index.ts', kind: 'file' },
          { path: '/etc/passwd', relativePath: '../../etc/passwd', name: 'passwd', kind: 'file' }
        ]
      })
    )

    await expect(
      h.runtime.runTurn(threadId, turn.id, new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    const prompt = String(h.calls[0]?.[1] ?? '')
    expect(prompt).toContain('visitor.png (image/png, 8x8)')
    expect(prompt).not.toContain('PRIVATE_HOST_NAME')
    expect(prompt).toContain('att_missing_00000000000000')
    expect(prompt).toContain('could not be read')
    expect(prompt).toContain(`src/index.ts: ${join(h.root, 'src/index.ts')}`)
    expect(prompt).not.toContain('/etc/passwd')
  })

  it('retains --add-dir across resumed turns and stale-session rejectResume retries', async () => {
    const h = await createAttachmentTestHarness({
      steps: [
        {
          stdout: JSON.stringify({
            conversation_id: 'conv-stale-1',
            status: 'SUCCESS',
            response: 'First answer'
          })
        },
        {
          exitCode: 1,
          stderr: 'conversation conv-stale-1 not found'
        },
        {
          stdout: JSON.stringify({
            conversation_id: 'conv-fresh-2',
            status: 'SUCCESS',
            response: 'Recovered answer'
          })
        }
      ]
    })
    const threadId = 'thread_resume_att'
    stagedThreads.add(threadId)
    const img = await h.store.create({
      name: 'diagram.png',
      data: png(10, 10),
      mimeType: 'image/png',
      threadId,
      workspace: h.root
    })
    const turn1 = TurnSchema.parse({
      id: 'turn_1',
      threadId,
      status: 'running',
      prompt: 'inspect diagram',
      model: 'gemini-3.6-flash',
      createdAt: '2026-11-16T00:00:00.000Z'
    })
    await h.threadStore.upsert({
      ...createThreadRecord({
        id: threadId,
        title: 'Resume attachment dir',
        workspace: h.root,
        model: 'gemini-3.6-flash',
        providerId: 'gemini-subscription',
        status: 'running'
      }),
      turns: [turn1]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({
        id: 'item_u1',
        threadId,
        turnId: 'turn_1',
        text: 'inspect diagram',
        attachmentIds: [img.id]
      })
    )
    await expect(
      h.runtime.runTurn(threadId, 'turn_1', new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    const firstArgs = h.calls[0]!
    const stagedDir = firstArgs[firstArgs.indexOf('--add-dir') + 1]!
    expect(stagedDir).toBeTruthy()

    const turn2 = TurnSchema.parse({
      id: 'turn_2',
      threadId,
      status: 'running',
      prompt: 're-check upper right corner',
      model: 'gemini-3.6-flash',
      createdAt: '2026-11-16T00:01:00.000Z'
    })
    await h.threadStore.upsert({
      ...(await h.threadStore.get(threadId))!,
      turns: [turn1, turn2]
    })
    await h.sessionStore.appendItem(
      threadId,
      makeUserItem({ id: 'item_u2', threadId, turnId: 'turn_2', text: 're-check upper right corner' })
    )
    await expect(
      h.runtime.runTurn(threadId, 'turn_2', new AbortController().signal, 'gemini-subscription')
    ).resolves.toBe('completed')

    expect(h.calls).toHaveLength(3)
    expect(h.calls[1]).toEqual(expect.arrayContaining(['--conversation', 'conv-stale-1', '--add-dir', stagedDir]))
    expect(h.calls[2]).toEqual(expect.arrayContaining(['--add-dir', stagedDir]))
    expect(h.calls[2]).not.toContain('--conversation')
  })
})
