import { spawn, type ChildProcess } from 'node:child_process'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { COLAB_NOTEBOOK_MARKER } from '../../shared/colab/colab-notebook-types'

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
    'import json, signal, sys',
    'from colab_cli.common import state',
    'from colab_cli.runtime import ColabRuntime',
    `state.config_path = ${JSON.stringify(sessionsJsonPath)}`,
    `s = state.get_session(${JSON.stringify(sessionName)}, ignore_missing_session=True)`,
    'if s is None:',
    `    print(${JSON.stringify(COLAB_NOTEBOOK_MARKER + 'DRV_ERR:')} + json.dumps("Colab session not found in CLI state."), flush=True)`,
    '    sys.exit(0)',
    // Omitting the saved kernel and session IDs gives this helper its own kernel on the same VM.
    'runtime = ColabRuntime(s.url, s.token)',
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

export const driveRuntimeCleanup = ['finally:', '    runtime.stop(shutdown_kernel=True)', '']

export function driveMountedRootExpr(mountPointExpr: string): string {
  return (
    `next((_r for _r in ((${mountPointExpr}) + "/MyDrive", (${mountPointExpr}) + "/My Drive") ` +
    `if _o.path.isdir(_r) and (_o.path.ismount(${mountPointExpr}) or ` +
    `_o.stat(_r).st_dev != _o.stat(_o.path.dirname((${mountPointExpr}).rstrip("/")) or "/").st_dev)), "")`
  )
}

