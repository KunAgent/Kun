import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { shell } from 'electron'
import {
  COLAB_DRIVE_PULL_SESSION_PREFIX,
  COLAB_NOTEBOOK_ENTRY_COMMAND,
  COLAB_NOTEBOOK_MARKER,
  NOTEBOOK_IMPORT_MAX_BYTES,
  NOTEBOOK_PULL_MAX_FILES,
  type ColabDriveAuthHint,
  type ColabDriveErrorCode,
  type ColabDriveNotebookEntry,
  type ColabDriveNotebooksListResult,
  type ColabDrivePullCloseResult,
  type ColabDrivePullStart,
  type ColabNotebookImportResult,
  type NotebookPullImportResult
} from '../../shared/colab/colab-notebook-types'
import type { ColabService } from './colab-service'
import {
  checkedDriveAuthUrl,
  DRIVE_AUTH_WAIT_TIMEOUT_MS,
  drivefsAuthHookPython,
  driveMountedRootExpr,
  driveRuntimeCleanup,
  driveRuntimeSetup,
  terminateDriveHelper
} from './colab-drive-mount'
import { normalizeWorkspaceKey } from './colab-state-store'
import { isValidIpynbBytes, resolveNotebookImportRoot, writeNonCollidingNotebook } from './notebook-import-file'

const TEMPORARY_RUNTIME_LIMIT_MS = 15 * 60 * 1000
const STOP_UNCONFIRMED = 'Colab did not confirm that the temporary CPU stopped.'

const VM_SCAN_CODE = [
  'def _kun_scan_drive():',
  '    import json as _j, os as _o',
  '    try:',
  `        _root = ${driveMountedRootExpr('"/content/drive"')}`,
  '    except OSError:',
  '        _root = ""',
  '    if not _root:',
  `        print(${JSON.stringify(COLAB_NOTEBOOK_MARKER + 'DRV_ERR:')} + _j.dumps("Google Drive is not mounted at /content/drive/MyDrive."), flush=True)`,
  '        return',
  '    _skip = {".Trash", ".ipynb_checkpoints", "__pycache__", "node_modules", "venv", ".venv", ".git"}',
  '    _seen = set()',
  '    _items = []',
  '    _budget = [180]',
  '    def _walk(_dir, _depth, _max_d):',
  '        if _budget[0] <= 0 or _depth > _max_d:',
  '            return',
  '        _budget[0] -= 1',
  '        try:',
  '            with _o.scandir(_dir) as _it:',
  '                _entries = list(_it)',
  '        except OSError:',
  '            return',
  '        _subdirs = []',
  '        for _e in _entries:',
  '            _nm = _e.name',
  '            if _nm.startswith(".") or _nm in _skip:',
  '                continue',
  '            try:',
  '                if _e.is_dir(follow_symlinks=False):',
  '                    _subdirs.append(_e.path)',
  '                elif _nm.lower().endswith(".ipynb"):',
  '                    _rp = _o.path.realpath(_e.path)',
  '                    if _rp in _seen:',
  '                        continue',
  '                    _seen.add(_rp)',
  '                    _st = _e.stat()',
  '                    _rel = _o.path.relpath(_e.path, _root).replace("\\\\", "/")',
  '                    _items.append({"name": _nm, "remotePath": _e.path, "relativePath": _rel, "sizeBytes": int(_st.st_size), "modifiedAtMs": int(_st.st_mtime * 1000)})',
  '            except OSError:',
  '                continue',
  '        for _sd in sorted(_subdirs):',
  '            _walk(_sd, _depth + 1, _max_d)',
  '    _colab_dir = _o.path.join(_root, "Colab Notebooks")',
  '    if _o.path.isdir(_colab_dir):',
  '        _walk(_colab_dir, 1, 4)',
  '    _walk(_root, 0, 2)',
  '    _items.sort(key=lambda x: x["modifiedAtMs"], reverse=True)',
  `    print(${JSON.stringify(COLAB_NOTEBOOK_MARKER + 'DRV_LIST:')} + _j.dumps(_items[:${NOTEBOOK_PULL_MAX_FILES}]), flush=True)`,
  '_kun_scan_drive()',
  'del _kun_scan_drive'
].join('\n')

