import type { MemoryCreateRequest, MemoryRecord } from '../contracts/memory.js'
import { canonicalProjectIdentity } from '../shared/project-identity.js'

export type MemoryProjectAccess = {
  workspace?: string
  project?: string
  projectIdentity?: string
}

/** Resolve once at the asynchronous store boundary, before either FTS or fallback filtering. */
export async function resolveMemoryProjectAccess<T extends MemoryProjectAccess>(access: T): Promise<T> {
  const path = access.project ?? access.workspace
  // Never trust a caller-supplied identity independently of the actual access path.
  const projectIdentity = path ? await resolveMemoryProjectIdentity(path) : undefined
  return { ...access, projectIdentity }
}

export async function resolveMemoryProjectIdentity(path: string): Promise<string | undefined> {
  try {
    const identity = await canonicalProjectIdentity(path)
    return process.platform === 'win32' ? identity.key.toLowerCase() : identity.key
  } catch {
    // Missing/unreadable paths retain the old exact-path scope, never a guessed repository.
    return undefined
  }
}

/** Only a fresh, explicitly user-approved project memory opts into repository-wide visibility. */
export async function projectIdentityForNewMemory(
  input: MemoryCreateRequest,
  older?: MemoryRecord
): Promise<string | undefined> {
  if (older) return older.projectIdentity
  if (input.scope !== 'project' || input.agentContext ||
    (input.provenance && input.provenance.kind !== 'user')) return undefined
  // Re-importing legacy evidence is not fresh approval to widen its old exact-path scope.
  if (input.sources?.some((source) => source.kind === 'imported' || source.kind === 'legacy' ||
    source.trust === 'imported' || source.trust === 'legacy')) return undefined
  const path = input.project ?? input.workspace
  return path ? resolveMemoryProjectIdentity(path) : undefined
}
