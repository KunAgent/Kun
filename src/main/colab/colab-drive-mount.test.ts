import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  COLAB_NOTEBOOK_MARKER,
  type ColabDriveMountState,
  type ColabNotebookExecEvent
} from '../../shared/colab/colab-notebook-types'
import type { ColabStateSnapshot } from '../../shared/colab/colab-types'
import {
  ColabDriveMountManager,
  parseDriveMountMarkerLine,
  sanitizeDriveMountPoint
} from './colab-drive-mount'
import {
  buildArtifactListPython,
  buildFlushMountedDriveIfPresentPython,
  isGoogleDriveRemotePath,
  parseArtifactListOutput,
  resolveColabRemoteDir,
  runSessionDriveFlushHelper,
  runSessionDriveMountHelper
} from './colab-drive-protocol'
import {
  buildNotebookCellPython,
  cellUnmountsDrive,
  ColabNotebookKernel,
  detectCellDriveMount
} from './colab-notebook-kernel'
import {
  downloadArtifactsFromColabSession,
  normalizeColabUploadTargetDir,
  uploadFilesToColabSession
} from './colab-remote-reconciler'
import type { ColabService } from './colab-service'
import { ColabSessionExecutor } from './colab-session-executor'
import { buildInstallVmWatchdogPython } from './colab-watchdog-guard'
import { resolveWorkspaceOutputLocalDir, sanitizeOutputLocalDir } from './colab-workspace-sync'

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      queueMicrotask(() => child.emit('close', null))
      return true
    })
  })
  return Object.assign(child, {
    marker(kind: string, body: string) {
      child.stdout.write(`${COLAB_NOTEBOOK_MARKER}${kind}:${body}\n`)
    },
    finish(code = 0) {
      child.emit('close', code)
    }
  })
}

function createHarness() {
  let sessionPhase: 'running' | 'stopped' = 'running'
  const snapshotListeners = new Set<(snap: ColabStateSnapshot) => void>()
  const helpers: Array<ReturnType<typeof fakeProcess>> = []
  const execProcs: Array<ReturnType<typeof fakeProcess>> = []

  const spawnHelper = vi.fn((_py: string, _args: string[]) => {
    const p = fakeProcess()
    helpers.push(p)
    return p as unknown as ChildProcess
  })
  const spawnStreamingCommand = vi.fn(() => {
    const p = fakeProcess()
    execProcs.push(p)
    return p as unknown as ChildProcess
  })
  const openExternal = vi.fn(async (_url: string) => undefined)

  const currentSnapshot = (): ColabStateSnapshot => ({
    cli: { state: 'ready', version: '0.1.0', pythonVersion: '3.12', venvPath: '/tmp/venv' },
    connections: [
      {
        id: 'conn-1',
        name: 'Main',
        email: 'u@example.com',
        avatarColor: '#4f6bed',
        status: 'connected',
        planLabel: 'Colab Pro',
        balanceCu: 50,
        burnRateCuPerHour: 0.1,
        createdAt: '',
        updatedAt: '',
        activeSessions: []
      }
    ],
    workspaceConnections: {},
    oauthPending: null,
    lastLoginOutcome: null,
    sessions: [
      {
        id: 'sess-1',
        sessionName: 'kun-nb-1',
        connectionId: 'conn-1',
        connectionName: 'Main',
        connectionEmail: 'u@example.com',
        connectionAvatarColor: '#4f6bed',
        workspaceRoot: '/work/proj',
        entryCommand: COLAB_NOTEBOOK_ENTRY_COMMAND,
        accelerator: 'CPU',
        phase: sessionPhase,
        provisioningStep: 'start',
        startedAt: '2026-11-25T10:00:00Z',
        elapsedSeconds: 10,
        burnRateCuPerHour: 0.1,
        consumedCu: 0,
        estimatedTotalCu: 0.2,
        ramGb: 12.7,
        vramGb: null,
        gpuUtilizationPct: null,
        vramUsedGb: null,
        uploadTransferredBytes: 0,
        uploadTotalBytes: 0,
        gpuHistory: [],
        maxRuntimeHours: 2,
        autoStop: true,
        mountDrive: false,
        syncPaths: [],
        outputRemoteDir: '',
        outputLocalDir: '',
        artifacts: [],
        metrics: {},
        logTail: []
      }
    ],
    untrackedSessions: [],
    lastRunsByWorkspace: {}
  })

  const service = {
    subscribe: (fn: (snap: ColabStateSnapshot) => void) => {
      snapshotListeners.add(fn)
      return () => snapshotListeners.delete(fn)
    },
    getSnapshot: async () => currentSnapshot(),
    cli: {
      ensureInstalled: async () => ({ state: 'ready' }),
      venvPythonPath: '/test/venv/bin/python',
      spawnStreamingCommand
    },
    credentials: {
      materializeRuntimeToken: async () => '/tmp/cred.json',
      syncRuntimeTokenBack: async () => undefined
    },
    isolation: {
      prepareConnectionEnvironment: async () => ({
        paths: { sessionsJsonPath: '/tmp/sessions.json' },
        env: {}
      })
    }
  } as unknown as ColabService

  const manager = new ColabDriveMountManager(
    service,
    openExternal,
    spawnHelper as unknown as typeof spawn
  )
  const states: ColabDriveMountState[] = []
  manager.subscribe((s) => states.push(s))

  return {
    service,
    manager,
    helpers,
    execProcs,
    states,
    openExternal,
    spawnHelper,
    spawnStreamingCommand,
    stopSession() {
      sessionPhase = 'stopped'
      const snap = currentSnapshot()
      for (const fn of snapshotListeners) fn(snap)
    }
  }
}

