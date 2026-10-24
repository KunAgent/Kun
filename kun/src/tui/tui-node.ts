import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronHostForNativeModules } from '../process/host-node.js'

/**
 * The terminal renderer (opentui) drives a native Zig core through Node's
 * built-in FFI, which exists from Node 26.4 behind --experimental-ffi. The
 * Kun Runtime keeps running on the Electron/host Node it shipped with; only
 * the TUI process moves to a Node 26 interpreter.
 */
export const MINIMUM_TUI_RENDERER_NODE_VERSION = '26.4.0'
/** Version bundled with desktop builds and downloaded on demand. */
export const BUNDLED_TUI_NODE_VERSION = '26.12.0'
export const TUI_NODE_FLAGS = ['--experimental-ffi', '--disable-warning=ExperimentalWarning'] as const
export const TUI_HANDOFF_ENV = 'KUN_TUI_RENDERER_HANDOFF'

export type TuiNodeSource = 'env' | 'bundled' | 'cache' | 'system'
export type TuiNodeCandidate = { path: string; source: TuiNodeSource; version: string }

export function compareNodeVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/u, '').split(/[.-]/u).slice(0, 3).map((part) => Number(part) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!
  }
  return 0
}

/** True when this process can host the renderer without a handoff. */
export async function rendererAvailableInProcess(nodeVersion = process.versions.node): Promise<boolean> {
  if (process.versions.electron) return false
  if (compareNodeVersions(nodeVersion, MINIMUM_TUI_RENDERER_NODE_VERSION) < 0) return false
  try {
    // Non-literal specifier: node:ffi has no type declarations yet.
    const specifier = 'node:ffi'
    await import(specifier)
    return true
  } catch {
    return false
  }
}

export function nodePlatformTarget(platform = process.platform, arch = process.arch): { dir: string; binary: string; archive: string } | undefined {
  if (arch !== 'x64' && arch !== 'arm64') return undefined
  if (platform === 'darwin' || platform === 'linux') {
    const dir = `node-v${BUNDLED_TUI_NODE_VERSION}-${platform}-${arch}`
    return { dir, binary: join(dir, 'bin', 'node'), archive: `${dir}.tar.gz` }
  }
  if (platform === 'win32') {
    const dir = `node-v${BUNDLED_TUI_NODE_VERSION}-win-${arch}`
    return { dir, binary: join(dir, 'node.exe'), archive: `${dir}.zip` }
  }
  return undefined
}

function probeVersion(path: string): string | undefined {
  try {
    const result = spawnSync(path, ['-p', 'process.versions.node'], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
    const version = result.status === 0 ? result.stdout.trim() : ''
    return /^\d+\.\d+\.\d+/u.test(version) ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * Places a Node 26 interpreter may live, in priority order: the copy
 * bundled with the desktop app (`<resources>/tui-node`), the development
 * cache (`<repo>/.cache/tui-node`) and Kun's per-user download cache.
 */
export function tuiNodeSearchRoots(env: NodeJS.ProcessEnv = process.env): Array<{ path: string; source: TuiNodeSource }> {
  const kunRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const roots: Array<{ path: string; source: TuiNodeSource }> = []
  // Packaged: <resources>/app.asar.unpacked/kun/dist/tui -> <resources>/tui-node
  if (kunRoot.includes('app.asar.unpacked')) roots.push({ path: resolve(kunRoot, '..', '..', 'tui-node'), source: 'bundled' })
  roots.push({ path: resolve(kunRoot, '..', '.cache', 'tui-node'), source: 'cache' })
  roots.push({ path: userTuiNodeRoot(env), source: 'cache' })
  return roots
}

export function userTuiNodeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.KUN_HOME?.trim() || join(homedir(), '.kun'), 'runtime', 'tui-node')
}

export function findTuiNode(env: NodeJS.ProcessEnv = process.env): TuiNodeCandidate | undefined {
  const accept = (path: string, source: TuiNodeSource): TuiNodeCandidate | undefined => {
    if (!path || !existsSync(path)) return undefined
    const version = probeVersion(path)
    return version && compareNodeVersions(version, MINIMUM_TUI_RENDERER_NODE_VERSION) >= 0
      ? { path, source, version }
      : undefined
  }
  const explicit = env.KUN_TUI_NODE?.trim()
  if (explicit) return accept(explicit, 'env')
  const target = nodePlatformTarget()
  if (target) {
    for (const root of tuiNodeSearchRoots(env)) {
      // Bundled builds flatten the interpreter into the root; caches keep the
      // versioned directory name from the official archive.
      const flattened = process.platform === 'win32' ? join(root.path, 'node.exe') : join(root.path, 'bin', 'node')
      const found = accept(flattened, root.source) ?? accept(join(root.path, target.binary), root.source)
      if (found) return found
    }
  }
  const located = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], { encoding: 'utf8', windowsHide: true })
  const systemPath = located.status === 0 ? located.stdout.split(/\r?\n/u).find(Boolean)?.trim() : undefined
  if (!systemPath) return undefined
  let resolved = systemPath
  try { resolved = realpathSync(systemPath) } catch { /* keep the PATH entry */ }
  return resolved === process.execPath ? undefined : accept(resolved, 'system')
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Download the official Node.js build into Kun's runtime cache and verify it
 * against the release SHASUMS256.txt before it is ever executed.
 */