export function drivefsAuthHookPython(indent = '        '): string[] {
  const m = COLAB_NOTEBOOK_MARKER
  return [
    `${indent}auth_aborted = [False]`,
    `${indent}def drivefs_hook(deserialize_msg, wsclient):`,
    `${indent}    import threading`,
    `${indent}    content = deserialize_msg.get("content", {})`,
    `${indent}    if content.get("request", {}).get("authType") != "dfs_ephemeral":`,
    `${indent}        return False`,
    `${indent}    msg_id = deserialize_msg.get("metadata", {}).get("colab_msg_id")`,
    `${indent}    url = f"{state.client.colab_domain}/tun/m/credentials-propagation/{s.endpoint}"`,
    `${indent}    params = {"authuser": "0", "authtype": "dfs_ephemeral", "version": "2", "dryrun": "true", "propagate": "true", "record": "false"}`,
    `${indent}    creds = get_credentials(state.client_oauth_config, provider=state.auth_provider)`,
    `${indent}    r0 = creds.request("GET", url, params=params)`,
    `${indent}    tok = _parse_json(r0.text).get("token") if get_status_code(r0) == 200 else None`,
    `${indent}    headers = {"x-goog-colab-token": tok}`,
    `${indent}    r1 = creds.request("POST", url, params=params, headers=headers, files={"file_id": (None, "empty.ipynb")})`,
    `${indent}    data = _parse_json(r1.text)`,
    `${indent}    if not data.get("success"):`,
    `${indent}        uri = data.get("unauthorized_redirect_uri") or ""`,
    `${indent}        print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri}), flush=True)`,
    `${indent}        wake = threading.Event()`,
    `${indent}        cmd_q = []`,
    `${indent}        def _stdin_reader():`,
    `${indent}            while not auth_aborted[0]:`,
    `${indent}                ln = sys.stdin.readline()`,
    `${indent}                if not ln:`,
    `${indent}                    return`,
    `${indent}                cmd_q.append(ln.strip())`,
    `${indent}                wake.set()`,
    `${indent}        threading.Thread(target=_stdin_reader, daemon=True).start()`,
    `${indent}        while not data.get("success"):`,
    `${indent}            wake.wait(3.0)`,
    `${indent}            wake.clear()`,
    `${indent}            manual = False`,
    `${indent}            while cmd_q:`,
    `${indent}                c = cmd_q.pop(0)`,
    `${indent}                if c == "CONTINUE":`,
    `${indent}                    manual = True`,
    `${indent}                elif c != "":`,
    `${indent}                    auth_aborted[0] = True`,
    `${indent}                    print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps("Google Drive authorization canceled."), flush=True)`,
    `${indent}                    return True`,
    `${indent}            try:`,
    `${indent}                fresh = creds.request("GET", url, params=params)`,
    `${indent}                if get_status_code(fresh) == 200:`,
    `${indent}                    headers = {"x-goog-colab-token": _parse_json(fresh.text).get("token")}`,
    `${indent}                    data = _parse_json(creds.request("POST", url, params=params, headers=headers, files={"file_id": (None, "empty.ipynb")}).text)`,
    `${indent}            except Exception:`,
    `${indent}                data = {}`,
    `${indent}            if manual and not data.get("success"):`,
    `${indent}                uri = data.get("unauthorized_redirect_uri") or uri`,
    `${indent}                print(${JSON.stringify(m + 'DRV_AUTH:')} + json.dumps({"uri": uri}), flush=True)`,
    `${indent}    params["dryrun"] = "false"`,
    `${indent}    r2 = creds.request("POST", url, params=params, headers=headers, files={"file_id": (None, "empty.ipynb")})`,
    `${indent}    if get_status_code(r2) == 200:`,
    `${indent}        print(${JSON.stringify(m + 'DRV_AUTH_OK:1')}, flush=True)`,
    `${indent}        reply = wsclient.session.msg("input_reply", {"value": {"type": "colab_reply", "colab_msg_id": msg_id}})`,
    `${indent}        if "header" in deserialize_msg:`,
    `${indent}            reply["parent_header"] = deserialize_msg["header"]`,
    `${indent}        wsclient.stdin_channel.send(reply)`,
    `${indent}    else:`,
    `${indent}        auth_aborted[0] = True`,
    `${indent}        print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(f"Google Drive authorization not completed (HTTP {get_status_code(r2)})."), flush=True)`,
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

export function buildDriveMountSessionPython(
  sessionsJsonPath: string,
  sessionName: string,
  options?: { forceRemount?: boolean; mountPoint?: string }
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
  const mountCall = `from google.colab import drive\ndrive.mount(${JSON.stringify(mp)}, force_remount=${forcePy})`
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'from colab_cli.auth import get_credentials',
    'from colab_cli.utils import get_status_code',
    'def _parse_json(raw):',
    '    try:',
    '        body = raw.split("\\n", 1)[-1] if raw.lstrip().startswith(")]}\'") else raw',
    '        parsed = json.loads(body)',
    '        return parsed if isinstance(parsed, dict) else {}',
    '    except Exception:',
    '        return {}',
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
    ...drivefsAuthHookPython('        '),
    `        m_out = runtime.execute_code(${JSON.stringify(mountCall)}, allow_stdin=True, timeout=600)`,
    '        if auth_aborted[0]:',
    '            sys.exit(0)',
    '        for o in (m_out or []):',
    '            if o.get("output_type") == "error":',
    `                print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(f"{o.get('ename', 'Error')}: {o.get('evalue', '')}"), flush=True)`,
    '                sys.exit(0)',
    `        _emit_outputs(runtime.execute_code(${JSON.stringify(verifyCode)}, timeout=20))`,
    'except Exception as ex:',
    `    print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(str(ex)), flush=True)`,
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
  | { kind: 'auth'; uri: string }
  | { kind: 'auth_ok' }
  | { kind: 'error'; message: string }
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
      const parsed = JSON.parse(body.slice(9)) as { uri?: string }
      return { kind: 'auth', uri: String(parsed.uri ?? '') }
    } catch {
      return null
    }
  }
  if (body.startsWith('DRV_ERR:')) {
    try {
      return { kind: 'error', message: String(JSON.parse(body.slice(8))) }
    } catch {
      return { kind: 'error', message: body.slice(8) }
    }
  }
  return null
}

