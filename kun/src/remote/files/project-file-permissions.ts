import { homedir } from 'node:os'
import { realpath } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { inside } from './project-content.js'

// These are credential/configuration authorities, not source-code exclusions.
const PRIVATE = new Set([
  '.git', '.codex', '.claude', '.gemini', '.ssh', '.aws', '.azure', '.gnupg',
  '.npmrc', '.netrc', '.pypirc', '.git-credentials', '.docker', '.kube',
  'credentials.json', 'service-account.json'
])

/** The same protected-path boundary applies to project browsing and artifact dependencies. */
export async function permittedProjectFile(runtime: ServerRuntime, root: string, path: string) {
  const canonical = await realpath(path)
  if (!inside(root, canonical)) return false
  if (PRIVATE.has(basename(root).toLowerCase())) return false
  const parts = relative(root, canonical).split(/[\\/]/)
  if (parts.some((part, i) => part.toLowerCase() === '.kun' &&
    ['control', 'credentials'].includes(parts[i + 1]?.toLowerCase()))) return false
  if (parts.some(part => PRIVATE.has(part.toLowerCase()) ||
    part.toLowerCase() === '.env' || part.toLowerCase().startsWith('.env.'))) return false
  const protectedPaths = [
    runtime.rooms!.deps.dataDir,
    ...(runtime.remoteProtectedPaths ?? []),
    ...['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.claude', '.gemini']
      .map(name => join(homedir(), name)),
    join(homedir(), '.kun', 'control'),
    join(homedir(), '.codex', 'auth.json'),
    join(homedir(), '.codex', 'config.toml')
  ]
  for (const protectedPath of protectedPaths) {
    const candidate = await realpath(protectedPath).catch(() => resolve(protectedPath))
    if (inside(candidate, canonical)) return false
  }
  return true
}