export async function downloadTuiNode(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  log: (message: string) => void = () => undefined
): Promise<TuiNodeCandidate> {
  const target = nodePlatformTarget()
  if (!target) throw new Error(`no official Node.js ${BUNDLED_TUI_NODE_VERSION} build exists for ${process.platform}-${process.arch}`)
  const root = userTuiNodeRoot(env)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const base = `https://nodejs.org/dist/v${BUNDLED_TUI_NODE_VERSION}`
  log(`Downloading Node.js ${BUNDLED_TUI_NODE_VERSION} (${target.archive})…`)
  const [archiveResponse, sumsResponse] = await Promise.all([
    fetchImpl(`${base}/${target.archive}`),
    fetchImpl(`${base}/SHASUMS256.txt`)
  ])
  if (!archiveResponse.ok) throw new Error(`Node.js download failed (${archiveResponse.status})`)
  if (!sumsResponse.ok) throw new Error(`Node.js checksum download failed (${sumsResponse.status})`)
  const expected = (await sumsResponse.text()).split('\n')
    .find((line) => line.trim().endsWith(`  ${target.archive}`))?.split(/\s+/u)[0]
  if (!expected) throw new Error(`no published checksum for ${target.archive}`)
  const staging = await mkdtemp(join(tmpdir(), 'kun-tui-node-'))
  try {
    const archivePath = join(staging, target.archive)
    await writeFile(archivePath, new Uint8Array(await archiveResponse.arrayBuffer()))
    if (await sha256(archivePath) !== expected) throw new Error('Node.js archive checksum mismatch; the download was discarded')
    const extract = process.platform === 'win32'
      ? spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archivePath, '-C', staging], { windowsHide: true })
      : spawnSync('tar', ['-xzf', archivePath, '-C', staging])
    if (extract.status !== 0) throw new Error('could not extract the Node.js archive')
    const destination = join(root, target.dir)
    await rm(destination, { recursive: true, force: true })
    await rename(join(staging, target.dir), destination)
    if (process.platform !== 'win32') await chmod(join(root, target.binary), 0o755)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  const path = join(root, target.binary)
  const version = probeVersion(path)
  if (!version) throw new Error('the downloaded Node.js interpreter did not start')
  return { path, source: 'cache', version }
}

/**
 * Environment for the Node 26 TUI child. Runtime and Service Manager
 * children must keep using the interpreter Kun was installed with, so the
 * current executable is passed down explicitly. A development checkout whose
 * native modules target Electron passes its Electron binary instead.
 */
export function tuiHandoffEnv(
  env: NodeJS.ProcessEnv,
  electronHost: () => string | null = electronHostForNativeModules
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, [TUI_HANDOFF_ENV]: '1' }
  delete next.ELECTRON_RUN_AS_NODE
  if (process.versions.electron) {
    if (!next.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim()) next.KUN_PACKAGED_RUNTIME_EXECUTABLE = process.execPath
  } else if (!next.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim() && !next.KUN_HOST_NODE_EXECUTABLE?.trim()) {
    const electron = electronHost()
    if (electron) next.KUN_PACKAGED_RUNTIME_EXECUTABLE = electron
    else next.KUN_HOST_NODE_EXECUTABLE = process.execPath
  }
  return next
}

/** Run `kun tui` in the Node 26 interpreter and mirror its exit status. */
export function handoffToTuiNode(node: TuiNodeCandidate, argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const entry = fileURLToPath(new URL('../cli/serve-entry.js', import.meta.url))
  return new Promise((resolvePromise, reject) => {
    const child = spawn(node.path, [...TUI_NODE_FLAGS, entry, 'tui', ...argv], {
      stdio: 'inherit',
      env: tuiHandoffEnv(env),
      windowsHide: false
    })
    const forward = (signal: NodeJS.Signals) => () => { child.kill(signal) }
    const handlers = (['SIGTERM', 'SIGHUP'] as const).map((signal) => [signal, forward(signal)] as const)
    // The child owns the terminal; Ctrl+C reaches it as a key, so the parent
    // only ignores stray SIGINTs instead of exiting underneath it.
    const ignoreInterrupt = (): void => undefined
    process.on('SIGINT', ignoreInterrupt)
    for (const [signal, handler] of handlers) process.on(signal, handler)
    const cleanup = (): void => {
      process.off('SIGINT', ignoreInterrupt)
      for (const [signal, handler] of handlers) process.off(signal, handler)
    }
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('exit', (code, signal) => {
      cleanup()
      resolvePromise(code ?? (signal ? 128 + (signalNumber(signal) ?? 1) : 1))
    })
  })
}

function signalNumber(signal: NodeJS.Signals): number | undefined {
  return ({ SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 } as Partial<Record<NodeJS.Signals, number>>)[signal]
}