/** Resolves relative (`outputs/`) or absolute (`/content/drive/MyDrive/ckpts`) Colab paths without doubling `/content`. */
export function resolveColabRemoteDir(remoteDir: string): string {
  const cleaned = remoteDir.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  if (!cleaned) return '/content'
  const raw =
    cleaned === '/content' || cleaned.startsWith('/content/')
      ? cleaned
      : cleaned === 'content' || cleaned.startsWith('content/')
        ? `/${cleaned}`
        : posix.join('/content', cleaned.replace(/^\/+/, ''))
  const normalized = posix.normalize(raw)
  return normalized === '/content' || normalized.startsWith('/content/') ? normalized : '/content'
}

export function isGoogleDriveRemotePath(remoteDir: string): boolean {
  const resolved = resolveColabRemoteDir(remoteDir)
  return resolved === '/content/drive' || resolved.startsWith('/content/drive/')
}

export function buildArtifactListPython(remoteDir: string): string {
  const root = resolveColabRemoteDir(remoteDir)
  return [
    'import json, os as _o',
    `root = ${JSON.stringify(root)}`,
    'try:',
    `    _drv = bool(${driveMountedRootExpr('"/content/drive"')})`,
    'except OSError:',
    '    _drv = False',
    '_root_mounted = False',
    'try:',
    '    _cdev = _o.stat("/content").st_dev',
    '    _probe = root',
    '    while _probe and _probe != "/" and _probe != "/content" and not _o.path.exists(_probe):',
    '        _probe = _o.path.dirname(_probe)',
    '    if _probe and _probe != "/" and _probe != "/content" and _o.path.exists(_probe):',
    '        _root_mounted = _o.stat(_probe).st_dev != _cdev',
    'except OSError:',
    '    _root_mounted = False',
    'items = []',
    'if _o.path.isdir(root):',
    '    _files, _dirs = [], []',
    '    try:',
    '        with _o.scandir(root) as _it:',
    '            for _e in _it:',
    '                if _e.name.startswith("."):',
    '                    continue',
    '                try:',
    '                    _st = _e.stat()',
    '                    if _e.is_file():',
    '                        _files.append((_e.name, _e.path, _st.st_size))',
    '                    elif _e.is_dir():',
    '                        _dirs.append((_st.st_mtime, _e.name, _e.path))',
    '                except OSError:',
    '                    continue',
    '    except OSError:',
    '        pass',
    '    for _n, _fp, _sz in sorted(_files, key=lambda x: x[0])[:40]:',
    '        items.append({"name": _n, "remotePath": _o.path.relpath(_fp, "/"), "sizeBytes": _sz})',
    '    for _, _dn, _dp in sorted(_dirs, key=lambda x: (-x[0], x[1]))[:20]:',
    '        if len(items) >= 40:',
    '            break',
    '        try:',
    '            with _o.scandir(_dp) as _sit:',
    '                _subs = []',
    '                for _se in _sit:',
    '                    try:',
    '                        if _se.is_file():',
    '                            _subs.append((_se.name, _se.path, _se.stat().st_size))',
    '                    except OSError:',
    '                        continue',
    '            for _sn, _sp, _ssz in sorted(_subs, key=lambda x: x[0])[:8]:',
    '                if len(items) >= 40:',
    '                    break',
    '                items.append({"name": _dn + "/" + _sn, "remotePath": _o.path.relpath(_sp, "/"), "sizeBytes": _ssz})',
    '        except OSError:',
    '            continue',
    'print("KUN_ARTIFACTS:" + json.dumps({"items": items, "driveMounted": _drv, "rootMounted": _root_mounted}), flush=True)',
    ''
  ].join('\n')
}

