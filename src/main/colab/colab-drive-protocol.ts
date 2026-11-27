import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import {
  COLAB_NOTEBOOK_MARKER,
  type ColabDriveAuthHint,
  type ColabDriveErrorCode
} from '../../shared/colab/colab-notebook-types'

export const DRIVE_AUTH_WAIT_TIMEOUT_MS = 8 * 60 * 1000

export function sanitizeDriveMountPoint(raw?: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return '/content/drive'
  if (
    !trimmed.startsWith('/') ||
    trimmed === '/' ||
    trimmed.includes('\\') ||
    [...trimmed].some((ch) => ch.charCodeAt(0) < 32) ||
    trimmed.split('/').some((seg) => seg === '.' || seg === '..')
  ) {
    return '/content/drive'
  }
  return trimmed
}

export function checkedDriveAuthUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      [
        'accounts.google.com',
        'colab.research.google.com',
        'drive.google.com',
        'consent.google.com'
      ].includes(url.hostname)
      ? url.href
      : null
  } catch {
    return null
  }
}

export function terminateDriveHelper(child: ChildProcess): void {
  if (child.killed || !child.kill('SIGTERM')) return
  const force = setTimeout(() => child.kill('SIGKILL'), 8_000)
  force.unref()
  child.once('close', () => clearTimeout(force))
}

export function driveRuntimeSetup(sessionsJsonPath: string, sessionName: string): string[] {
  return [
    'import json, signal, sys, threading',
    'from colab_cli.common import state',
    'from colab_cli.runtime import ColabRuntime',
    `state.config_path = ${JSON.stringify(sessionsJsonPath)}`,
    `s = state.get_session(${JSON.stringify(sessionName)}, ignore_missing_session=True)`,
    'if s is None:',
    `    print(${JSON.stringify(COLAB_NOTEBOOK_MARKER + 'DRV_ERR:')} + json.dumps("Colab session not found in CLI state."), flush=True)`,
    '    sys.exit(0)',
    // Omitting the saved kernel and session IDs gives this helper its own kernel on the same VM.
    'runtime = ColabRuntime(s.url, s.token)',
    '_rt_lock = threading.Lock()',
    '_rt_stopped = [False]',
    'def _cleanup_runtime():',
    '    with _rt_lock:',
    '        if _rt_stopped[0]:',
    '            return',
    '        _rt_stopped[0] = True',
    '    runtime.stop(shutdown_kernel=True)',
    'def _terminate(*_):',
    '    raise SystemExit(1)',
    'signal.signal(signal.SIGTERM, _terminate)',
    'def _emit_outputs(outputs):',
    '    for out in outputs or []:',
    '        if "text" in out:',
    '            sys.stdout.write(out["text"])',
    '            sys.stdout.flush()'
  ]
}

export const driveRuntimeCleanup = ['finally:', '    _cleanup_runtime()', '']

export function driveMountedRootExpr(mountPointExpr: string): string {
  return (
    `next((_r for _r in ((${mountPointExpr}) + "/MyDrive", (${mountPointExpr}) + "/My Drive") ` +
    `if _o.path.isdir(_r) and (_o.path.ismount(${mountPointExpr}) or ` +
    `_o.stat(_r).st_dev != _o.stat(_o.path.dirname((${mountPointExpr}).rstrip("/")) or "/").st_dev)), "")`
  )
}

