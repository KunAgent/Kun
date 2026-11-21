import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLAB_DRIVE_PULL_SESSION_PREFIX,
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  COLAB_NOTEBOOK_MARKER
} from '../../shared/colab/colab-notebook-types'
import { activeDrivePullSessions, ColabDriveNotebookManager, parseDriveMarkerLines } from './colab-drive-notebooks'
import type { ColabService } from './colab-service'
import { normalizeWorkspaceKey } from './colab-state-store'

const entry = {
  name: 'train.ipynb', relativePath: 'experiments/train.ipynb',
  remotePath: '/content/drive/MyDrive/experiments/train.ipynb', sizeBytes: 150, modifiedAtMs: 0
}
const pullId = 'test-pull'
const accountId = 'test-account'
const inUseSession = 'editor-session'

function fakeHelper() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), killed: false,
    kill: vi.fn(() => {
      child.killed = true
      queueMicrotask(() => child.emit('close', null))
      return true
    })
  })
  return Object.assign(child, {
    marker(kind: string, body: string) { child.stdout.write(`${COLAB_NOTEBOOK_MARKER}${kind}:${body}\n`) },
    finish() { child.emit('close', 0) }
  })
}

function fixture(workspaceRoot: string) {
  const runCommand = vi.fn<ColabService['cli']['runCommand']>()
  const helpers: Array<ReturnType<typeof fakeHelper>> = []
  const launch = vi.fn((_python: string, _args: string[]) => {
    const child = fakeHelper()
    helpers.push(child)
    return child as unknown as ChildProcess
  })
  const openExternal = vi.fn(async (_url: string) => undefined)
  const manager = new ColabDriveNotebookManager({
    getSnapshot: async () => ({
      connections: [{ id: accountId, status: 'connected' }],
      sessions: [{
        id: 'editor', workspaceRoot: normalizeWorkspaceKey(workspaceRoot), connectionId: accountId,
        sessionName: inUseSession, phase: 'running', entryCommand: COLAB_NOTEBOOK_ENTRY_COMMAND
      }]
    }),
    cli: { ensureInstalled: async () => ({ state: 'ready' }), venvPythonPath: '/test/python', runCommand },
    credentials: { materializeRuntimeToken: async () => '/test/runtime-token', syncRuntimeTokenBack: async () => undefined },
    isolation: { prepareConnectionEnvironment: async () => ({ paths: { sessionsJsonPath: '/test/sessions.json' }, env: {} }) }
  } as unknown as ColabService, openExternal, launch as unknown as typeof spawn)
  return { manager, helpers, runCommand, launch, openExternal }
}

let workspaceRoot: string
let harness: ReturnType<typeof fixture>

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-drive-pull-'))
  harness = fixture(workspaceRoot)
})