export function parseArtifactListOutput<T>(stdout: string): {
  items: T[]
  driveMounted: boolean
  rootMounted: boolean
} {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('KUN_ARTIFACTS:'))
  if (!line) return { items: [], driveMounted: false, rootMounted: false }
  try {
    const parsed = JSON.parse(line.slice('KUN_ARTIFACTS:'.length)) as
      | T[]
      | { items?: T[]; driveMounted?: boolean; rootMounted?: boolean }
    if (Array.isArray(parsed)) return { items: parsed, driveMounted: true, rootMounted: true }
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      driveMounted: Boolean(parsed.driveMounted),
      rootMounted: Boolean(parsed.rootMounted)
    }
  } catch {
    return { items: [], driveMounted: false, rootMounted: false }
  }
}

export function buildFlushMountedDriveIfPresentPython(): string {
  return [
    'import os as _o',
    '_cands = ["/content/drive"]',
    'try:',
    '    _cfg = "/root/.config/Google/DriveFS/mount_point"',
    '    if _o.path.isfile(_cfg):',
    '        _mp = open(_cfg, "r", encoding="utf-8", errors="ignore").read().strip()',
    '        if _mp and _mp not in _cands:',
    '            _cands.append(_mp)',
    'except OSError:',
    '    pass',
    'try:',
    '    with open("/proc/mounts", "r", encoding="utf-8", errors="ignore") as _mf:',
    '        for _ln in _mf:',
    '            _ps = _ln.split()',
    '            if len(_ps) >= 3 and (_ps[2].startswith("fuse") or _ps[0] == "drive"):',
    '                _mp = _ps[1].replace("\\\\040", " ")',
    '                if _mp not in _cands:',
    '                    _cands.append(_mp)',
    'except OSError:',
    '    pass',
    '_mounted = False',
    'for _mp in _cands:',
    '    _mp = _mp.rstrip("/") or "/"',
    '    if _mp == "/":',
    '        continue',
    '    try:',
    `        if ${driveMountedRootExpr('_mp')}:`,
    '            _mounted = True',
    '            break',
    '    except OSError:',
    '        continue',
    'if _mounted:',
    '    from google.colab import drive',
    '    drive.flush_and_unmount()',
    '    print("KUN_DRIVE_FLUSHED:1", flush=True)',
    ''
  ].join('\n')
}

export function buildDriveFlushSessionPython(sessionsJsonPath: string, sessionName: string): string {
  const flushVmCode = buildFlushMountedDriveIfPresentPython()
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'try:',
    `    _emit_outputs(runtime.execute_code(${JSON.stringify(flushVmCode)}, timeout=120))`,
    'except Exception:',
    '    pass',
    ...driveRuntimeCleanup
  ].join('\n')
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

export async function runSessionDriveFlushHelper(options: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  env: Record<string, string>
  spawnProcess?: typeof spawn
}): Promise<boolean> {
  const script = buildDriveFlushSessionPython(options.sessionsJsonPath, options.sessionName)
  const spawnFn = options.spawnProcess ?? spawn
  const child = spawnFn(options.pythonPath, ['-c', script], {
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = await new Promise<string>((resolve) => {
    let stdout = ''
    const timer = setTimeout(() => terminateDriveHelper(child), 125_000)
    child.stderr?.resume()
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 16_384) stdout += chunk.toString('utf8')
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
  return output.includes('KUN_DRIVE_FLUSHED:1')
}

export async function runSessionDriveMountHelper(options: {
  pythonPath: string
  sessionsJsonPath: string
  sessionName: string
  env: Record<string, string>
  signal?: AbortSignal
  openExternal?: (url: string) => Promise<void>
  onLog?: (line: string) => void
  spawnProcess?: typeof spawn
}): Promise<{ ok: true; mountPath: string } | { ok: false; message: string }> {
  if (options.signal?.aborted) {
    return { ok: false, message: 'Google Drive mount canceled.' }
  }
  const script = buildDriveMountSessionPython(options.sessionsJsonPath, options.sessionName)
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