export function drivefsAuthHookPython(indent = '        ', expectedEmail?: string): string[] {
  const m = COLAB_NOTEBOOK_MARKER
  const acctJson = JSON.stringify(expectedEmail?.trim() || '')
  return [
    `${indent}auth_aborted = [False]`,
    `${indent}_hook_started = [False]`,
    `${indent}def _parse_resp(resp):`,
    `${indent}    text = getattr(resp, "text", "") or ""`,
    `${indent}    for cand in (text, text.split("\\n", 1)[-1], text.rsplit("\\n", 1)[-1]):`,
    `${indent}        cand = cand.strip()`,
    `${indent}        if not cand:`,
    `${indent}            continue`,
    `${indent}        try:`,
    `${indent}            obj = json.loads(cand)`,
    `${indent}        except Exception:`,
    `${indent}            continue`,
    `${indent}        if isinstance(obj, dict):`,
    `${indent}            return obj`,
    `${indent}    return {}`,
    `${indent}def _prop_err(status, data):`,
    `${indent}    acct = ${acctJson} or "the connected Colab account"`,
    `${indent}    if status == 400:`,
    `${indent}        return (f"Google Drive credentials could not be propagated (HTTP 400). Your browser likely authorized a different Google account than {acct}. Switch to {acct} or open the link in an Incognito/dedicated profile window and retry.", "account_mismatch")`,
    `${indent}    det = data.get("error") or data.get("message") or ""`,
    `${indent}    det_s = f" ({str(det).strip()[:200]})" if isinstance(det, str) and det.strip() else ""`,
    `${indent}    st_s = f" (HTTP {status})" if status is not None and status != 200 else ""`,
    `${indent}    return (f"Google Drive authorization not completed{st_s}{det_s}.", "auth_incomplete")`,
    `${indent}def _fail_auth(msg, code=None):`,
    `${indent}    if auth_aborted[0]:`,
    `${indent}        return`,
    `${indent}    auth_aborted[0] = True`,
    `${indent}    payload = {"message": msg, "code": code} if code else msg`,
    `${indent}    print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(payload), flush=True)`,
    `${indent}    _cleanup_runtime()`,
    `${indent}def drivefs_hook(deserialize_msg, wsclient):`,
    `${indent}    content = deserialize_msg.get("content", {})`,
    `${indent}    if content.get("request", {}).get("authType") != "dfs_ephemeral":`,
    `${indent}        return False`,
    `${indent}    if _hook_started[0]:`,
    `${indent}        return True`,
    `${indent}    _hook_started[0] = True`,
    `${indent}    msg_id = deserialize_msg.get("metadata", {}).get("colab_msg_id")`,
    `${indent}    def _send_ok():`,
    `${indent}        print(${JSON.stringify(m + 'DRV_AUTH_OK:1')}, flush=True)`,
    `${indent}        reply = wsclient.session.msg("input_reply", {"value": {"type": "colab_reply", "colab_msg_id": msg_id}})`,
    `${indent}        if "header" in deserialize_msg:`,
    `${indent}            reply["parent_header"] = deserialize_msg["header"]`,
    `${indent}        wsclient.stdin_channel.send(reply)`,
    `${indent}    def _worker():`,
    `${indent}        try:`,
    `${indent}            url = f"{state.client.colab_domain}/tun/m/credentials-propagation/{s.endpoint}"`,
    `${indent}            base_p = {"authuser": "0", "authtype": "dfs_ephemeral", "version": "2", "propagate": "true", "record": "false"}`,
    `${indent}            creds = get_credentials(state.client_oauth_config, provider=state.auth_provider)`,
    `${indent}            def _get_tok():`,
    `${indent}                rt = creds.request("GET", url, params=dict(base_p, dryrun="true"), timeout=30)`,
    `${indent}                dt = _parse_resp(rt)`,
    `${indent}                st = get_status_code(rt)`,
    `${indent}                return (st, dt.get("token") if st == 200 else None, dt)`,
    `${indent}            def _post(dry, tok):`,
    `${indent}                rp = creds.request("POST", url, params=dict(base_p, dryrun=dry), headers={"x-goog-colab-token": tok}, files={"file_id": (None, "empty.ipynb")}, timeout=30)`,
    `${indent}                return (get_status_code(rp), _parse_resp(rp))`,
    `${indent}            st0, tok, d0 = _get_tok()`,
    `${indent}            if not tok:`,
    `${indent}                _fail_auth(*_prop_err(st0, d0))`,
    `${indent}                return`,
    `${indent}            st1, d1 = _post("true", tok)`,
    `${indent}            if st1 == 200 and d1.get("success"):`,
    `${indent}                st2, d2 = _post("false", tok)`,
    `${indent}                if st2 == 200 and d2.get("success"):`,
    `${indent}                    _send_ok()`,
    `${indent}                    return`,
    `${indent}                uri = d2.get("unauthorized_redirect_uri") or ""`,
    `${indent}                if not uri:`,
    `${indent}                    _fail_auth(*_prop_err(st2, d2))`,
    `${indent}                    return`,
    `${indent}            else:`,
    `${indent}                uri = d1.get("unauthorized_redirect_uri") or ""`,
    `${indent}                if not uri:`,
    `${indent}                    _fail_auth(*_prop_err(st1, d1))`,
    `${indent}                    return`,
    `${indent}            print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri}), flush=True)`,
    `${indent}            wake = threading.Event()`,
    `${indent}            cmd_q, stdin_eof = [], [False]`,
    `${indent}            def _stdin_reader():`,
    `${indent}                while not auth_aborted[0]:`,
    `${indent}                    try:`,
    `${indent}                        ln = sys.stdin.readline()`,
    `${indent}                    except Exception:`,
    `${indent}                        ln = ""`,
    `${indent}                    if not ln:`,
    `${indent}                        stdin_eof[0] = True`,
    `${indent}                        return`,
    `${indent}                    cmd_q.append(ln.strip())`,
    `${indent}                    wake.set()`,
    `${indent}            threading.Thread(target=_stdin_reader, daemon=True).start()`,
    `${indent}            first_poll = True`,
    `${indent}            while not auth_aborted[0]:`,
    `${indent}                wake.wait(8.0 if first_poll else 5.0)`,
    `${indent}                first_poll = False`,
    `${indent}                wake.clear()`,
    `${indent}                if auth_aborted[0]:`,
    `${indent}                    return`,
    `${indent}                manual = False`,
    `${indent}                while cmd_q:`,
    `${indent}                    c = cmd_q.pop(0)`,
    `${indent}                    if c == "CONTINUE":`,
    `${indent}                        manual = True`,
    `${indent}                    elif c != "":`,
    `${indent}                        _fail_auth("Google Drive authorization canceled.", "canceled")`,
    `${indent}                        return`,
    `${indent}                try:`,
    `${indent}                    stt, ftok, dt = _get_tok()`,
    `${indent}                    if not ftok:`,
    `${indent}                        if manual:`,
    `${indent}                            _fail_auth(*_prop_err(stt, dt))`,
    `${indent}                            return`,
    `${indent}                        continue`,
    `${indent}                    if manual or stdin_eof[0]:`,
    `${indent}                        stp, dp = _post("false", ftok)`,
    `${indent}                        if stp == 200 and dp.get("success"):`,
    `${indent}                            _send_ok()`,
    `${indent}                            return`,
    `${indent}                        n_uri = dp.get("unauthorized_redirect_uri") or ""`,
    `${indent}                        if n_uri:`,
    `${indent}                            uri = n_uri`,
    `${indent}                            if manual:`,
    `${indent}                                print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri, "reason": "incomplete"}), flush=True)`,
    `${indent}                            continue`,
    `${indent}                        if manual and stp == 400:`,
    `${indent}                            _, dr = _post("true", ftok)`,
    `${indent}                            r_uri = dr.get("unauthorized_redirect_uri") or ""`,
    `${indent}                            if r_uri:`,
    `${indent}                                uri = r_uri`,
    `${indent}                                print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri, "reason": "account_mismatch"}), flush=True)`,
    `${indent}                                continue`,
    `${indent}                        _fail_auth(*_prop_err(stp, dp))`,
    `${indent}                        return`,
    `${indent}                    stc, dc = _post("true", ftok)`,
    `${indent}                    if stc == 200 and dc.get("success"):`,
    `${indent}                        stp, dp = _post("false", ftok)`,
    `${indent}                        if stp == 200 and dp.get("success"):`,
    `${indent}                            _send_ok()`,
    `${indent}                            return`,
    `${indent}                        if stp == 400:`,
    `${indent}                            _, dr = _post("true", ftok)`,
    `${indent}                            r_uri = dr.get("unauthorized_redirect_uri") or ""`,
    `${indent}                            if r_uri:`,
    `${indent}                                uri = r_uri`,
    `${indent}                                print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri, "reason": "account_mismatch"}), flush=True)`,
    `${indent}                                continue`,
    `${indent}                        _fail_auth(*_prop_err(stp, dp))`,
    `${indent}                        return`,
    `${indent}                    elif stc == 400:`,
    `${indent}                        _fail_auth(*_prop_err(stc, dc))`,
    `${indent}                        return`,
    `${indent}                except Exception:`,
    `${indent}                    if manual:`,
    `${indent}                        print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri, "reason": "incomplete"}), flush=True)`,
    `${indent}        except Exception as ex:`,
    `${indent}            _fail_auth(str(ex))`,
    `${indent}    threading.Thread(target=_worker, daemon=True).start()`,
    `${indent}    return True`,
    `${indent}runtime.colab_request_hook = drivefs_hook`
  ]
}

