import { homedir } from 'node:os'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import { resolveExecutable, spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'

type ResolverDeps = {
  platform?: NodeJS.Platform
  home?: string
  resolve?: typeof resolveExecutable
  version?: (command: string) => Promise<string | undefined>
  nativeBinary?: (command: string) => Promise<boolean>
}

async function isNativeBinary(command: string): Promise<boolean> {
  const file = await open(command, 'r')
  try {
    const magic = Buffer.alloc(4)
    await file.read(magic, 0, 4, 0)
    return ['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca'].includes(magic.toString('hex'))
  } finally { await file.close() }
}

export function codexMetadataProbeArgs(args: readonly string[] = ['app-server']): string[] {
  return ['-c', 'features.plugins=false', '-s', 'read-only', '-a', 'never', ...args]
}

async function versionOf(command: string): Promise<string | undefined> {
  const child = await spawnOwnedProcess(command, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  let output = ''
  child.stdout?.on('data', (data) => { if (output.length < 1024) output += String(data) })
  try {
    const ok = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 3_000)
      child.once('exit', (code) => { clearTimeout(timer); done(code === 0) })
      child.once('error', () => { clearTimeout(timer); done(false) })
    })
    return ok ? output.match(/^codex-cli\s+(\d+\.\d+\.\d+)/)?.[1] : undefined
  } finally { await stopOwnedProcess(child).catch(() => undefined) }
}

/** Explicit paths and custom launchers retain priority. Auto discovery may use a newer installed official app CLI. */
export async function discoverCodexExecutable(deps: ResolverDeps = {}): Promise<string | undefined> {
  const resolve = deps.resolve ?? resolveExecutable
  const first = await resolve('codex')
  if ((deps.platform ?? process.platform) !== 'darwin') return first
  if (first && !await (deps.nativeBinary ?? isNativeBinary)(first).catch(() => false)) return first
  const version = deps.version ?? versionOf
  const firstVersion = first ? await version(first).catch(() => undefined) : undefined
  // A wrapper with a custom version response can implement its own account boundary.
  if (first && !firstVersion) return first
  let selected = first, selectedVersion = firstVersion
  for (const applications of ['/Applications', join(deps.home ?? homedir(), 'Applications')]) {
    for (const suffix of ['ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
      'Codex.app/Contents/Resources/codex']) {
      const candidate = await resolve(join(applications, suffix))
      if (!candidate || candidate === first) continue
      const candidateVersion = await version(candidate).catch(() => undefined)
      if (candidateVersion && (!selectedVersion || semver.gt(candidateVersion, selectedVersion))) {
        selected = candidate
        selectedVersion = candidateVersion
      }
    }
  }
  return selected
}

let cached: { key: string; until: number; result: Promise<string | undefined> } | undefined
export async function resolveCodexExecutable(command = 'codex', explicit = false): Promise<string> {
  if (explicit || command !== 'codex') return command
  const key = `${process.platform}:${process.env.PATH ?? ''}:${homedir()}`
  if (!cached || cached.key !== key || cached.until < Date.now()) {
    cached = { key, until: Date.now() + 60_000, result: discoverCodexExecutable() }
  }
  return await cached.result ?? command
}