afterEach(async () => {
  for (const helper of harness.helpers) helper.finish()
  try {
    await harness.manager.shutdown()
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

describe('Colab Drive pulls', () => {
  it('authorizes and copies on helper kernels without changing or stopping the borrowed session', async () => {
    const { manager, helpers, launch, runCommand, openExternal } = harness
    const start = manager.startPull({ pullId, workspaceRoot, connectionId: accountId, runtime: { sessionId: 'editor' } })
    await vi.waitFor(() => expect(helpers).toHaveLength(1))
    const authUrl = 'https://accounts.google.com/example'
    helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: authUrl }))
    expect(await start).toMatchObject({ ok: true, status: 'needs_auth', authUrl })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(authUrl)
    const authReply = vi.fn()
    helpers[0].stdin.on('data', authReply)
    const auth = manager.completeAuth({ pullId })
    expect(authReply.mock.calls[0][0].toString()).toBe('CONTINUE\n')
    helpers[0].marker('DRV_LIST', JSON.stringify([entry]))
    helpers[0].finish()
    expect(await auth).toEqual({ ok: true, status: 'ready', entries: [entry] })

    const original = JSON.stringify({ cells: [], metadata: { original: true }, nbformat: 4 })
    const copy = JSON.stringify({ cells: [], metadata: { fromDrive: true }, nbformat: 4 })
    await writeFile(join(workspaceRoot, entry.name), original)
    const importing = manager.importDriveNotebook({ pullId, remotePath: entry.remotePath })
    await vi.waitFor(() => expect(helpers).toHaveLength(2))
    helpers[1].marker('DRV_FILE', Buffer.from(copy).toString('base64'))
    helpers[1].finish()
    expect(await importing).toEqual({ ok: true, file: {
      relativePath: 'train (Colab).ipynb', remotePath: entry.remotePath, disposition: 'renamed'
    } })
    expect(await readFile(join(workspaceRoot, entry.name), 'utf8')).toBe(original)
    expect(await readFile(join(workspaceRoot, 'train (Colab).ipynb'), 'utf8')).toBe(copy)
    expect(await manager.closePull(pullId)).toEqual({ ok: true, stoppedTemporary: false })
    expect(runCommand).not.toHaveBeenCalled()
    for (const [, [flag, script]] of launch.mock.calls) {
      expect(flag).toBe('-c')
      expect(script).toContain(`state.get_session("${inUseSession}"`)
      expect(script).toContain('ColabRuntime(s.url, s.token)')
      expect(script).not.toMatch(/s\.(?:session_id|kernel_id)|state\.store\.add/)
      expect(script).toContain('runtime.stop(shutdown_kernel=True)')
    }
  })

  it('cancels a pending CPU allocation and retries only the exact temporary session if cleanup is unconfirmed', async () => {
    const { manager, runCommand, launch } = harness
    let finishAllocation!: () => void
    runCommand.mockImplementationOnce(() => new Promise((resolve) => {
      finishAllocation = () => resolve({ exitCode: 0, stdout: '', stderr: '' })
    })).mockResolvedValueOnce({ exitCode: 0, stdout: 'Session not found.', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Session terminated.', stderr: '' })
    const starting = manager.startPull({ pullId, workspaceRoot, connectionId: accountId, runtime: { temporaryCpu: true } })
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(1))
    const name = runCommand.mock.calls[0][0].args[2]
    expect(name.startsWith(COLAB_DRIVE_PULL_SESSION_PREFIX)).toBe(true)
    expect(runCommand.mock.calls[0][0].args).toEqual(['new', '-s', name])
    expect(activeDrivePullSessions.has(name)).toBe(true)

    const closing = manager.closePull(pullId)
    expect(runCommand).toHaveBeenCalledTimes(1)
    finishAllocation()
    expect(await starting).toMatchObject({ ok: false, code: 'canceled' })
    expect(await closing).toMatchObject({ ok: false })
    expect(activeDrivePullSessions.has(name)).toBe(true)
    expect(await manager.closePull(pullId)).toEqual({ ok: true, stoppedTemporary: true })
    expect(runCommand.mock.calls.slice(1).map(([call]) => call.args)).toEqual([['stop', '-s', name], ['stop', '-s', name]])
    expect(activeDrivePullSessions.has(name)).toBe(false)
    expect(launch).not.toHaveBeenCalled()
  })

  it('stops reading and keeps the original file when the pull is cancelled mid-copy', async () => {
    const { manager, helpers } = harness
    const start = manager.startPull({ pullId, workspaceRoot, connectionId: accountId, runtime: { sessionId: 'editor' } })
    await vi.waitFor(() => expect(helpers).toHaveLength(1))
    helpers[0].marker('DRV_LIST', JSON.stringify([entry]))
    helpers[0].finish()
    expect(await start).toMatchObject({ ok: true, status: 'ready' })

    const original = JSON.stringify({ cells: [], metadata: { original: true }, nbformat: 4 })
    await writeFile(join(workspaceRoot, entry.name), original)
    const importing = manager.importDriveNotebook({ pullId, remotePath: entry.remotePath })
    await vi.waitFor(() => expect(helpers).toHaveLength(2))
    const closing = manager.closePull(pullId)
    expect(await importing).toMatchObject({ ok: false, code: 'canceled' })
    expect(helpers[1].kill).toHaveBeenCalled()
    await closing
    expect(await readFile(join(workspaceRoot, entry.name), 'utf8')).toBe(original)
    await expect(readFile(join(workspaceRoot, 'train (Colab).ipynb'))).rejects.toThrow()
  })

  it('imports a same-name local notebook as a copy without overwriting the project file', async () => {
    const { manager } = harness
    const sourceDir = await mkdtemp(join(tmpdir(), 'kun-drive-local-'))
    try {
      const original = JSON.stringify({ cells: [], metadata: { original: true }, nbformat: 4 })
      const incoming = JSON.stringify({ cells: [], metadata: { incoming: true }, nbformat: 4 })
      await writeFile(join(workspaceRoot, 'train_v1.ipynb'), original)
      const extFile = join(sourceDir, 'train_v1.ipynb')
      await writeFile(extFile, incoming)
      expect(await manager.importLocalNotebooks({ workspaceRoot, localPaths: [extFile] }))
        .toEqual({ ok: true, relativePaths: ['train_v1 (2).ipynb'] })
      expect(await readFile(join(workspaceRoot, 'train_v1.ipynb'), 'utf8')).toBe(original)
      expect(await readFile(join(workspaceRoot, 'train_v1 (2).ipynb'), 'utf8')).toBe(incoming)
    } finally {
      await rm(sourceDir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed notebook list instead of returning an empty result', () => {
    for (const payload of ['null', '{}', '"text"']) {
      expect(parseDriveMarkerLines(`${COLAB_NOTEBOOK_MARKER}DRV_LIST:${payload}`)).toEqual({
        kind: 'error', message: 'Invalid notebook list payload.'
      })
    }
  })
})