export function buildDriveProbeSessionPython(
  sessionsJsonPath: string,
  sessionName: string,
  mountPoint = '/content/drive'
): string {
  const m = COLAB_NOTEBOOK_MARKER
  const mp = sanitizeDriveMountPoint(mountPoint)
  const vmCode = [
    'import json as _j, os as _o',
    `_mp = ${JSON.stringify(mp)}`,
    'try:',
    `    _p = ${driveMountedRootExpr('_mp')}`,
    'except OSError:',
    '    _p = ""',
    `print(${JSON.stringify(m + 'DRV_MOUNTED:')} + _j.dumps({"mounted": bool(_p), "mountPath": _p}), flush=True)`
  ].join('\n')
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'try:',
    `    _emit_outputs(runtime.execute_code(${JSON.stringify(vmCode)}, timeout=20))`,
    'except Exception as ex:',
    `    print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(str(ex)), flush=True)`,
    ...driveRuntimeCleanup
  ].join('\n')
}

export {
  buildArtifactListPython,
  buildDriveFlushSessionPython,
  buildFlushMountedDriveIfPresentPython,
  isGoogleDriveRemotePath,
  parseArtifactListOutput,
  resolveColabRemoteDir,
  runSessionDriveFlushHelper
} from './colab-drive-artifacts'

