/**
 * The single source of truth for a turn's workspace root set.
 *
 * Native launches, the SDK tool bridge, the composer capability manifest and
 * the delegated-session resume identity all read this resolution instead of
 * trusting the thread's raw path strings. Roots are canonical (realpath), so a
 * symlink whose target changes produces a different identity instead of
 * resuming a session that was granted the old target.
 */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { HarnessTransport } from '../contracts/harness.js'

export type WorkspaceRootSet = {
  /** Canonical primary root (the process cwd). */
  primary: string
  /** Primary first, then the sorted canonical additional roots. */
  roots: readonly string[]
  /** Canonical additional roots, excluding the primary and redundant children. */
  extras: readonly string[]
  /**
   * Stable identity of the authoritative set. Sorted extras make reordering
   * the declared directories a no-op; changing, adding, removing or
   * re-pointing a root changes it.
   */
  identity: string
}

export class WorkspaceRootSetError extends Error {
  constructor(
    readonly code:
      | 'workspace_root_missing'
      | 'workspace_root_invalid'
      | 'additional_roots_unsupported',
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceRootSetError'
  }
}

/**
 * Transports whose native process can be handed more than the cwd: the Claude
 * Agent SDK (`additionalDirectories`) and Codex app-server (`writableRoots`).
 * Everything else keeps its single-directory behavior and is rejected at the
 * host boundary when extra roots are selected.
 */
export const ADDITIONAL_ROOTS_TRANSPORTS: ReadonlySet<HarnessTransport> = new Set([
  'native-loop',
  'agent-sdk',
  'codex-app-server'
])

export function transportSupportsAdditionalRoots(
  transport: string | undefined
): boolean {
  return transport !== undefined &&
    ADDITIONAL_ROOTS_TRANSPORTS.has(transport as HarnessTransport)
}

/** Host-derived capability row field; never read from a custom manifest. */
export function harnessWorkspaceSupport(
  transport: string | undefined
): { additionalRoots: boolean } {
  return { additionalRoots: transportSupportsAdditionalRoots(transport) }
}

export function assertAdditionalRootsSupported(
  transport: string | undefined,
  extras: readonly string[]
): void {
  if (extras.length === 0 || transportSupportsAdditionalRoots(transport)) return
  throw new WorkspaceRootSetError(
    'additional_roots_unsupported',
    `transport ${transport ?? 'unknown'} cannot host additional workspace roots`
  )
}

/**
 * A host-managed single-checkout worktree has no multi-repository isolation, so
 * extra roots would escape the boundary worker dispatch established.
 */
export type WorkspaceIsolationLookup = {
  get?(workspaceId: string): { isolation: 'worktree' | 'local' | 'directory' } | undefined
}

export function assertIsolatedWorkspaceRoots(
  boundWorkspaceId: string | undefined,
  extras: readonly string[],
  workspaces?: WorkspaceIsolationLookup
): void {
  if (!boundWorkspaceId || extras.length === 0) return
  const isolation = workspaces?.get?.(boundWorkspaceId)?.isolation
  if (isolation === 'local' || isolation === 'directory') return
  throw new WorkspaceRootSetError(
    'additional_roots_unsupported',
    isolation === 'worktree'
      ? 'An isolated task workspace can only use its own checkout; remove the extra folders to continue.'
      : 'The task workspace isolation could not be verified; remove the extra folders to continue.'
  )
}

/**
 * Canonicalize and validate the turn's directory set. Every declared root must
 * exist and be a directory: a grant that cannot be verified must fail closed
 * rather than silently launching with a narrower (or wider) scope.
 */
export async function resolveWorkspaceRoots(input: {
  workspace: string
  additionalWorkspaces?: readonly string[]
  /** Base for relative declarations; defaults to the process cwd. */
  baseDir?: string
}): Promise<WorkspaceRootSet> {
  const primaryDeclared = input.workspace.trim()
  if (!primaryDeclared) {
    // Never promote an additional directory to primary: that would silently
    // shrink the declared scope to the first root.
    throw new WorkspaceRootSetError('workspace_root_invalid', 'no primary workspace root is selected')
  }
  const declared = [primaryDeclared, ...(input.additionalWorkspaces ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
  if (declared.length === 0) {
    throw new WorkspaceRootSetError('workspace_root_invalid', 'no workspace root is selected')
  }
  const baseDir = input.baseDir ?? process.cwd()
  const canonical: string[] = []
  for (const [index, declaredPath] of declared.entries()) {
    const absolute = isAbsolute(declaredPath) ? resolve(declaredPath) : resolve(baseDir, declaredPath)
    let real: string
    try {
      real = await realpath(absolute)
    } catch {
      if (index === 0 && declared.length === 1) {
        // The primary is the process cwd; the transport reports its own
        // missing-cwd error. Canonicalization stays best-effort there so a
        // not-yet-mounted checkout does not fail every single-root turn.
        canonical.push(absolute)
        continue
      }
      throw new WorkspaceRootSetError(
        'workspace_root_missing',
        `workspace root is unavailable: ${declaredPath}`
      )
    }
    const stats = await stat(real)
    if (!stats.isDirectory()) {
      throw new WorkspaceRootSetError(
        'workspace_root_invalid',
        `workspace root is not a directory: ${declaredPath}`
      )
    }
    canonical.push(real)
  }

  const primary = canonical[0]
  const unique = [...new Set(canonical.slice(1))].filter((root) => root !== primary)
  // Shortest first so a parent root wins over a child of itself; keeps the
  // surviving set independent of declaration order.
  unique.sort((left, right) => left.length - right.length || left.localeCompare(right))
  const extras: string[] = []
  for (const root of unique) {
    if (isWithin(primary, root)) continue
    if (extras.some((kept) => isWithin(kept, root))) continue
    extras.push(root)
  }
  extras.sort((left, right) => left.localeCompare(right))
  return {
    primary,
    roots: [primary, ...extras],
    extras,
    identity: JSON.stringify([primary, ...extras])
  }
}

/** True when `candidate` is `root` or lives inside it (lexical, canonical inputs). */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
