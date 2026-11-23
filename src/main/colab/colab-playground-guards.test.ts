import { describe, expect, it, vi } from 'vitest'
import { COLAB_RESERVED_VM_PORT } from '../../shared/colab/colab-notebook-types'
import type { ColabStateSnapshot } from '../../shared/colab/colab-types'
import {
  buildColabNewArgs,
  classifyProvisionError,
  parseHardwareProbeOutput,
  provisionColabHardware,
  type RunColabCliFn
} from './colab-hardware-provisioner'
import {
  buildSshTunnelArgs,
  classifySshTunnelError,
  ColabPortForwardManager,
  stateHasRecordedSession,
  tunnelBackoffSeconds
} from './colab-port-forward-manager'
import type { ColabService } from './colab-service'
import {
  buildExtendVmWatchdogPython,
  buildInstallVmWatchdogPython,
  evaluateSessionCostGuard,
  KUN_COLAB_HEARTBEAT_PATH,
  parseWatchdogOutput,
  USAGE_STALE_AFTER_MS
} from './colab-watchdog-guard'

describe('colab hardware provisioner', () => {
  it('builds CLI flags with --high-mem and parses MemTotal + nvidia-smi probe output', () => {
    expect(
      buildColabNewArgs({ sessionName: 'kun-a100', accelerator: 'A100', highMem: true })
    ).toEqual(['new', '-s', 'kun-a100', '--gpu', 'A100', '--high-mem'])
    expect(buildColabNewArgs({ sessionName: 'kun-cpu', accelerator: 'CPU', highMem: false })).toEqual([
      'new',
      '-s',
      'kun-cpu'
    ])
    expect(parseHardwareProbeOutput('noise\nKUN_HW:87562240,81920\n')).toEqual({
      ramGb: 83.5,
      vramGb: 80
    })
  })

  it('releases 40GB A100 VMs and retries with distinct session names until 80GB is allocated', async () => {
    const cliCalls: string[][] = []
    const runCli: RunColabCliFn = async ({ args }) => {
      cliCalls.push(args)
      if (args[0] === 'new') return { exitCode: 0, stdout: 'created', stderr: '' }
      if (args[0] === 'stop') return { exitCode: 0, stdout: 'stopped', stderr: '' }
      if (args[0] === 'exec' && args[2] === 'kun-nb') {
        return { exitCode: 0, stdout: 'KUN_HW:87562240,40960\n', stderr: '' }
      }
      return { exitCode: 0, stdout: 'KUN_HW:175124480,81920\n', stderr: '' }
    }

    const attempts: Array<{ attempt: number; max: number; name: string }> = []
    const res = await provisionColabHardware({
      baseSessionName: 'kun-nb',
      accelerator: 'A100',
      highMem: true,
      minVramGb: 70,
      maxAttempts: 3,
      sessionsJsonPath: '/tmp/sessions.json',
      env: {},
      runCli,
      syncTokenBack: async () => undefined,
      onAttempt: (attempt, max, name) => attempts.push({ attempt, max, name }),
      signal: new AbortController().signal,
      retryDelayMs: 0
    })

    expect(res).toEqual({
      ok: true,
      sessionName: 'kun-nb-r2',
      ramGb: 167,
      vramGb: 80,
      attemptsUsed: 2
    })
    expect(attempts).toEqual([
      { attempt: 1, max: 3, name: 'kun-nb' },
      { attempt: 2, max: 3, name: 'kun-nb-r2' }
    ])
    expect(cliCalls).toContainEqual(['stop', '-s', 'kun-nb'])
  })

  it('aborts immediately without retrying when account is not entitled (HTTP 400)', async () => {
    expect(classifyProvisionError('Error: Backend rejected accelerator (HTTP 400)')).toBe(
      'not_entitled'
    )
    const runCli = vi.fn<RunColabCliFn>(async ({ args }) => {
      if (args[0] === 'stop') return { exitCode: 0, stdout: '', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: 'Backend rejected accelerator (HTTP 400)' }
    })

    const res = await provisionColabHardware({
      baseSessionName: 'kun-pro',
      accelerator: 'A100',
      minVramGb: 70,
      maxAttempts: 3,
      sessionsJsonPath: '/tmp/sessions.json',
      env: {},
      runCli,
      syncTokenBack: async () => undefined,
      signal: new AbortController().signal,
      retryDelayMs: 0
    })

    expect(res).toMatchObject({ ok: false, errorKind: 'not_entitled' })
    expect(runCli.mock.calls.filter(([c]) => c.args[0] === 'new')).toHaveLength(1)
  })

  it('falls back cleanly when an older colab-cli lacks --high-mem and releases VM on abort', async () => {
    const controller = new AbortController()
    const cliCalls: string[][] = []
    const runCli: RunColabCliFn = async ({ args }) => {
      cliCalls.push(args)
      if (args[0] === 'new' && args.includes('--high-mem')) {
        return { exitCode: 2, stdout: '', stderr: 'No such option: --high-mem' }
      }
      if (args[0] === 'new') {
        controller.abort()
        return { exitCode: 0, stdout: 'created', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const res = await provisionColabHardware({
      baseSessionName: 'kun-hm',
      accelerator: 'T4',
      highMem: true,
      sessionsJsonPath: '/tmp/sessions.json',
      env: {},
      runCli,
      syncTokenBack: async () => undefined,
      signal: controller.signal,
      retryDelayMs: 0
    })

    expect(res).toEqual({ ok: false, aborted: true })
    expect(cliCalls).toEqual([
      ['new', '-s', 'kun-hm', '--gpu', 'T4', '--high-mem'],
      ['new', '-s', 'kun-hm', '--gpu', 'T4'],
      ['stop', '-s', 'kun-hm']
    ])
  })
})

describe('colab VM watchdog and cost guard', () => {
  it('builds self-releasing VM watchdog scripts and parses deadline acknowledgements', () => {
    const installPy = buildInstallVmWatchdogPython({
      maxRuntimeSeconds: 7200,
      idleTimeoutSeconds: 1800
    })
    expect(installPy).toContain('/unassign')
    expect(installPy).toContain('TBE_RUNTIME_ADDR')
    expect(installPy).toContain(KUN_COLAB_HEARTBEAT_PATH)

    const extendPy = buildExtendVmWatchdogPython(1800)
    expect(extendPy).toContain('deadline = base + 1800')
    expect(parseWatchdogOutput('boot\nKUN_WATCHDOG_OK:2026-11-19T08:00:00+00:00\n')).toEqual({
      ok: true,
      autoStopAt: '2026-11-19T08:00:00+00:00'
    })
    expect(parseWatchdogOutput('no marker')).toEqual({ ok: false, autoStopAt: null })
  })

  it('evaluates runtime caps, spend caps, projected balance floors, and stale balance warnings', () => {
    const nowMs = Date.parse('2026-11-19T06:00:00.000Z')
    const freshAt = new Date(nowMs - 60_000).toISOString()

    // Runtime nearing (>= 80%) vs exceeded
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 3000, consumedCu: 1, maxRuntimeHours: 1 },
        nowMs
      })
    ).toEqual({ stopReason: null, warnings: ['runtime_nearing'] })
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 3600, consumedCu: 1, maxRuntimeHours: 1 },
        nowMs
      })
    ).toEqual({ stopReason: 'max_runtime', warnings: [] })

    // Spend cap nearing vs reached
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 600, consumedCu: 8.2, maxRuntimeHours: 0, maxSpendCu: 10 },
        nowMs
      })
    ).toEqual({ stopReason: null, warnings: ['spend_nearing'] })
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 600, consumedCu: 10, maxRuntimeHours: 0, maxSpendCu: 10 },
        nowMs
      })
    ).toEqual({ stopReason: 'max_spend', warnings: [] })

    // Balance floor with burn-rate projection: 15.05 CU - (6 CU/h * 1 min = 0.1 CU) = 14.95 <= 15
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 600, consumedCu: 2, maxRuntimeHours: 0, minBalanceCu: 15 },
        connection: { balanceCu: 15.05, burnRateCuPerHour: 6, updatedAt: freshAt },
        nowMs
      })
    ).toEqual({ stopReason: 'balance_floor', warnings: [] })

    // Missing or stale (> 5 min) balance never triggers false stop or silent pass: emits balance_stale
    const staleAt = new Date(nowMs - USAGE_STALE_AFTER_MS - 5_000).toISOString()
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 600, consumedCu: 2, maxRuntimeHours: 0, minBalanceCu: 15 },
        connection: { balanceCu: 50, burnRateCuPerHour: 2, updatedAt: staleAt },
        nowMs
      })
    ).toEqual({ stopReason: null, warnings: ['balance_stale'] })
    expect(
      evaluateSessionCostGuard({
        session: { elapsedSeconds: 600, consumedCu: 2, maxRuntimeHours: 0, minBalanceCu: 15 },
        connection: { balanceCu: null, burnRateCuPerHour: null, updatedAt: freshAt },
        nowMs
      })
    ).toEqual({ stopReason: null, warnings: ['balance_stale'] })
  })
})

