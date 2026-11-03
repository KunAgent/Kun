/**
 * package.json scripts of the active workspace, for the new-session menu.
 * The package manager follows the lockfile that exists.
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type WorkspaceScripts = {
  manager: PackageManager
  scripts: Array<{ name: string; command: string }>
}

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun']
]
const CACHE_MS = 30_000
const MAX_SCRIPTS = 12
const cache = new Map<string, { at: number; value: Promise<WorkspaceScripts | null> }>()

export function parsePackageScripts(content: string): Array<{ name: string; command: string }> {
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> }
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return []
    return Object.entries(parsed.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[\w:.@/-]+$/.test(entry[0]))
      .filter(([name]) => !/^(pre|post)/.test(name))
      .slice(0, MAX_SCRIPTS)
      .map(([name, command]) => ({ name, command }))
  } catch {
    return []
  }
}

export function scriptCommandLine(manager: PackageManager, script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} run ${script}`
}

async function fileExists(workspaceRoot: string, path: string): Promise<boolean> {
  try {
    const result = await window.kunGui.resolveWorkspaceFile({ path, workspaceRoot })
    return result.ok
  } catch {
    return false
  }
}

async function load(workspaceRoot: string): Promise<WorkspaceScripts | null> {
  try {
    const result = await window.kunGui.readWorkspaceFile({ path: 'package.json', workspaceRoot, maxBytes: 256 * 1024 })
    if (!result.ok) return null
    const scripts = parsePackageScripts(result.content)
    if (!scripts.length) return null
    let manager: PackageManager = 'npm'
    for (const [lockfile, candidate] of LOCKFILES) {
      if (await fileExists(workspaceRoot, lockfile)) {
        manager = candidate
        break
      }
    }
    return { manager, scripts }
  } catch {
    return null
  }
}

export function readWorkspaceScripts(workspaceRoot: string): Promise<WorkspaceScripts | null> {
  if (!workspaceRoot.trim()) return Promise.resolve(null)
  const cached = cache.get(workspaceRoot)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const value = load(workspaceRoot)
  cache.set(workspaceRoot, { at: Date.now(), value })
  return value
}