export function buildDriveMountAndListPython(
  sessionsJsonPath: string,
  sessionName: string,
  expectedEmail?: string
): string {
  const m = COLAB_NOTEBOOK_MARKER
  const checkMountedCode = [
    'import os as _o',
    'try:',
    `    _p = ${driveMountedRootExpr('"/content/drive"')}`,
    'except OSError:',
    '    _p = ""',
    'print("KUN_MOUNTED:" + ("1" if _p else "0"), flush=True)'
  ].join('\n')
  return [
    ...driveRuntimeSetup(sessionsJsonPath, sessionName),
    'from colab_cli.auth import get_credentials',
    'from colab_cli.utils import get_status_code',
    'try:',
    `    chk = runtime.execute_code(${JSON.stringify(checkMountedCode)}, timeout=20)`,
    '    mounted = any("KUN_MOUNTED:1" in (o.get("text") or "") for o in (chk or []))',
    '    if not mounted:',
    ...drivefsAuthHookPython('        ', expectedEmail),
    '        m_out = runtime.execute_code("from google.colab import drive\\ndrive.mount(\\"/content/drive\\", timeout_ms=600000)", allow_stdin=True, timeout=600)',
    '        if auth_aborted[0]:',
    '            sys.exit(0)',
    '        for o in (m_out or []):',
    '            if o.get("output_type") == "error":',
    `                print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(f"{o.get('ename', 'Error')}: {o.get('evalue', '')}"), flush=True)`,
    '                sys.exit(0)',
    `    _emit_outputs(runtime.execute_code(${JSON.stringify(VM_SCAN_CODE)}, timeout=45))`,
    'except Exception as ex:',
    '    if not auth_aborted[0]:',
    `        print(${JSON.stringify(m + 'DRV_ERR:')} + json.dumps(str(ex)), flush=True)`,
    ...driveRuntimeCleanup
  ].join('\n')
}

export function buildDriveReadFilePython(remotePath: string): string {
  const m = COLAB_NOTEBOOK_MARKER
  const b64Path = Buffer.from(remotePath, 'utf8').toString('base64')
  return [
    'def _kun_read_nb(_p64):',
    '    import base64 as _b, json as _j, os as _o',
    '    try:',
    `        _mounted_root = ${driveMountedRootExpr('"/content/drive"')}`,
    '    except OSError:',
    '        _mounted_root = ""',
    '    _p = _o.path.realpath(_b.b64decode(_p64).decode("utf-8"))',
    '    _roots = ([_o.path.realpath(_mounted_root) + _o.sep] if _mounted_root else [])',
    '    if not _roots or not any(_p.startswith(p) for p in _roots) or not _o.path.isfile(_p):',
    `        print(${JSON.stringify(m + 'DRV_ERR:')} + _j.dumps("Notebook file not found on Google Drive."), flush=True)`,
    '        return',
    `    if _o.path.getsize(_p) > ${NOTEBOOK_IMPORT_MAX_BYTES}:`,
    `        print(${JSON.stringify(m + 'DRV_ERR:')} + _j.dumps("Notebook exceeds 16 MB limit."), flush=True)`,
    '        return',
    '    with open(_p, "rb") as _f:',
    `        _bytes = _f.read(${NOTEBOOK_IMPORT_MAX_BYTES + 1})`,
    `    if len(_bytes) > ${NOTEBOOK_IMPORT_MAX_BYTES}:`,
    `        print(${JSON.stringify(m + 'DRV_ERR:')} + _j.dumps("Notebook exceeds 16 MB limit."), flush=True)`,
    '        return',
    '    _raw = _b.b64encode(_bytes).decode("ascii")',
    `    print(${JSON.stringify(m + 'DRV_FILE:')} + _raw, flush=True)`,
    `_kun_read_nb(${JSON.stringify(b64Path)})`,
    'del _kun_read_nb',
    ''
  ].join('\n')
}

function buildDriveReadHelperPython(session: DriveSession, remotePath: string): string {
  return [
    ...driveRuntimeSetup(session.sessionsJsonPath, session.sessionName),
    'try:',
    `    _emit_outputs(runtime.execute_code(${JSON.stringify(buildDriveReadFilePython(remotePath))}, timeout=60))`,
    ...driveRuntimeCleanup
  ].join('\n')
}

