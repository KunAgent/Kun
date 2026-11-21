import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ColabStateSnapshot } from '@shared/colab/colab-types'
import { colabToolData } from './ColabShortcuts'
import {
  formatColabBytes,
  formatColabDuration,
  selectAllRunningSessions,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore
} from './colab-store'

const sampleSnapshot: ColabStateSnapshot = {
  cli: { state: 'ready', version: '0.8.0', pythonVersion: '3.12.7', venvPath: '/tmp/venv' },
  connections: [
    {
      id: 'c1',
      name: '个人',
      email: 'alice@gmail.com',
      avatarColor: '#5b78ff',
      planLabel: 'Colab Pro',
      balanceCu: 86.4,
      burnRateCuPerHour: 1.8,
      status: 'connected',
      createdAt: '2026-11-16T00:00:00Z',
      updatedAt: '2026-11-16T00:00:00Z',
      activeSessions: []
    },
    {
      id: 'c2',
      name: '实验室',
      email: 'lab@univ.edu',
      avatarColor: '#10b981',
      planLabel: 'Colab Pro+',
      balanceCu: 412.0,
      burnRateCuPerHour: 0,
      status: 'connected',
      createdAt: '2026-11-16T00:00:00Z',
      updatedAt: '2026-11-16T00:00:00Z',
      activeSessions: []
    }
  ],
  workspaceConnections: {
    '/work/proj-a': 'c1',
    '/work/proj-b': 'c2'
  },
  oauthPending: null,
  lastLoginOutcome: null,
  sessions: [
    {
      id: 's1',
      sessionName: 'proj-a-1420',
      connectionId: 'c1',
      connectionName: '个人',
      connectionEmail: 'alice@gmail.com',
      connectionAvatarColor: '#5b78ff',
      workspaceRoot: '/work/proj-a',
      accelerator: 'T4',
      vramGb: 15,
      ramGb: 12.7,
      phase: 'running',
      provisioningStep: 'start',
      startedAt: '2026-11-16T14:20:00Z',
      elapsedSeconds: 862,
      entryCommand: 'python train.py',
      syncPaths: ['train.py'],
      outputRemoteDir: 'outputs/',
      outputLocalDir: './outputs',
      maxRuntimeHours: 3,
      autoStop: true,
      mountDrive: false,
      consumedCu: 0.43,
      burnRateCuPerHour: 1.8,
      estimatedTotalCu: 2.7,
      uploadTransferredBytes: 1024,
      uploadTotalBytes: 1024,
      gpuUtilizationPct: 78,
      vramUsedGb: 9.4,
      gpuHistory: [70, 75, 78],
      metrics: { loss: [{ step: 1, value: 0.9 }] },
      logTail: ['Epoch 1/10'],
      artifacts: []
    }
  ],
  untrackedSessions: [],
  lastRunsByWorkspace: {}
}

describe('colab renderer store & selectors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useColabStore.setState(useColabStore.getInitialState())
  })

  it('shows preparation progress, reports bridge errors, and retries with the returned CLI status', async () => {
    const ensureCli = vi.fn()
      .mockRejectedValueOnce(new Error('CLI host unavailable'))
      .mockResolvedValue(sampleSnapshot.cli)
    vi.stubGlobal('window', { kunGui: { colabEnsureCliRuntime: ensureCli } })
    const { prepareCli, applySnapshot } = useColabStore.getState()
    applySnapshot({ ...sampleSnapshot, cli: useColabStore.getInitialState().snapshot.cli })

    const first = prepareCli()
    expect(useColabStore.getState().snapshot.cli.state).toBe('installing')
    await Promise.all([first, prepareCli()])
    expect(ensureCli).toHaveBeenCalledOnce()
    expect(useColabStore.getState().snapshot.cli).toMatchObject({ state: 'error', message: 'CLI host unavailable' })
    await prepareCli()
    expect(ensureCli).toHaveBeenLastCalledWith({ upgrade: false })
    expect(useColabStore.getState().snapshot).toEqual(sampleSnapshot)
    await prepareCli()
    expect(ensureCli).toHaveBeenLastCalledWith({ upgrade: true })
  })

  it('resolves workspace-specific active connections and sessions independently', () => {
    expect(selectWorkspaceActiveConnection(sampleSnapshot, '/work/proj-a/')?.id).toBe('c1')
    expect(selectWorkspaceActiveConnection(sampleSnapshot, '/work/proj-b')?.id).toBe('c2')
    expect(selectWorkspaceSessions(sampleSnapshot, '/work/proj-a')).toHaveLength(1)
    expect(selectWorkspaceSessions(sampleSnapshot, '/work/proj-b')).toHaveLength(0)
    expect(selectAllRunningSessions(sampleSnapshot)).toHaveLength(1)
  })

  it('formats durations, byte sizes, and colab_run tool markers accurately', () => {
    expect(formatColabDuration(862)).toBe('14:22')
    expect(formatColabDuration(3665)).toBe('1:01:05')
    expect(formatColabBytes(1536)).toBe('1.5 KB')

    const marker = colabToolData({
      source: 'native',
      name: 'colab_run',
      kind: 'command_execution',
      output: {
        colabRun: {
          kind: 'colab_run',
          sessionId: 's1',
          sessionName: 'proj-a-1420',
          connectionLabel: '个人 · alice@gmail.com',
          accelerator: 'T4',
          entryCommand: 'python train.py',
          phase: 'running',
          consumedCu: 0.4
        }
      }
    } as any)
    expect(marker?.sessionId).toBe('s1')
    expect(marker?.accelerator).toBe('T4')

    useColabStore.getState().applySnapshot({
      ...sampleSnapshot,
      lastLoginOutcome: {
        ok: true,
        kind: 'created',
        connection: sampleSnapshot.connections[1]!
      }
    })
    expect(useColabStore.getState().newlyCreatedConnectionId).toBe('c2')
  })
})
