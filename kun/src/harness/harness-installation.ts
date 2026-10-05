import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { readFile, realpath } from 'node:fs/promises'
import semver from 'semver'
import type { HarnessInstallation } from '../contracts/harness-update.js'
import type { HarnessStatus } from '../contracts/harness.js'
import { harnessExecutableIdentity } from './harness-executable-identity.js'
import { HARNESS_UPDATE_RECIPES } from './harness-update-recipes.js'
import { resolveExecutable } from '../process/owned-process.js'
import { harnessExecutableEnv } from './harness-executable-env.js'
import { spawnCaptured } from './harness-detector.js'

export type InstallationDetails = HarnessInstallation & { prefix?: string }
export async function describeHarnessInstallation(id: string, status: HarnessStatus,
  home = homedir()): Promise<InstallationDetails> {
  const path = status.resolvedCommand
  const base = { path, version: status.version, fingerprint: harnessExecutableIdentity(path) }
  if (id === 'cursor' && status.installed === 'yes') return { ...base, source: 'kun-bundled', owner: 'Kun' }
  if (!path) return { ...base, source: 'unavailable' }
  const target = await realpath(path).catch(() => path)
  const canonicalHome = await realpath(home).catch(() => resolve(home))
  const normalized = target.replace(/\\/g, '/')
  if (/\.app\/Contents\//.test(normalized)) {
    return { ...base, source: 'application', owner: normalized.match(/([^/]+)\.app\/Contents\//)?.[1] }
  }
  if (normalized.includes('/node_modules/@anthropic-ai/claude-agent-sdk') || normalized.includes('/agent-sdk/')) {
    return { ...base, source: 'kun-bundled', owner: 'Kun' }
  }
  const managedRoot = resolve(canonicalHome, '.kun', 'agents', id)
  if (target.startsWith(managedRoot + sep)) return { ...base, source: 'managed', owner: 'Kun' }
  const recipe = HARNESS_UPDATE_RECIPES[id]
  if (recipe?.cask && new RegExp(`/Caskroom/${recipe.cask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(normalized)) {
    return { ...base, source: 'homebrew', owner: 'Homebrew' }
  }
  if (id === 'claude-code' && target.startsWith(join(canonicalHome, '.local', 'share', 'claude', 'versions') + sep) &&
    resolve(path) === join(home, '.local', 'bin', 'claude')) return { ...base, source: 'native', owner: 'Claude Code' }
  // Match the actual package and npm prefix; never update whichever npm happens to own PATH.
  if (recipe?.packageName) {
    let folder = dirname(target)
    for (let depth = 0; depth < 8; depth++) {
      try {
        const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
        if (pkg.name === recipe.packageName) {
          const suffix = `${sep}lib${sep}node_modules${sep}${recipe.packageName.replaceAll('/', sep)}`
          if (folder.endsWith(suffix)) return { ...base, source: 'npm', owner: 'npm', prefix: folder.slice(0, -suffix.length) }
        }
      } catch { /* Not a package directory. */ }
      const parent = dirname(folder)
      if (parent === folder) break
      folder = parent
    }
  }
  return { ...base, source: 'custom' }
}

export async function localHarnessCandidate(id: string, current: HarnessInstallation): Promise<HarnessInstallation | undefined> {
  if (!['claude-code', 'codex'].includes(id)) return undefined
  const name = HARNESS_UPDATE_RECIPES[id]?.command
  if (!name) return undefined
  const paths = [await resolveExecutable(name, { env: harnessExecutableEnv() }), join(homedir(), '.local', 'bin', name)]
  let best: HarnessInstallation | undefined
  for (const path of new Set(paths.filter((value): value is string => Boolean(value)))) {
    if (harnessExecutableIdentity(path) === current.fingerprint) continue
    const result = await spawnCaptured(path, ['--version'], { timeoutMs: 3_000 })
    if (result.exitCode !== 0) continue
    const version = result.stdout.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0]
    if (!version || !semver.valid(version) || (current.version && semver.valid(current.version) && !semver.gt(version, current.version)) ||
      (best?.version && !semver.gt(version, best.version))) continue
    best = await describeHarnessInstallation(id, { harnessId: id, installed: 'yes', login: 'unknown', checkedAt: '', resolvedCommand: path, version })
  }
  return best
}