export function parseDriveMarkerLines(stdout: string):
  | { kind: 'list'; entries: ColabDriveNotebookEntry[] }
  | { kind: 'auth'; uri: string; reason?: ColabDriveAuthHint }
  | { kind: 'auth_ok' }
  | { kind: 'file'; content: Buffer }
  | { kind: 'error'; message: string; code?: ColabDriveErrorCode }
  | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(COLAB_NOTEBOOK_MARKER)) continue
    const body = line.slice(COLAB_NOTEBOOK_MARKER.length)
    if (body.startsWith('DRV_LIST:')) {
      try {
        const entries = JSON.parse(body.slice(9)) as unknown
        if (!Array.isArray(entries)) throw new Error('Expected a notebook list')
        return { kind: 'list', entries }
      } catch {
        return { kind: 'error', message: 'Invalid notebook list payload.' }
      }
    }
    if (body.startsWith('DRV_AUTH_OK:')) return { kind: 'auth_ok' }
    if (body.startsWith('DRV_AUTH:')) {
      try {
        const parsed = JSON.parse(body.slice(9)) as { uri?: string; reason?: string }
        const reason =
          parsed.reason === 'incomplete' || parsed.reason === 'account_mismatch'
            ? parsed.reason
            : undefined
        return { kind: 'auth', uri: String(parsed.uri ?? ''), ...(reason ? { reason } : {}) }
      } catch {
        return null
      }
    }
    if (body.startsWith('DRV_FILE:')) {
      return { kind: 'file', content: Buffer.from(body.slice(9).trim(), 'base64') }
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
          return { kind: 'error', message: String(parsed.message ?? ''), ...(code ? { code } : {}) }
        }
        return { kind: 'error', message: String(parsed) }
      } catch {
        return { kind: 'error', message: body.slice(8) }
      }
    }
  }
  return null
}

type DriveResult = ColabDriveNotebooksListResult
const ended = (expired = false): DriveResult & { ok: false } => expired
  ? { ok: false, code: 'auth_expired', message: 'Drive access expired. Prepare the source again.' }
  : { ok: false, code: 'canceled', message: 'This pull has ended.' }

type DriveSession = {
  sessionName: string
  sessionsJsonPath: string
  env: Record<string, string>
  accountEmail?: string
}
type PendingScan = {
  child: ChildProcess
  finished: Promise<void>
  settle: (result: DriveResult) => void
  authorization?: { url: string; expiresAt: number }
  authAccepted?: boolean
}
type DrivePull = {
  id: string
  workspaceRoot: string
  targetRoot?: string
  connectionId: string
  controller: AbortController
  ready: Promise<DriveSession>
  allocation?: DriveSession
  scan?: PendingScan
  cachedResult?: DriveResult
  files: Map<string, ColabDriveNotebookEntry>
  importing?: Promise<NotebookPullImportResult>
  close?: Promise<ColabDrivePullCloseResult>
  expiry?: ReturnType<typeof setTimeout>
  expired?: boolean
}

// Track only live reservations. If cleanup is still unconfirmed after exit, the normal
// Colab orphan recovery UI can discover the named runtime again on the next launch.
export const activeDrivePullSessions = new Set<string>()

/** A pull owns only a runtime it created, never the workspace notebook kernel. */
export class ColabDriveNotebookManager {
  private readonly pulls = new Map<string, DrivePull>()
  private readonly recentClosures = new Map<string, ColabDrivePullCloseResult>()
  private readonly blockedAccounts = new Set<string>()
  private shuttingDown = false

  constructor(
    private readonly service: ColabService,
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
    private readonly spawnProcess = spawn
  ) {}

