import { ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SafeStorage } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultKunColabSettings } from '../../shared/app-settings-colab'
import { ColabService } from './colab-service'
import { colabUploadAccess } from './colab-upload-access'
import { provisionColabHardware } from './colab-hardware-provisioner'
import { readWorkspaceColabConfig } from './colab-workspace-sync'

vi.mock('./colab-upload-access', () => ({ colabUploadAccess: vi.fn() }))
vi.mock('./colab-hardware-provisioner', () => ({ provisionColabHardware: vi.fn() }))
vi.mock('./colab-workspace-sync', async (original) => ({
  ...await original<typeof import('./colab-workspace-sync')>(), readWorkspaceColabConfig: vi.fn(), collectSyncFileList: vi.fn(async () => [])
}))

let service: ColabService | undefined
let root: string | undefined
afterEach(async () => {
  await service?.shutdown()
  if (root) await rm(root, { recursive: true, force: true })
  service = undefined
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

async function fixture() {
  vi.useFakeTimers()
  root = await mkdtemp(join(tmpdir(), 'kun-colab-resources-'))
  const conn = { id: 'conn', name: 'test', email: 'test@example.test', status: 'connected' }
  await writeFile(join(root, 'state.v1.json'), JSON.stringify({ version: 1, connections: [conn] }))
  const svc = service = new ColabService({ colabRootDir: root, safeStorage: {} as SafeStorage,
    getColabSettings: () => ({ ...defaultKunColabSettings(), stopSessionsOnQuit: false, idleAutoStopEnabled: false }),
    openExternal: async () => {} })
  vi.spyOn(svc.cli, 'probe').mockResolvedValue({ ...svc.cli.status, state: 'ready' })
  vi.spyOn(svc.credentials, 'materializeRuntimeToken').mockResolvedValue('fixture')
  vi.spyOn(svc.credentials, 'syncRuntimeTokenBack').mockResolvedValue(undefined)
  vi.spyOn(svc.isolation, 'prepareConnectionEnvironment').mockResolvedValue({
    paths: svc.isolation.pathsForConnection(conn.id), env: {}
  })
  vi.mocked(colabUploadAccess).mockReset().mockReturnValue(async () => ({ baseUrl: 'https://example.test' }))
  vi.mocked(readWorkspaceColabConfig).mockResolvedValue(null)
  vi.mocked(provisionColabHardware).mockResolvedValue({ ok: true, sessionName: 'test-session', attemptsUsed: 1,
    ramGb: null, vramGb: null })
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes('/api/contents/')) return Response.json({ type: 'directory', content: [
      { name: 'weights.bin', type: 'file', size: 345 }
    ] })
    return Response.json({ memory: { totalBytes: 32 * 2 ** 30, freeBytes: 7 * 2 ** 30 } })
  })
  vi.stubGlobal('fetch', fetchMock)
  await svc.initialize()
  return { svc, conn, fetchMock }
}

it('keeps sampling after terminal-only provision returns; scans files separately and stops both on shutdown', async () => {
  const { svc, conn, fetchMock } = await fixture()
  const cli = vi.spyOn(svc.cli, 'runCommand').mockRejectedValue(new Error('unexpected notebook exec'))
  const result = await svc.startRun({ connectionId: conn.id, workspaceRoot: '', accelerator: 'CPU',
    terminalOnly: true, maxRuntimeHours: 0, autoStop: false, syncPaths: [], entryCommand: '',
    outputRemoteDir: 'outputs', outputLocalDir: './outputs' })
  if (!result.ok) throw Error(result.message)
  await vi.advanceTimersByTimeAsync(19_999)
  expect(result.session.phase).toBe('running')
  expect(result.session.resourceHistory).toHaveLength(4)
  expect(fetchMock.mock.calls.every(([url]) => String(url).includes('/api/colab/resources'))).toBe(true)
  await vi.advanceTimersByTimeAsync(1)
  expect(result.session.resourceHistory).toHaveLength(5)
  expect(result.session.artifacts).toEqual([{ name: 'weights.bin', remotePath: 'content/outputs/weights.bin', sizeBytes: 345 }])
  expect(cli).not.toHaveBeenCalled()
  await svc.shutdown()
  service = undefined
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

it('samples during a training command and resumes after its streaming connection closes', async () => {
  const { svc, conn, fetchMock } = await fixture()
  const child = new ChildProcess() // no process is spawned
  const spawn = vi.spyOn(svc.cli, 'spawnStreamingCommand').mockReturnValue(child)
  vi.spyOn(svc.cli, 'runCommand').mockResolvedValue({ exitCode: 0, stdout: 'KUN_ARTIFACTS:[]', stderr: '' })
  const result = await svc.startRun({ connectionId: conn.id, workspaceRoot: '', accelerator: 'CPU',
    entryCommand: 'training', maxRuntimeHours: 0, autoStop: false, syncPaths: [], outputRemoteDir: 'outputs', outputLocalDir: '' })
  if (!result.ok) throw Error(result.message)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(spawn).toHaveBeenCalledTimes(1)
  expect(result.session.resourceHistory).toHaveLength(2)
  child.emit('close', 255)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(result.session.phase).toBe('disconnected')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await svc.reconnectSession(result.session.id)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(result.session.resourceHistory).toHaveLength(4)
  expect(spawn).toHaveBeenCalledTimes(1)
})

it('does not sample discovery; adoption targets the endpoint, reconnect is idempotent, sign-out stops it', async () => {
  const { svc, conn, fetchMock } = await fixture()
  vi.spyOn(svc.cli, 'runPythonScript').mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
  vi.spyOn(svc.cli, 'runCommand').mockImplementation(async ({ args }) => ({ exitCode: 0, stderr: '',
    stdout: args[0] === 'sessions' ? '[?] endpoint-1234 | Hardware: CPU | Shape: default | Variant: DEFAULT' : '' }))
  const snap = await svc.refreshBalances()
  expect(snap.untrackedSessions).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchMock).not.toHaveBeenCalled()
  const result = await svc.adoptUntrackedSession({ connectionId: conn.id, workspaceRoot: root!, endpoint: 'endpoint-1234' })
  if (!result.session) throw Error(result.message)
  await vi.advanceTimersByTimeAsync(0)
  expect(colabUploadAccess).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'endpoint-1234' }))
  expect(result.session.resourceHistory).toHaveLength(1)
  result.session.phase = 'disconnected'
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await svc.reconnectSession(result.session.id)
  await svc.reconnectSession(result.session.id)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  await svc.signOutConnection(conn.id, false)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(svc.getSnapshotSync().sessions).toEqual([])
})