let h: ReturnType<typeof createHarness>

beforeEach(() => {
  h = createHarness()
})

afterEach(() => {
  for (const p of [...h.helpers, ...h.execProcs]) p.finish()
  h.manager.shutdown()
})

describe('Colab Google Drive mount manager & kernel integration', () => {
  it('sanitizes mount points, upload destinations, and Drive marker lines', () => {
    expect(sanitizeDriveMountPoint(undefined)).toBe('/content/drive')
    expect(sanitizeDriveMountPoint('/content/gdrive/')).toBe('/content/gdrive')
    expect(sanitizeDriveMountPoint('../escape')).toBe('/content/drive')
    expect(sanitizeDriveMountPoint('/content/../etc')).toBe('/content/drive')

    expect(normalizeColabUploadTargetDir(undefined)).toBe('content')
    expect(normalizeColabUploadTargetDir('/content')).toBe('content')
    expect(normalizeColabUploadTargetDir('/content/drive/MyDrive/Colab Notebooks')).toBe(
      'content/drive/MyDrive/Colab Notebooks'
    )
    expect(() => normalizeColabUploadTargetDir('/etc')).toThrow()
    expect(() => normalizeColabUploadTargetDir('/content/drive/../../root')).toThrow()

    expect(
      parseDriveMountMarkerLine(
        `${COLAB_NOTEBOOK_MARKER}DRV_MOUNTED:{"mounted":true,"mountPath":"/content/drive/MyDrive"}`
      )
    ).toEqual({ kind: 'mounted', mounted: true, mountPath: '/content/drive/MyDrive' })
  })

  it('handles interactive browser consent, incomplete retry, mount, and flush_and_unmount', async () => {
    const mountStart = h.manager.mount({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test'
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: authUrl }))
    const authRes = await mountStart
    expect(authRes).toMatchObject({
      ok: true,
      state: { sessionId: 'sess-1', status: 'needs_auth', authUrl }
    })
    expect(h.openExternal).toHaveBeenCalledExactlyOnceWith(authUrl)

    const stdinWrites: string[] = []
    h.helpers[0].stdin.on('data', (chunk: Buffer) => stdinWrites.push(chunk.toString('utf8')))

    // User clicks confirm before completing browser consent: stays retryable
    const firstTry = h.manager.completeMountAuth({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(stdinWrites).toEqual(['CONTINUE\n']))
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: authUrl }))
    expect(await firstTry).toMatchObject({ ok: false, code: 'auth_incomplete' })
    expect(h.openExternal).toHaveBeenCalledTimes(1)

    // User finishes consent and confirms again
    const secondTry = h.manager.completeMountAuth({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(stdinWrites).toEqual(['CONTINUE\n', 'CONTINUE\n']))
    h.helpers[0].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
    )
    h.helpers[0].finish(0)
    expect(await secondTry).toEqual({
      ok: true,
      state: { sessionId: 'sess-1', status: 'mounted', mountPath: '/content/drive/MyDrive' }
    })

    // Unmount calls flush_and_unmount on an auxiliary kernel
    const unmounting = h.manager.unmount({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(2))
    expect(h.spawnHelper.mock.calls[1][1][1]).toContain('drive.flush_and_unmount()')
    h.helpers[1].marker('DRV_UNMOUNTED', '1')
    h.helpers[1].finish(0)
    expect(await unmounting).toEqual({
      ok: true,
      state: { sessionId: 'sess-1', status: 'unmounted' }
    })
  })

  it('intercepts drive.mount() in notebook cells, waits for browser auth, and supports interrupt', async () => {
    expect(detectCellDriveMount('# drive.mount("/content/drive")\nprint(1)').mountsDrive).toBe(false)
    expect(
      detectCellDriveMount(
        'from google.colab import drive\ndrive.mount("/content/drive", force_remount=True)'
      )
    ).toEqual({ mountsDrive: true, forceRemount: true, mountPoint: '/content/drive' })

    const events: ColabNotebookExecEvent[] = []
    const kernel = new ColabNotebookKernel(h.service, (ev) => events.push(ev), h.manager)

    const execPromise = kernel.execute({
      sessionId: 'sess-1',
      execId: 'cell-1',
      code: 'from google.colab import drive\ndrive.mount("/content/drive", force_remount=True)\nprint("ready")'
    })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: 'https://accounts.google.com/auth' }))
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          execId: 'cell-1',
          kind: 'output'
        })
      )
    )

    // Complete Drive auth -> kernel proceeds to execute cell with neutralized force_remount
    const confirmPromise = h.manager.completeMountAuth({ sessionId: 'sess-1' })
    h.helpers[0].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
    )
    h.helpers[0].finish(0)
    await confirmPromise

    await vi.waitFor(() => expect(h.execProcs).toHaveLength(1))
    const cellArgs = h.spawnStreamingCommand.mock.calls[0] as unknown as Array<{ stdinText: string }>
    expect(cellArgs[0]?.stdinText).toContain('_kun_drive_mount')
    h.execProcs[0].stdout.write('Mounted at /content/drive\nready\n')
    h.execProcs[0].finish(0)
    await execPromise
    expect(events.at(-1)).toEqual({
      execId: 'cell-1',
      kind: 'done',
      ok: true,
      interrupted: false,
      message: undefined
    })

    // Interrupting a cell while waiting on Drive authorization cancels the mount cleanly
    const exec2 = kernel.execute({
      sessionId: 'sess-1',
      execId: 'cell-2',
      code: 'drive.mount("/content/drive")'
    })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(2))
    h.helpers[1].marker('DRV_AUTH', JSON.stringify({ uri: 'https://accounts.google.com/auth2' }))
    await vi.waitFor(() =>
      expect(h.states.at(-1)).toMatchObject({ sessionId: 'sess-1', status: 'needs_auth' })
    )
    expect(kernel.interrupt('cell-2')).toEqual({ ok: true })
    await exec2
    expect(events.at(-1)).toMatchObject({ execId: 'cell-2', kind: 'done', ok: false, interrupted: true })
    expect(await h.manager.getState('sess-1')).toEqual({ sessionId: 'sess-1', status: 'unmounted' })
  })

  it('cleans up pending mount state when the Colab session stops', async () => {
    const mountStart = h.manager.mount({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: 'https://accounts.google.com/auth' }))
    await mountStart
    h.stopSession()
    expect(h.helpers[0].kill).toHaveBeenCalled()
    expect(await h.manager.getState('sess-1')).toEqual({ sessionId: 'sess-1', status: 'unmounted' })
  })

  it('resolves Google Drive checkpoint paths without doubling /content and flushes Drive before VM stop', async () => {
    expect(resolveColabRemoteDir('/content/drive/MyDrive/checkpoints')).toBe(
      '/content/drive/MyDrive/checkpoints'
    )
    expect(resolveColabRemoteDir('drive/MyDrive/qwen35-ckpt/')).toBe(
      '/content/drive/MyDrive/qwen35-ckpt'
    )
    expect(resolveColabRemoteDir('outputs/')).toBe('/content/outputs')
    expect(resolveColabRemoteDir('/content/../../etc')).toBe('/content')
    expect(isGoogleDriveRemotePath('/content/drive/MyDrive/checkpoints')).toBe(true)
    expect(isGoogleDriveRemotePath('drive/MyDrive/checkpoints')).toBe(true)
    expect(isGoogleDriveRemotePath('outputs/')).toBe(false)

    expect(buildArtifactListPython('/content/drive/MyDrive/checkpoints')).toContain(
      '"/content/drive/MyDrive/checkpoints"'
    )
    expect(buildFlushMountedDriveIfPresentPython()).toContain('drive.flush_and_unmount()')
    expect(
      buildInstallVmWatchdogPython({ maxRuntimeSeconds: 3600, idleTimeoutSeconds: 900 })
    ).toContain('drive.flush_and_unmount()')

    const logs: string[] = []
    const openExternal = vi.fn(async () => undefined)
    const mounting = runSessionDriveMountHelper({
      pythonPath: '/test/venv/bin/python',
      sessionsJsonPath: '/test/sessions.json',
      sessionName: 'kun-train',
      env: {},
      openExternal,
      onLog: (l) => logs.push(l),
      spawnProcess: h.spawnHelper as unknown as typeof spawn
    })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: 'https://accounts.google.com/o/oauth2/auth' }))
    h.helpers[0].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
    )
    h.helpers[0].finish(0)
    expect(await mounting).toEqual({ ok: true, mountPath: '/content/drive/MyDrive' })
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth')
    expect(logs.some((l) => l.includes('Google Drive authorization'))).toBe(true)

    const flushing = runSessionDriveFlushHelper({
      pythonPath: '/test/venv/bin/python',
      sessionsJsonPath: '/test/sessions.json',
      sessionName: 'kun-train',
      env: {},
      spawnProcess: h.spawnHelper as unknown as typeof spawn
    })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(2))
    h.helpers[1].stdout.write('KUN_DRIVE_FLUSHED:1\n')
    h.helpers[1].finish(0)
    expect(await flushing).toBe(true)
  })

  it('handles background auto-poll auth completion, keyword mountpoint args, and safe artifact downloads', async () => {
    // 1. Background 3s auto-poll completes before user clicks Confirm; concurrent mount() must not flash stale needs_auth
    const mountStart = h.manager.mount({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))
    h.helpers[0].marker('DRV_AUTH', JSON.stringify({ uri: 'https://accounts.google.com/auth' }))
    await mountStart
    h.helpers[0].marker('DRV_AUTH_OK', '1')
    expect(h.states.at(-1)).toEqual({ sessionId: 'sess-1', status: 'mounting' })
    const concurrentMountAfterAuthOk = h.manager.mount({ sessionId: 'sess-1' })
    const lateConfirmWhileMounting = h.manager.completeMountAuth({ sessionId: 'sess-1' })
    h.helpers[0].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
    )
    h.helpers[0].finish(0)
    expect(await concurrentMountAfterAuthOk).toEqual({
      ok: true,
      state: { sessionId: 'sess-1', status: 'mounted', mountPath: '/content/drive/MyDrive' }
    })
    expect(await lateConfirmWhileMounting).toEqual({
      ok: true,
      state: { sessionId: 'sess-1', status: 'mounted', mountPath: '/content/drive/MyDrive' }
    })
    // Confirm clicked after helper already exited also succeeds cleanly
    expect(await h.manager.completeMountAuth({ sessionId: 'sess-1' })).toEqual({
      ok: true,
      state: { sessionId: 'sess-1', status: 'mounted', mountPath: '/content/drive/MyDrive' }
    })

    // 2. Keyword/variable mountpoint in cell detection, bare `from google.colab.drive import mount`, and neutralized wrapper
    expect(
      detectCellDriveMount(
        'drive.mount(force_remount=True, mountpoint="/content/gdrive/")'
      )
    ).toEqual({ mountsDrive: true, forceRemount: true, mountPoint: '/content/gdrive' })
    expect(
      detectCellDriveMount(
        'from google.colab.drive import mount\nMOUNT_DIR = "/content/gdrive"\nmount(MOUNT_DIR, force_remount=True)'
      )
    ).toEqual({ mountsDrive: true, forceRemount: true, mountPoint: '/content/gdrive' })
    expect(
      buildNotebookCellPython('drive.mount(mountpoint="/content/drive", force_remount=True)', {
        neutralizeForceRemount: true
      })
    ).toContain('def _kun_drive_mount(mountpoint, force_remount=False, **_kw):')

    // 3. Structured artifact scan + path traversal rejection + leading-slash download normalization
    expect(
      parseArtifactListOutput<{ name: string }>(
        'KUN_ARTIFACTS:{"items":[{"name":"checkpoint-500/model.safetensors"}],"driveMounted":false,"rootMounted":false}\n'
      )
    ).toEqual({
      items: [{ name: 'checkpoint-500/model.safetensors' }],
      driveMounted: false,
      rootMounted: false
    })

    const tmp = await mkdtemp(join(tmpdir(), 'kun-dl-guard-'))
    try {
      const cliCalls: string[][] = []
      const cli = {
        venvPythonPath: '/nonexistent/python',
        runCommand: vi.fn(async ({ args }: { args: string[] }) => {
          cliCalls.push(args)
          return { exitCode: 0, stdout: '', stderr: '' }
        })
      }
      const executor = new ColabSessionExecutor({
        cli: cli as never,
        credentials: h.service.credentials,
        isolation: h.service.isolation,
        getSession: () => undefined,
        patchSession: () => undefined,
        appendLog: () => undefined,
        onSessionAuthExpired: () => undefined,
        onSessionFinished: () => undefined
      })
      await executor.downloadArtifactsToWorkspace(
        'kun-nb-1',
        [
          { name: '../../escape.bin', remotePath: 'content/outputs/escape.bin', sizeBytes: 10 },
          {
            name: 'checkpoint-10/adapter.safetensors',
            remotePath: '/content/outputs/checkpoint-10/adapter.safetensors',
            sizeBytes: 20
          }
        ],
        join(tmp, 'outputs'),
        '/tmp/sessions.json',
        {}
      )
      expect(cliCalls).toHaveLength(1)
      expect(cliCalls[0]?.slice(0, 4)).toEqual([
        'download',
        '-s',
        'kun-nb-1',
        'content/outputs/checkpoint-10/adapter.safetensors'
      ])

      const singleDl = await downloadArtifactsFromColabSession({
        session: {
          ...(await h.service.getSnapshot()).sessions[0]!,
          workspaceRoot: tmp,
          outputLocalDir: './outputs'
        },
        remotePath: '/content/drive/MyDrive/checkpoints/trainer_state.json',
        cli: cli as never,
        credentials: h.service.credentials,
        isolation: h.service.isolation,
        executor
      })
      expect(singleDl.ok).toBe(true)
      expect(cliCalls[1]?.slice(0, 4)).toEqual([
        'download',
        '-s',
        'kun-nb-1',
        'content/drive/MyDrive/checkpoints/trainer_state.json'
      ])
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('re-mounts custom mountpoints after in-flight default auto-mount and syncs state after cell flush_and_unmount', async () => {
    expect(cellUnmountsDrive('# drive.flush_and_unmount()\nprint(1)')).toBe(false)
    expect(cellUnmountsDrive('from google.colab import drive\ndrive.flush_and_unmount()')).toBe(true)

    const events: ColabNotebookExecEvent[] = []
    const kernel = new ColabNotebookKernel(h.service, (ev) => events.push(ev), h.manager)

    // Default auto-mount (/content/drive) is already running when cell requests /content/gdrive
    const autoMount = h.manager.mount({ sessionId: 'sess-1' })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))

    const customExec = kernel.execute({
      sessionId: 'sess-1',
      execId: 'cell-custom-mp',
      code: 'drive.mount("/content/gdrive")'
    })
    h.helpers[0].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
    )
    h.helpers[0].finish(0)
    await autoMount

    // Follow-up helper spawns for /content/gdrive
    await vi.waitFor(() => expect(h.helpers).toHaveLength(2))
    expect(h.spawnHelper.mock.calls[1][1][1]).toContain('/content/gdrive')
    h.helpers[1].marker(
      'DRV_MOUNTED',
      JSON.stringify({ mounted: true, mountPath: '/content/gdrive/MyDrive' })
    )
    h.helpers[1].finish(0)
    await vi.waitFor(() => expect(h.execProcs).toHaveLength(1))
    h.execProcs[0].finish(0)
    await customExec
    expect(await h.manager.getState('sess-1')).toEqual({
      sessionId: 'sess-1',
      status: 'mounted',
      mountPath: '/content/gdrive/MyDrive'
    })

    // Running drive.flush_and_unmount() inside a cell probes /content/gdrive and updates UI state to unmounted
    const unmountExec = kernel.execute({
      sessionId: 'sess-1',
      execId: 'cell-unmount',
      code: 'drive.flush_and_unmount()'
    })
    await vi.waitFor(() => expect(h.execProcs).toHaveLength(2))
    h.execProcs[1].finish(0)
    await vi.waitFor(() => expect(h.helpers).toHaveLength(3))
    expect(h.spawnHelper.mock.calls[2][1][1]).toContain('/content/gdrive')
    h.helpers[2].marker('DRV_MOUNTED', JSON.stringify({ mounted: false, mountPath: '' }))
    h.helpers[2].finish(0)
    await unmountExec
    expect(await h.manager.getState('sess-1')).toEqual({
      sessionId: 'sess-1',
      status: 'unmounted'
    })
  })

  it('guards Drive uploads with real mount probes, custom mountpoint flush, and outputLocalDir containment', async () => {
    expect(sanitizeOutputLocalDir('../../escape')).toBe('./outputs')
    expect(sanitizeOutputLocalDir('/etc/passwd')).toBe('./outputs')
    expect(sanitizeOutputLocalDir('./outputs/run1')).toBe('./outputs/run1')
    expect(resolveWorkspaceOutputLocalDir('/work/proj', '../../escape')).toBe(
      join('/work/proj', 'outputs')
    )

    expect(buildFlushMountedDriveIfPresentPython()).toContain('/proc/mounts')
    expect(
      buildInstallVmWatchdogPython({ maxRuntimeSeconds: 3600, idleTimeoutSeconds: 900 })
    ).toContain('/proc/mounts')

    const session = (await h.service.getSnapshot()).sessions[0]!
    expect(
      await uploadFilesToColabSession({
        session,
        localPaths: ['/tmp/a.ipynb'],
        targetRemoteDir: '/content/drive/other',
        cli: h.service.cli,
        credentials: h.service.credentials,
        isolation: h.service.isolation,
        spawnProcess: h.spawnHelper as unknown as typeof spawn
      })
    ).toMatchObject({ ok: false, uploadedCount: 0 })

    // Rejects upload to /content/drive/MyDrive when real mount probe reports mounted: false
    const unmountedUpload = uploadFilesToColabSession({
      session,
      localPaths: ['/tmp/a.ipynb'],
      targetRemoteDir: '/content/drive/MyDrive/Colab Notebooks',
      cli: h.service.cli,
      credentials: h.service.credentials,
      isolation: h.service.isolation,
      spawnProcess: h.spawnHelper as unknown as typeof spawn
    })
    await vi.waitFor(() => expect(h.helpers).toHaveLength(1))
    h.helpers[0].marker('DRV_MOUNTED', JSON.stringify({ mounted: false, mountPath: '' }))
    h.helpers[0].finish(0)
    expect(await unmountedUpload).toEqual({
      ok: false,
      uploadedCount: 0,
      message: 'Mount Google Drive (/content/drive) before uploading files to Drive.'
    })
  })
})