  private async prepare(job: DrivePull, input: ColabDrivePullStart): Promise<DriveSession> {
    job.targetRoot = await resolveNotebookImportRoot(input.workspaceRoot)
    const snapshot = await this.service.getSnapshot()
    const account = snapshot.connections.find((conn) => conn.id === job.connectionId)
    if (account?.status !== 'connected') throw new Error('Sign in to this Colab account before pulling.')
    const borrowedId = 'sessionId' in input.runtime ? input.runtime.sessionId : undefined
    const borrowed = borrowedId && snapshot.sessions.find((session) => session.id === borrowedId &&
      session.workspaceRoot === job.workspaceRoot && session.connectionId === job.connectionId &&
      session.phase === 'running' && session.entryCommand === COLAB_NOTEBOOK_ENTRY_COMMAND)
    if (borrowedId && !borrowed) throw new Error('This account’s selected runtime is no longer available.')
    job.controller.signal.throwIfAborted()
    if ((await this.service.cli.ensureInstalled()).state !== 'ready') throw new Error('Colab setup is not ready.')
    job.controller.signal.throwIfAborted()
    const credFile = await this.service.credentials.materializeRuntimeToken(job.connectionId)
    const { paths, env } = await this.service.isolation.prepareConnectionEnvironment(job.connectionId, credFile)
    const prepared: DriveSession = {
      sessionName: borrowed ? borrowed.sessionName : `${COLAB_DRIVE_PULL_SESSION_PREFIX}${randomUUID().slice(0, 12)}`,
      sessionsJsonPath: paths.sessionsJsonPath,
      env,
      accountEmail: account.email
    }
    job.controller.signal.throwIfAborted()
    if (borrowed) return prepared

    // No workspace binding, execution marker, sync, or GPU. If a cancellation arrives after
    // `new` was sent, let it settle before stopping the exact resulting assignment by name.
    job.allocation = prepared
    activeDrivePullSessions.add(prepared.sessionName)
    const started = await this.service.cli.runCommand({ ...prepared, args: ['new', '-s', prepared.sessionName], timeoutMs: 120_000 })
    await this.syncCredentials(job)
    if (started.exitCode !== 0) {
      if (/allocation refused \(precondition failed\)/i.test(started.stderr)) this.releaseReservation(job)
      throw new Error('Could not start a temporary Colab CPU. Check account capacity and try again.')
    }
    return prepared
  }

  async startPull(input: ColabDrivePullStart): Promise<DriveResult> {
    const workspaceRoot = normalizeWorkspaceKey(input.workspaceRoot)
    if (!workspaceRoot) return { ok: false, message: 'Select a project workspace first.' }
    if (this.shuttingDown || this.blockedAccounts.has(input.connectionId)) return ended()
    if (this.pulls.has(input.pullId) || [...this.pulls.values()].some((job) =>
      job.workspaceRoot === workspaceRoot && !job.controller.signal.aborted)) {
      return { ok: false, message: 'Finish the current notebook pull before starting another.' }
    }
    const controller = new AbortController()
    const job: DrivePull = {
      id: input.pullId, workspaceRoot, connectionId: input.connectionId, controller, files: new Map(),
      ready: Promise.resolve().then(() => this.prepare(job, input))
    }
    this.pulls.set(job.id, job)
    if ('temporaryCpu' in input.runtime) {
      job.expiry = setTimeout(() => {
        job.expired = true
        void this.closePull(job.id)
      }, TEMPORARY_RUNTIME_LIMIT_MS)
    }
    try {
      await job.ready
      return await this.listNotebooks({ pullId: job.id })
    } catch (error) {
      if (controller.signal.aborted) return ended(job.expired)
      const closed = await this.closePull(job.id)
      const message = error instanceof Error ? error.message : 'Could not prepare Google Drive.'
      // Keep the pull retryable and tell the user when a provisioned CPU is still unconfirmed.
      return { ok: false, message: closed.ok ? message : `${message} ${STOP_UNCONFIRMED}` }
    }
  }

  async listNotebooks({ pullId }: { pullId: string }): Promise<DriveResult> {
    const job = this.pulls.get(pullId)
    if (!job || job.controller.signal.aborted) return ended(job?.expired)
    if (job.scan || job.importing) return { ok: false, message: 'This source is already busy.' }
    try {
      const session = await job.ready
      if (job.controller.signal.aborted) return ended(job.expired)
      if (job.scan || job.importing) return { ok: false, message: 'This source is already busy.' }
      job.files.clear()
      delete job.cachedResult
      return await this.scanDrive(job, session)
    } catch {
      return { ok: false, message: 'Could not read Google Drive notebooks.' }
    }
  }

