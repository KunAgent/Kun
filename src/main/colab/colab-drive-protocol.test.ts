import { execFileSync, spawnSync, type ChildProcess, type spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  COLAB_NOTEBOOK_MARKER,
  type ColabDriveMountState
} from '../../shared/colab/colab-notebook-types'
import type { ColabStateSnapshot } from '../../shared/colab/colab-types'
import { ColabDriveMountManager } from './colab-drive-mount'
import { buildDriveMountAndListPython } from './colab-drive-notebooks'
import {
  buildDriveMountSessionPython,
  drivefsAuthHookPython,
  parseDriveMountMarkerLine
} from './colab-drive-protocol'
import type { ColabService } from './colab-service'

function resolveSystemPython3(): string | null {
  for (const bin of ['python3', 'python']) {
    try {
      const out = execFileSync(bin, ['-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8',
        timeout: 3000
      })
      if (out.trim() === '3') return bin
    } catch {
      continue
    }
  }
  return null
}

const PYTHON3 = resolveSystemPython3()

function fakeChild() {
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

describe('Colab Google Drive dfs_ephemeral protocol & multi-account resilience', () => {
  it('passes timeout_ms=600000 to drive.mount and parses structured auth/error markers', () => {
    const mountScript = buildDriveMountSessionPython('/tmp/sessions.json', 'kun-nb-1', {
      expectedEmail: 'jackzhongxiaoyu@gmail.com'
    })
    expect(mountScript).toContain('timeout_ms=600000')
    expect(mountScript).toContain('jackzhongxiaoyu@gmail.com')

    const listScript = buildDriveMountAndListPython(
      '/tmp/sessions.json',
      'kun-nb-1',
      'jackzhongxiaoyu@gmail.com'
    )
    expect(listScript).toContain('timeout_ms=600000')
    expect(listScript).toContain('jackzhongxiaoyu@gmail.com')

    expect(
      parseDriveMountMarkerLine(
        `${COLAB_NOTEBOOK_MARKER}DRV_AUTH:{"uri":"https://accounts.google.com/o/oauth2/v2/auth","reason":"account_mismatch"}`
      )
    ).toEqual({
      kind: 'auth',
      uri: 'https://accounts.google.com/o/oauth2/v2/auth',
      reason: 'account_mismatch'
    })

    expect(
      parseDriveMountMarkerLine(
        `${COLAB_NOTEBOOK_MARKER}DRV_ERR:{"message":"HTTP 400 mismatch","code":"account_mismatch"}`
      )
    ).toEqual({
      kind: 'error',
      message: 'HTTP 400 mismatch',
      code: 'account_mismatch'
    })
  })

  it('keeps ColabDriveAuthCard mounted (needs_auth) during CONTINUE verification and surfaces account_mismatch', async () => {
    const helpers: Array<ReturnType<typeof fakeChild>> = []
    const spawnHelper = vi.fn(() => {
      const p = fakeChild()
      helpers.push(p)
      return p as unknown as ChildProcess
    })
    const snapshot: ColabStateSnapshot = {
      cli: { state: 'ready', version: '0.8.0', pythonVersion: '3.12', venvPath: '/tmp/venv' },
      connections: [
        {
          id: 'conn-2',
          name: 'jackzhongxiaoyu',
          email: 'jackzhongxiaoyu@gmail.com',
          avatarColor: '#7a68e8',
          status: 'connected',
          planLabel: 'Colab Pro+',
          balanceCu: 1000,
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
          id: 'sess-drive',
          sessionName: 'kun-nb-drive',
          connectionId: 'conn-2',
          connectionName: 'jackzhongxiaoyu',
          connectionEmail: 'jackzhongxiaoyu@gmail.com',
          connectionAvatarColor: '#7a68e8',
          workspaceRoot: '/work/proj',
          entryCommand: COLAB_NOTEBOOK_ENTRY_COMMAND,
          accelerator: 'CPU',
          phase: 'running',
          provisioningStep: 'start',
          startedAt: '2026-11-26T09:00:00Z',
          elapsedSeconds: 5,
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
          mountDrive: true,
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
    }

    const service = {
      subscribe: () => () => undefined,
      getSnapshot: async () => snapshot,
      cli: {
        ensureInstalled: async () => ({ state: 'ready' }),
        venvPythonPath: '/test/venv/bin/python'
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
      async () => undefined,
      spawnHelper as unknown as typeof spawn
    )
    const transitions: ColabDriveMountState[] = []
    manager.subscribe((s) => transitions.push(s))

    try {
      const mountStart = manager.mount({ sessionId: 'sess-drive' })
      await vi.waitFor(() => expect(helpers).toHaveLength(1))
      const url1 = 'https://accounts.google.com/o/oauth2/v2/auth?state=1'
      helpers[0]!.marker('DRV_AUTH', JSON.stringify({ uri: url1 }))
      await mountStart
      transitions.length = 0

      // Clicking Confirm must NOT emit an intermediate `mounting` state before DRV_AUTH_OK,
      // preventing ColabDriveAuthCard from unmounting and losing its inline feedback.
      const firstConfirm = manager.completeMountAuth({ sessionId: 'sess-drive' })
      expect(transitions).toEqual([])

      const url2 = 'https://accounts.google.com/o/oauth2/v2/auth?state=2'
      helpers[0]!.marker(
        'DRV_AUTH',
        JSON.stringify({ uri: url2, reason: 'account_mismatch' })
      )
      const mismatchRes = await firstConfirm
      expect(mismatchRes).toMatchObject({
        ok: false,
        code: 'account_mismatch',
        state: {
          sessionId: 'sess-drive',
          status: 'needs_auth',
          authUrl: url2,
          reason: 'account_mismatch'
        }
      })
      expect(mismatchRes.ok ? '' : mismatchRes.message).toContain('jackzhongxiaoyu@gmail.com')
      expect(transitions.map((t) => t.status)).toEqual(['needs_auth'])

      // Second Confirm succeeds: DRV_AUTH_OK transitions to `mounting`, then DRV_MOUNTED completes.
      const secondConfirm = manager.completeMountAuth({ sessionId: 'sess-drive' })
      helpers[0]!.marker('DRV_AUTH_OK', '1')
      expect(transitions.at(-1)).toEqual({ sessionId: 'sess-drive', status: 'mounting' })
      helpers[0]!.marker(
        'DRV_MOUNTED',
        JSON.stringify({ mounted: true, mountPath: '/content/drive/MyDrive' })
      )
      helpers[0]!.finish(0)
      expect(await secondConfirm).toEqual({
        ok: true,
        state: {
          sessionId: 'sess-drive',
          status: 'mounted',
          mountPath: '/content/drive/MyDrive'
        }
      })
    } finally {
      for (const p of helpers) p.finish()
      manager.shutdown()
    }
  })

  it.skipIf(!PYTHON3)(
    'executes generated drivefs_hook off the WebSocket thread, sends dryrun=false on CONTINUE, and handles HTTP 400 HTML',
    () => {
      const hookLines = drivefsAuthHookPython('', 'jackzhongxiaoyu@gmail.com').join('\n')
      const harnessPy = [
        'import io, json, sys, threading, time, types',
        'class _Resp:',
        '    def __init__(self, text, status_code=200):',
        '        self.text = text',
        '        self.status_code = status_code',
        'calls = []',
        'responses = [',
        '    _Resp("rendered\\nprefix\\n{\\"success\\": true, \\"token\\": \\"tok-1\\"}"),',
        '    _Resp(")]}\'\\n{\\"success\\": false, \\"unauthorized_redirect_uri\\": \\"https://accounts.google.com/o/oauth2/v2/auth?state=init\\"}"),',
        '    _Resp(")]}\'\\n{\\"token\\": \\"tok-2\\"}"),',
        '    _Resp("<html><body>400 Bad Request</body></html>", 400),',
        '    _Resp(")]}\'\\n{\\"success\\": false, \\"unauthorized_redirect_uri\\": \\"https://accounts.google.com/o/oauth2/v2/auth?state=retry\\"}"),',
        '    _Resp(")]}\'\\n{\\"token\\": \\"tok-3\\"}"),',
        '    _Resp(")]}\'\\n{\\"success\\": true}")',
        ']',
        'class _Creds:',
        '    def request(self, method, url, params=None, headers=None, files=None, timeout=None):',
        '        calls.append((method, dict(params or {}), dict(headers or {})))',
        '        return responses.pop(0)',
        'def get_credentials(*a, **kw):',
        '    return _Creds()',
        'def get_status_code(r):',
        '    return r.status_code',
        'state = types.SimpleNamespace(',
        '    client=types.SimpleNamespace(colab_domain="https://colab.research.google.com"),',
        '    client_oauth_config="/tmp/oauth.json",',
        '    auth_provider="oauth2"',
        ')',
        's = types.SimpleNamespace(endpoint="ep-123")',
        'cleaned = [0]',
        'def _cleanup_runtime():',
        '    cleaned[0] += 1',
        'runtime = types.SimpleNamespace(colab_request_hook=None)',
        'r_fd, w_fd = __import__("os").pipe()',
        'sys.stdin = __import__("os").fdopen(r_fd, "r")',
        'stdin_writer = __import__("os").fdopen(w_fd, "w")',
        hookLines,
        'sent_replies = []',
        'wsclient = types.SimpleNamespace(',
        '    session=types.SimpleNamespace(msg=lambda t, c: {"msg_type": t, "content": c}),',
        '    stdin_channel=types.SimpleNamespace(send=lambda m: sent_replies.append(m))',
        ')',
        'msg = {"header": {"msg_id": "h1"}, "metadata": {"colab_msg_id": "cm-1"}, "content": {"request": {"authType": "dfs_ephemeral"}}}',
        't0 = time.monotonic()',
        'intercepted = runtime.colab_request_hook(msg, wsclient)',
        'hook_ms = (time.monotonic() - t0) * 1000.0',
        'assert intercepted is True',
        'assert hook_ms < 200, f"hook blocked websocket thread for {hook_ms}ms"',
        'time.sleep(0.08)',
        // First CONTINUE hits HTTP 400 HTML (multi-account mismatch) -> emits retry DRV_AUTH with account_mismatch
        'stdin_writer.write("CONTINUE\\n")',
        'stdin_writer.flush()',
        'time.sleep(0.08)',
        // Second CONTINUE hits dryrun="false" -> 200 {"success": true} -> sends colab_reply
        'stdin_writer.write("CONTINUE\\n")',
        'stdin_writer.flush()',
        'deadline = time.monotonic() + 2.0',
        'while not sent_replies and time.monotonic() < deadline:',
        '    time.sleep(0.02)',
        'stdin_writer.close()',
        'print("TEST_SUMMARY:" + json.dumps({"calls": calls, "replies": sent_replies, "cleaned": cleaned[0]}), flush=True)'
      ].join('\n')

      const res = spawnSync(PYTHON3!, ['-c', harnessPy], {
        encoding: 'utf8',
        timeout: 8000
      })
      expect(res.status).toBe(0)
      const lines = res.stdout.trim().split(/\r?\n/)
      const markers = lines.map(parseDriveMountMarkerLine).filter(Boolean)
      expect(markers).toEqual([
        {
          kind: 'auth',
          uri: 'https://accounts.google.com/o/oauth2/v2/auth?state=init'
        },
        {
          kind: 'auth',
          uri: 'https://accounts.google.com/o/oauth2/v2/auth?state=retry',
          reason: 'account_mismatch'
        },
        { kind: 'auth_ok' }
      ])
      const summaryLine = lines.find((l) => l.startsWith('TEST_SUMMARY:'))!
      const summary = JSON.parse(summaryLine.slice('TEST_SUMMARY:'.length)) as {
        calls: Array<[string, Record<string, string>, Record<string, string>]>
        replies: Array<Record<string, unknown>>
        cleaned: number
      }
      // Verify CONTINUE directly sent POST with dryrun="false"
      const postDryruns = summary.calls
        .filter(([method]) => method === 'POST')
        .map(([, params]) => params.dryrun)
      expect(postDryruns).toEqual(['true', 'false', 'true', 'false'])
      expect(summary.replies).toEqual([
        {
          msg_type: 'input_reply',
          content: { value: { type: 'colab_reply', colab_msg_id: 'cm-1' } },
          parent_header: { msg_id: 'h1' }
        }
      ])
      expect(summary.cleaned).toBe(0)
    }
  )
})