describe('colab SSH port forward manager and helpers', () => {
  it('multiplexes multiple -L port rules onto one ssh -N command with -F /dev/null', () => {
    const args = buildSshTunnelArgs({
      pythonPath: '/opt/kun/venv/bin/python',
      sessionsJsonPath: '/tmp/conn 1/sessions.json',
      sshKeyPath: '/tmp/conn 1/id_ed25519',
      sessionName: 'kun-nb',
      forwards: [
        { localPort: 7860, remotePort: 7860 },
        { localPort: 6006, remotePort: 6006 }
      ],
      platform: 'darwin'
    })
    expect(args.slice(0, 4)).toEqual(['-N', '-T', '-F', '/dev/null'])
    expect(args).toContain(
      "ProxyCommand='/opt/kun/venv/bin/python' -m colab_cli.cli --config '/tmp/conn 1/sessions.json' ssh --proxy-mode -s 'kun-nb'"
    )
    expect(args).toContain('127.0.0.1:7860:127.0.0.1:7860')
    expect(args).toContain('127.0.0.1:6006:127.0.0.1:6006')
    expect(args.at(-1)).toBe('root@colab-runtime')
  })

  it('guards sessions.json membership, classifies SSH errors, and caps backoff at 30s', () => {
    expect(stateHasRecordedSession('{"kun-nb":{"endpoint":"m-s-1"}}', 'kun-nb')).toBe(true)
    expect(stateHasRecordedSession('{"other":{}}', 'kun-nb')).toBe(false)
    expect(stateHasRecordedSession('corrupt', 'kun-nb')).toBe(false)

    expect(classifySshTunnelError('Error: Already-active SSH session (HTTP 429)', 255)).toBe(
      'ssh_busy'
    )
    expect(classifySshTunnelError('bind [127.0.0.1]:7860: Address already in use', 255)).toBe(
      'port_in_use'
    )
    expect(classifySshTunnelError("Session 'kun-nb' not found", 1)).toBe('session_gone')
    expect(classifySshTunnelError('To authorize colab-cli, run colab auth login', 1)).toBe(
      'auth_required'
    )
    expect(classifySshTunnelError('', 127)).toBe('ssh_missing')
    expect([1, 2, 3, 6, 9].map(tunnelBackoffSeconds)).toEqual([1, 2, 4, 30, 30])
  })

  it('rejects reserved VM port 8080 and missing sessions before spawning ssh', async () => {
    const emptySnapshot: ColabStateSnapshot = {
      cli: { state: 'ready', version: '0.1.0', pythonVersion: '3.11', venvPath: '/tmp/venv' },
      connections: [],
      workspaceConnections: {},
      oauthPending: null,
      lastLoginOutcome: null,
      sessions: [],
      untrackedSessions: [],
      lastRunsByWorkspace: {}
    }
    const fakeService = {
      subscribe: () => () => undefined,
      getSnapshot: async () => emptySnapshot
    } as unknown as ColabService

    const mgr = new ColabPortForwardManager(fakeService)
    try {
      const reserved = await mgr.startForward({
        sessionId: 'sess-1',
        remotePort: COLAB_RESERVED_VM_PORT
      })
      expect(reserved).toMatchObject({ ok: false, errorKind: 'port_reserved' })

      const missing = await mgr.startForward({ sessionId: 'sess-missing', remotePort: 7860 })
      expect(missing).toMatchObject({ ok: false, errorKind: 'session_gone' })
    } finally {
      mgr.shutdown()
    }
  })
})