export function buildDriveMountSessionPython(
  sessionsJsonPath: string,
  sessionName: string,
  options?: { forceRemount?: boolean; mountPoint?: string; expectedEmail?: string }
): string {
  const m = COLAB_NOTEBOOK_MARKER
  const mp = sanitizeDriveMountPoint(options?.mountPoint)
  const forcePy = options?.forceRemount ? 'True' : 'False'
  const checkCode = [
    'import json as _j, os as _o',
    `_mp = ${JSON.stringify(mp)}`,
    'try:',
    `    _p = ${driveMountedRootExpr('_mp')}`,
    'except OSError:',
    '    _p = ""',
    'print("KUN_MOUNTED:" + ("1:" + _p if _p else "0"), flush=True)'
  ].join('\n')
  const verifyCode = [
    'import json as _j, os as _o',
    `_mp = ${JSON.stringify(mp)}`,
    'try:',
    `    _p = ${driveMountedRootExpr('_mp')}`,
    'except OSError:',
    '    _p = ""',
    'if _p:',
    `    print(${JSON.stringify(m + 'DRV_MOUNTED:')} + _j.dumps({"mounted": True, "mountPath": _p}), flush=True)`,
    'else:',
    `    print(${JSON.stringify(m + 'DRV_ERR:')} + _j.dumps("Google Drive mount folder was not created."), flush=True)`
  ].join('\n')
  const mountCall = `from google.colab import drive\ndrive.mount(${JSON.stringify(mp)}, force_remount=${forcePy}, timeout_ms=600000)`
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'from colab_cli.auth import get_credentials',
    'from colab_cli.utils import get_status_code',
    'try:',
    `    force = ${forcePy}`,
    '    already = ""',
    '    if not force:',
    `        chk = runtime.execute_code(${JSON.stringify(checkCode)}, timeout=20)`,
    '        for o in (chk or []):',
    '            for ln in (o.get("text") or "").splitlines():',
    '                if ln.startswith("KUN_MOUNTED:1:"):',
    '                    already = ln[len("KUN_MOUNTED:1:"):]',
    '    if already:',
    `        print(${JSON.stringify(m + 'DRV_MOUNTED:')} + json.dumps({"mounted": True, "mountPath": already}), flush=True)`,
    '    else:',
    ...drivefsAuthHookPython('        ', options?.expectedEmail),
    `        m_out = runtime.execute_code(${JSON.stringify(mountCall)}, allow_stdin=True, timeout=600)`,
    '        if auth_aborted[0]:',
    '            sys.exit(0)',
    '        for o in (m_out or []):',
    '            if o.get("output_type") == "error":',
    '                ev = str(o.get("evalue", ""))',
    '                if "Mountpoint must not already contain files" in ev:',
    `                    msg = f"${mp} on the VM already contains local files created before Drive was mounted. Move or remove local files under ${mp} and mount again."`,
    '                else:',
    '                    msg = f"{o.get(\'ename\', \'Error\')}: {ev}"',
    `                print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(msg), flush=True)`,
    '                sys.exit(0)',
    `        _emit_outputs(runtime.execute_code(${JSON.stringify(verifyCode)}, timeout=20))`,
    'except Exception as ex:',
    '    if not auth_aborted[0]:',
    `        print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(str(ex)), flush=True)`,
    ...driveRuntimeCleanup
  ].join('\n')
}