  private scanDrive(job: DrivePull, session: DriveSession): Promise<DriveResult> {
    const script = buildDriveMountAndListPython(
      session.sessionsJsonPath,
      session.sessionName,
      session.accountEmail
    )
    const child = this.spawnProcess(this.service.cli.venvPythonPath, ['-c', script], {
      env: session.env, stdio: ['pipe', 'pipe', 'pipe']
    })
    const signal = job.controller.signal
    const decoder = new StringDecoder('utf8')
    let remainder = ''
    let hasExplicitError = false
    let final: DriveResult = { ok: false, message: 'Could not read Google Drive notebooks.' }
    let resolveInitial!: (result: DriveResult) => void
    let resolveFinished!: () => void
    const initial = new Promise<DriveResult>((resolve) => { resolveInitial = resolve })
    const scan: PendingScan = { child, settle: resolveInitial, finished: new Promise<void>((resolve) => { resolveFinished = resolve }) }
    job.scan = scan
    let authExpiry = 0
    let timer: ReturnType<typeof setTimeout>
    let finished = false
    const abort = (): void => terminateDriveHelper(child)
    const resetTimer = (ms: number, expired = false): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (expired) {
          job.expired = true
          void this.closePull(job.id)
        } else {
          if (!hasExplicitError) {
            final = { ok: false, message: 'Reading Drive timed out. Try again.' }
          }
          abort()
        }
      }, ms)
    }
    resetTimer(90_000)
    signal.addEventListener('abort', abort, { once: true })
    child.stdin?.on('error', () => { /* A closed subprocess is handled by its close event. */ })
    child.stderr?.resume()
    const acceptLine = (line: string): void => {
      const marker = parseDriveMarkerLines(line)
      if (signal.aborted || !marker) return
      if (marker.kind === 'auth') {
        const url = checkedDriveAuthUrl(marker.uri)
        if (!url) {
          hasExplicitError = true
          final = { ok: false, message: 'Google returned an unusable Drive authorization link.' }
          abort()
          return
        }
        const first = authExpiry === 0
        if (first) authExpiry = Date.now() + DRIVE_AUTH_WAIT_TIMEOUT_MS
        resetTimer(Math.max(0, authExpiry - Date.now()), true)
        scan.authorization = { url, expiresAt: authExpiry }
        scan.settle({
          ok: true,
          status: 'needs_auth',
          authUrl: url,
          expiresAt: authExpiry,
          ...(marker.reason ? { reason: marker.reason } : {})
        })
        if (first) void this.openAuth({ pullId: job.id })
      } else if (marker.kind === 'auth_ok') {
        delete scan.authorization
        scan.authAccepted = true
        resetTimer(90_000, false)
      } else if (marker.kind === 'list') {
        const entries = marker.entries.filter((item) => item && typeof item.name === 'string' &&
          typeof item.relativePath === 'string' && typeof item.remotePath === 'string' &&
          typeof item.modifiedAtMs === 'number' && typeof item.sizeBytes === 'number' &&
          /^\/content\/drive\/(MyDrive|My Drive)\/.+\.ipynb$/i.test(item.remotePath) &&
          !item.remotePath.split('/').some((part) => part === '.' || part === '..')).slice(0, NOTEBOOK_PULL_MAX_FILES)
        for (const entry of entries) job.files.set(entry.remotePath, entry)
        final = { ok: true, status: 'ready', entries: [...job.files.values()] }
        job.cachedResult = final
      } else if (marker.kind === 'error') {
        hasExplicitError = true
        final = {
          ok: false,
          ...(marker.code ? { code: marker.code } : {}),
          message:
            marker.code === 'account_mismatch'
              ? marker.message
              : marker.message.includes('authorization not completed')
                ? 'Google has not authorized Drive access. Try again with the selected Google account.'
                : 'Could not mount or read Google Drive. Retry or choose another source.'
        }
        job.cachedResult = final
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = (remainder + decoder.write(chunk)).split(/\r?\n/)
      remainder = (lines.pop() ?? '').slice(0, 2 * 1024 * 1024)
      lines.forEach(acceptLine)
    })
    const finish = (): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      const last = remainder + decoder.end()
      if (last) acceptLine(last)
      delete job.scan
      void this.syncCredentials(job).finally(() => {
        scan.settle(signal.aborted ? ended(job.expired) : final)
        resolveFinished()
      })
    }
    child.once('close', finish)
    child.once('error', finish)
    return initial
  }

  async completeAuth({ pullId }: { pullId: string }): Promise<DriveResult> {
    const job = this.pulls.get(pullId)
    if (!job || job.controller.signal.aborted) return ended(job?.expired ?? true)
    const scan = job.scan
    if (!scan) {
      if (job.cachedResult) {
        const cached = job.cachedResult
        delete job.cachedResult
        return cached
      }
      return ended(true)
    }
    if (scan.authAccepted && !scan.authorization) {
      await scan.finished
      if (job.controller.signal.aborted) return ended(job.expired)
      const cached = job.cachedResult
      delete job.cachedResult
      return cached ?? { ok: false, message: 'Could not read Google Drive notebooks.' }
    }
    if (!scan.authorization) return ended(true)
    if (Date.now() >= scan.authorization.expiresAt) {
      job.expired = true
      await this.closePull(pullId)
      return ended(true)
    }
    if (!scan.child.stdin?.writable) return { ok: false, message: 'The authorization window is no longer active.' }
    delete scan.authorization
    return new Promise((resolve) => {
      scan.settle = resolve
      scan.child.stdin!.write('CONTINUE\n')
    })
  }

  async openAuth({ pullId }: { pullId: string }): Promise<{ ok: boolean }> {
    const job = this.pulls.get(pullId)
    const auth = job?.scan?.authorization
    if (!auth || job?.controller.signal.aborted || Date.now() >= auth.expiresAt) return { ok: false }
    return this.openExternal(auth.url).then(() => ({ ok: true })).catch(() => ({ ok: false }))
  }

  async importDriveNotebook({ pullId, remotePath }: { pullId: string; remotePath: string }): Promise<NotebookPullImportResult> {
    const job = this.pulls.get(pullId)
    const entry = job?.files.get(remotePath)
    if (!job || job.controller.signal.aborted || !job.targetRoot) return ended(job?.expired)
    if (job.scan || job.importing) return { ok: false, message: 'This source is already busy.' }
    if (!entry) return { ok: false, message: 'Choose a notebook from the current Drive file list.' }
    if (entry.sizeBytes > NOTEBOOK_IMPORT_MAX_BYTES) return { ok: false, message: 'Notebook exceeds the 16 MB limit.' }
    const work = this.readAndSave(job, entry, job.targetRoot)
    job.importing = work
    try {
      return await work
    } finally {
      delete job.importing
    }
  }

  private async readAndSave(job: DrivePull, entry: ColabDriveNotebookEntry, root: string): Promise<NotebookPullImportResult> {
    try {
      const prepared = await job.ready
      const signal = job.controller.signal
      if (signal.aborted) return ended(job.expired)
      const parsed = await this.readDriveFile(prepared, entry.remotePath, signal)
      await this.syncCredentials(job)
      if (signal.aborted) return ended(job.expired)
      if (parsed?.kind !== 'file') {
        return { ok: false, message: parsed?.kind === 'error' && parsed.message.includes('16 MB')
          ? 'Notebook exceeds the 16 MB limit.' : 'Could not read this Drive notebook. It may have moved or the connection may have ended.' }
      }
      const file = await writeNonCollidingNotebook(root, entry.name, parsed.content, 'Colab')
      return { ok: true, file: { ...file, remotePath: entry.remotePath } }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not save the notebook.' }
    }
  }

  private readDriveFile(session: DriveSession, remotePath: string, signal: AbortSignal): Promise<ReturnType<typeof parseDriveMarkerLines>> {
    // The Drive mount is on the VM, but the auxiliary kernel must not attach to the editor's kernel.
    const child = this.spawnProcess(this.service.cli.venvPythonPath, ['-c', buildDriveReadHelperPython(session, remotePath)], {
      env: session.env, stdio: ['ignore', 'pipe', 'pipe']
    })
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      const limit = Math.ceil(NOTEBOOK_IMPORT_MAX_BYTES / 3) * 4 + 16_384
      let bytes = 0
      const abort = (): void => terminateDriveHelper(child)
      const timer = setTimeout(abort, 75_000)
      signal.addEventListener('abort', abort, { once: true })
      child.stderr?.resume()
      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > limit) abort()
        else chunks.push(chunk)
      })
      const finish = (code: number | null): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve(code === 0 && !signal.aborted && bytes <= limit ? parseDriveMarkerLines(Buffer.concat(chunks).toString('utf8')) : null)
      }
      child.once('error', () => finish(null))
      child.once('close', finish)
    })
  }

  closePull(pullId: string): Promise<ColabDrivePullCloseResult> {
    const job = this.pulls.get(pullId)
    if (!job) return Promise.resolve(this.recentClosures.get(pullId) ?? { ok: true, stoppedTemporary: false })
    if (job.close) return job.close
    clearTimeout(job.expiry)
    job.controller.abort()
    job.close = this.release(job).then((result) => {
      delete job.close
      if (result.ok) {
        this.pulls.delete(job.id)
        if (this.recentClosures.size >= 32) this.recentClosures.delete(this.recentClosures.keys().next().value!)
        this.recentClosures.set(job.id, result)
      }
      return result
    })
    return job.close
  }

  private async release(job: DrivePull): Promise<ColabDrivePullCloseResult> {
    // A pre-provision cancellation is fenced synchronously and has no remote resources.
    if (!job.allocation) {
      await Promise.allSettled([job.scan?.finished, job.importing])
      return { ok: true, stoppedTemporary: false }
    }
    await Promise.allSettled([job.ready, job.scan?.finished, job.importing])
    const allocation = job.allocation
    if (!allocation) return { ok: true, stoppedTemporary: false }
    try {
      const result = await this.service.cli.runCommand({
        ...allocation, args: ['stop', '-s', allocation.sessionName], timeoutMs: 15_000
      })
      await this.syncCredentials(job)
      if (result.exitCode === 0 && /Session terminated\./i.test(result.stdout)) {
        this.releaseReservation(job)
        return { ok: true, stoppedTemporary: true }
      }
    } catch {
      // Keep the exact assignment for a future cleanup attempt.
    }
    return { ok: false, message: STOP_UNCONFIRMED }
  }

  private releaseReservation(job: DrivePull): void {
    if (job.allocation) activeDrivePullSessions.delete(job.allocation.sessionName)
    delete job.allocation
  }

  private async syncCredentials(job: DrivePull): Promise<void> {
    await this.service.credentials.syncRuntimeTokenBack(job.connectionId).catch(() => undefined)
  }

  async releaseConnection<T extends { ok: boolean }>(connectionId: string, action: () => Promise<T>): Promise<T | { ok: false; message: string }> {
    if (this.blockedAccounts.has(connectionId)) return { ok: false, message: 'This account is already being disconnected.' }
    this.blockedAccounts.add(connectionId)
    try {
      const jobs = [...this.pulls.values()].filter((job) => job.connectionId === connectionId)
      const closed = await Promise.all(jobs.map((job) => this.closePull(job.id)))
      if (closed.some((result) => !result.ok)) return { ok: false, message: STOP_UNCONFIRMED }
      return await action()
    } finally {
      this.blockedAccounts.delete(connectionId)
    }
  }

  async importLocalNotebooks(input: {
    workspaceRoot: string
    localPaths: string[]
  }): Promise<ColabNotebookImportResult> {
    if (input.localPaths.length === 0) return { ok: false, canceled: true }
    const wsReal = await resolveNotebookImportRoot(input.workspaceRoot).catch(() => null)
    if (!wsReal) return { ok: false, message: 'The target project is not available.' }
    const imported: string[] = []
    for (const rawPath of input.localPaths) {
      if (extname(rawPath).toLowerCase() !== '.ipynb') continue
      const info = await stat(rawPath).catch(() => null)
      if (!info?.isFile() || info.size > NOTEBOOK_IMPORT_MAX_BYTES) continue
      const fileReal = await realpath(rawPath).catch(() => null)
      if (!fileReal) continue
      const bytes = await readFile(fileReal).catch(() => null)
      if (!bytes || !isValidIpynbBytes(bytes)) continue
      const relInside = relative(wsReal, fileReal)
      if (relInside && !relInside.startsWith('..') && !isAbsolute(relInside)) {
        imported.push(relInside.split(sep).join('/'))
        continue
      }
      try {
        imported.push((await writeNonCollidingNotebook(wsReal, basename(fileReal), bytes)).relativePath)
      } catch (error) {
        if (!imported.length) return { ok: false, message: error instanceof Error ? error.message : 'Could not save the notebook.' }
      }
    }
    if (imported.length === 0) return { ok: false, message: 'No valid .ipynb notebook selected.' }
    return { ok: true, relativePaths: imported }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const results = await Promise.all([...this.pulls.keys()].map((pullId) => this.closePull(pullId)))
    if (results.some((result) => !result.ok)) throw new Error(STOP_UNCONFIRMED)
  }
}
