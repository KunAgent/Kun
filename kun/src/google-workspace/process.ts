import { mkdtemp, writeFile, rm, lstat, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { resolveGoogleWorkspaceBinary, type GoogleWorkspaceBinary } from './binary.js'

export type GoogleWorkspaceErrorCode = 'missing_binary' | 'version_mismatch' | 'cancelled' |
  'timeout' | 'output_limit' | 'authentication' | 'validation' | 'permission' | 'not_found' | 'api' | 'process'
const messages: Record<GoogleWorkspaceErrorCode, string> = {
  missing_binary: 'The pinned Google Workspace binary is missing or failed integrity checks. Reinstall Kun or prepare the pinned development bundle.',
  version_mismatch: 'The Google Workspace binary version does not match this integration.',
  cancelled: 'Google Workspace operation cancelled. A submitted write may already have completed; inspect its state before retrying.',
  timeout: 'Google Workspace timed out. A submitted write may already have completed; inspect its state before retrying.',
  output_limit: 'Google Workspace output exceeded the safe limit. Narrow the query or choose a smaller file.',
  authentication: 'Google authentication failed. Check the integration setup and reconnect.',
  validation: 'Google Workspace rejected the validated request.',
  permission: 'Google denied access. Check the granted scopes and API availability.',
  not_found: 'The requested Google resource was not found.',
  api: 'The Google API request failed. No automatic retry was performed.',
  process: 'Google Workspace could not complete the operation.'
}
export class GoogleWorkspaceError extends Error {
  unknownOutcome?: true
  constructor(readonly code: GoogleWorkspaceErrorCode) { super(messages[code]); this.name = 'GoogleWorkspaceError' }
}
export type GoogleWorkspaceProcessResult = { stdout: Buffer; stderr: Buffer; exitCode: number }
export type GoogleWorkspaceRunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  media?: boolean
  onOutput?: (chunk: string) => void
}
export type GoogleWorkspaceRunner = (args: readonly string[], options?: GoogleWorkspaceRunOptions) => Promise<GoogleWorkspaceProcessResult>

/** Deliberate allowlist: credentials, proxies, loader hooks, logging and gws overrides never inherit. */
export function googleWorkspaceEnvironment(cwd: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: homedir(), USERPROFILE: homedir(), PATH: cwd, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }
  for (const key of ['SystemRoot', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USER', 'USERNAME', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']) {
    if (source[key]) env[key] = source[key]
  }
  // Fail closed before gws can fall back to another application's ADC identity.
  env.GOOGLE_APPLICATION_CREDENTIALS = join(cwd, 'adc-disabled')
  env.TMPDIR = cwd
  env.TEMP = cwd
  env.TMP = cwd
  return env
}
export function createGoogleWorkspaceRunner(deps: {
  resolveBinary?: () => Promise<GoogleWorkspaceBinary>
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => Promise<ChildProcess>
  stop?: (child: ChildProcess) => Promise<void>
} = {}): GoogleWorkspaceRunner {
  return async (args, options = {}) => {
    if (options.signal?.aborted) throw new GoogleWorkspaceError('cancelled')
    let binary: GoogleWorkspaceBinary
    try { binary = await (deps.resolveBinary ?? resolveGoogleWorkspaceBinary)() }
    catch { throw new GoogleWorkspaceError('missing_binary') }
    const cwd = await mkdtemp(join(tmpdir(), 'kun-google-workspace-'))
    try {
      // dotenvy otherwise searches ancestor directories, reintroducing stripped overrides.
      await writeFile(join(cwd, '.env'), '', { flag: 'wx', mode: 0o600 })
      const output = join(cwd, 'download')
      const result = await execute(binary.path, options.media ? [...args, '--output', output] : args, cwd, options, deps)
      if (!options.media) return result
      const info = await lstat(output).catch(() => { throw new GoogleWorkspaceError('process') })
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > (options.maxOutputBytes ?? 2 * 1024 * 1024)) {
        throw new GoogleWorkspaceError('output_limit')
      }
      return { ...result, stdout: await readFile(output), stderr: Buffer.alloc(0) }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
}
async function execute(
  binary: string, args: readonly string[], cwd: string, options: GoogleWorkspaceRunOptions,
  deps: Parameters<typeof createGoogleWorkspaceRunner>[0]
): Promise<GoogleWorkspaceProcessResult> {
  const spawn = deps?.spawn ?? spawnOwnedProcess
  const stop = deps?.stop ?? ((child: ChildProcess) => stopOwnedProcess(child, { graceMs: 200, timeoutMs: 3000 }))
  let child: ChildProcess
  try {
    child = await spawn(binary, [...args], { cwd, env: googleWorkspaceEnvironment(cwd), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { throw new GoogleWorkspaceError('process') }
  return await new Promise((accept, reject) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let failure: GoogleWorkspaceError | undefined
    let settled = false
    let stopPromise: Promise<void> | undefined
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (mediaTimer) clearInterval(mediaTimer)
      options.signal?.removeEventListener('abort', cancel)
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code ?? -1 }
      void (stopPromise ?? Promise.resolve()).then(() => {
        if (failure) reject(failure)
        else if (code !== 0) reject(new GoogleWorkspaceError(exitCodeCategory(code)))
        else accept(result)
      }, () => reject(failure ?? new GoogleWorkspaceError('process')))
    }
    const fail = (code: GoogleWorkspaceErrorCode): void => {
      if (failure || settled) return
      failure = new GoogleWorkspaceError(code)
      stopPromise = stop(child)
      // An injected or failed child can omit close. The owned stop still fences its tree.
      void stopPromise.then(() => finish(null), () => finish(null))
    }
    const consume = (target: Buffer[], chunk: Buffer): void => {
      if (failure || settled) return
      bytes += chunk.length
      if (bytes > (options.maxOutputBytes ?? 2 * 1024 * 1024)) { fail('output_limit'); return }
      target.push(chunk)
      try { options.onOutput?.(chunk.toString('utf8')) } catch { fail('process') }
    }
    const cancel = (): void => fail('cancelled')
    const timer = setTimeout(() => fail('timeout'), options.timeoutMs ?? 30_000)
    const mediaTimer = options.media ? setInterval(() => {
      void lstat(join(cwd, 'download')).then(info => {
        if (info.size > (options.maxOutputBytes ?? 2 * 1024 * 1024)) fail('output_limit')
      }, () => undefined)
    }, 25) : undefined
    child.stdout?.on('data', (chunk: Buffer) => consume(stdout, chunk))
    child.stderr?.on('data', (chunk: Buffer) => consume(stderr, chunk))
    child.once('error', () => fail('process'))
    child.once('close', finish)
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
  })
}
function exitCodeCategory(code: number | null): GoogleWorkspaceErrorCode {
  // Pinned upstream error.rs: API=1, Auth=2, Validation=3, Discovery=4, Internal=5.
  if (code === 2) return 'authentication'
  if (code === 3) return 'validation'
  if (code === 1 || code === 4) return 'api'
  return 'process'
}