export function buildDriveUnmountSessionPython(
  sessionsJsonPath: string,
  sessionName: string
): string {
  const m = COLAB_NOTEBOOK_MARKER
  const unmountCall = [
    'from google.colab import drive',
    'drive.flush_and_unmount()',
    `print(${JSON.stringify(m + 'DRV_UNMOUNTED:1')}, flush=True)`
  ].join('\n')
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'try:',
    `    u_out = runtime.execute_code(${JSON.stringify(unmountCall)}, timeout=120)`,
    '    for o in (u_out or []):',
    '        if o.get("output_type") == "error":',
    `            print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(f"{o.get('ename', 'Error')}: {o.get('evalue', '')}"), flush=True)`,
    '            sys.exit(0)',
    '    _emit_outputs(u_out)',
    'except Exception as ex:',
    `    print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(str(ex)), flush=True)`,
    ...driveRuntimeCleanup
  ].join('\n')
}

export function parseDriveMountMarkerLine(
  line: string
):
  | { kind: 'mounted'; mounted: boolean; mountPath: string }
  | { kind: 'unmounted' }
  | { kind: 'auth'; uri: string; reason?: ColabDriveAuthHint }
  | { kind: 'auth_ok' }
  | { kind: 'error'; message: string; code?: ColabDriveErrorCode }
  | null {
  if (!line.startsWith(COLAB_NOTEBOOK_MARKER)) return null
  const body = line.slice(COLAB_NOTEBOOK_MARKER.length)
  if (body.startsWith('DRV_MOUNTED:')) {
    try {
      const parsed = JSON.parse(body.slice(12)) as { mounted?: boolean; mountPath?: string }
      return {
        kind: 'mounted',
        mounted: Boolean(parsed.mounted),
        mountPath: String(parsed.mountPath ?? '')
      }
    } catch {
      return { kind: 'error', message: 'Invalid Drive mount status payload.' }
    }
  }
  if (body.startsWith('DRV_UNMOUNTED:')) return { kind: 'unmounted' }
  if (body.startsWith('DRV_AUTH_OK:')) return { kind: 'auth_ok' }
  if (body.startsWith('DRV_AUTH:')) {
    try {
      const parsed = JSON.parse(body.slice(9)) as { uri?: string; reason?: string }
      const reason =
        parsed.reason === 'incomplete' || parsed.reason === 'account_mismatch'
          ? parsed.reason
          : undefined
      return {
        kind: 'auth',
        uri: String(parsed.uri ?? ''),
        ...(reason ? { reason } : {})
      }
    } catch {
      return null
    }
  }
  if (body.startsWith('DRV_ERR:')) {
    try {
      const parsed = JSON.parse(body.slice(8)) as string | { message?: unknown; code?: unknown }
      if (parsed && typeof parsed === 'object') {
        const rawCode = parsed.code
        const code =
          rawCode === 'auth_expired' ||
          rawCode === 'auth_incomplete' ||
          rawCode === 'account_mismatch' ||
          rawCode === 'canceled'
            ? rawCode
            : undefined
        return {
          kind: 'error',
          message: String(parsed.message ?? ''),
          ...(code ? { code } : {})
        }
      }
      return { kind: 'error', message: String(parsed) }
    } catch {
      return { kind: 'error', message: body.slice(8) }
    }
  }
  return null
}

