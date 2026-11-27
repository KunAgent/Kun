import { spawn } from 'node:child_process'
import { posix } from 'node:path'
import {
  driveMountedRootExpr,
  driveRuntimeCleanup,
  driveRuntimeSetup,
  terminateDriveHelper
} from './colab-drive-protocol'

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