export async function runSessionDriveProbeHelper(options: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  env: Record<string, string>
  mountPoint?: string
  signal?: AbortSignal
  spawnProcess?: typeof spawn
}): Promise<{ mounted: boolean; mountPath: string }> {
  if (options.signal?.aborted) return { mounted: false, mountPath: '' }
  const script = buildDriveProbeSessionPython(
    options.sessionsJsonPath,
    options.sessionName,
    options.mountPoint
  )
  const spawnFn = options.spawnProcess ?? spawn
  const child = spawnFn(options.pythonPath, ['-c', script], {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const abort = (): void => terminateDriveHelper(child)
  options.signal?.addEventListener('abort', abort, { once: true })
  const output = await new Promise<string>((resolve) => {
    let stdout = ''
    const timer = setTimeout(abort, 25_000)
    child.stderr?.resume()
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32_768) stdout += chunk.toString('utf8')
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(stdout)
    })
    child.once('close', () => {
      clearTimeout(timer)
      resolve(stdout)
    })
  })
  options.signal?.removeEventListener('abort', abort)
  for (const line of output.split(/\r?\n/)) {
    const marker = parseDriveMountMarkerLine(line)
    if (marker?.kind === 'mounted') {
      return { mounted: marker.mounted && Boolean(marker.mountPath), mountPath: marker.mountPath }
    }
  }
  return { mounted: false, mountPath: '' }
}

export async function runSessionDriveMountHelper(options: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  env: Record<string, string>
  expectedEmail?: string
  signal?: AbortSignal
  openExternal?: (url: string) => Promise<void>
  onLog?: (line: string) => void
  spawnProcess?: typeof spawn
}): Promise<{ ok: true; mountPath: string } | { ok: false; message: string }> {
  if (options.signal?.aborted) {
    return { ok: false, message: 'Google Drive mount canceled.' }
  }
  const script = buildDriveMountSessionPython(options.sessionsJsonPath, options.sessionName, {
    expectedEmail: options.expectedEmail
  })
  const spawnFn = options.spawnProcess ?? spawn
  const child = spawnFn(options.pythonPath, ['-c', script], {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const abort = (): void => terminateDriveHelper(child)
  let timer = setTimeout(abort, 90_000)
  const resetTimer = (ms: number): void => {
    clearTimeout(timer)
    timer = setTimeout(abort, ms)
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  child.stderr?.resume()

  const decoder = new StringDecoder('utf8')
  let remainder = ''
  let openedAuth = false
  let mountedPath = ''
  let errMsg = ''

  const handleLine = (line: string): void => {
    const marker = parseDriveMountMarkerLine(line)
    if (!marker) return
    if (marker.kind === 'auth' && !openedAuth) {
      const url = checkedDriveAuthUrl(marker.uri)
      if (!url) {
        errMsg = 'Google returned an unusable Drive authorization link.'
        abort()
        return
      }
      openedAuth = true
      resetTimer(DRIVE_AUTH_WAIT_TIMEOUT_MS)
      options.onLog?.(`[colab] Waiting for Google Drive authorization in browser: ${url}`)
      void options.openExternal?.(url).catch(() => undefined)
    } else if (marker.kind === 'auth_ok') {
      resetTimer(90_000)
      options.onLog?.('[colab] Google Drive authorization confirmed; mounting /content/drive…')
    } else if (marker.kind === 'mounted' && marker.mounted && marker.mountPath) {
      mountedPath = marker.mountPath
    } else if (marker.kind === 'error') {
      errMsg = marker.message
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = (remainder + decoder.write(chunk)).split(/\r?\n/)
    remainder = (lines.pop() ?? '').slice(0, 128_000)
    lines.forEach(handleLine)
  })

  await new Promise<void>((resolve) => {
    child.once('close', () => resolve())
    child.once('error', () => resolve())
  })
  clearTimeout(timer)
  options.signal?.removeEventListener('abort', abort)
  const tail = remainder + decoder.end()
  if (tail) handleLine(tail)

  if (mountedPath) return { ok: true, mountPath: mountedPath }
  return { ok: false, message: errMsg || 'Could not mount Google Drive at /content/drive.' }
}
