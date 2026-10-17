import { stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { RG_EXECUTABLE_CANDIDATES, type SourceCommandCapture } from './builtin-tool-types.js'
import {
  normalizeToolPath,
  resolveRipgrepExecutable,
  resolveWorkspacePath,
  spawnCapture,
  workspaceRoot
} from './builtin-tool-utils.js'
import { getFastContextFileIndex } from './fast-context-file-index.js'
import { fastContextSearchBounds, isFastContextExcludedPath } from './fast-context-search-bounds.js'
import { warmFastContextSymbolIndex } from './fast-context-symbol-index.js'
import { buildFastContextWorkspaceSkeleton } from './fast-context-workspace-skeleton.js'

export const FAST_CONTEXT_MAX_HINT_PATHS = 16
const OVERVIEW_WAIT_MS = 2_500

export type FastContextRunPreparation = {
  /** Validated, existing, workspace-relative hint paths. */
  hintPaths: string[]
  /** Compact workspace overview, when the file index was ready in time. */
  skeleton?: string
}

/** Model-supplied hint paths: strings only, trimmed, bounded. */
export function parseFastContextHintPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= 1_024)
    .slice(0, FAST_CONTEXT_MAX_HINT_PATHS)
}

async function validHintPaths(
  raw: readonly string[],
  context: ToolHostContext,
  root: string
): Promise<string[]> {
  const bounds = fastContextSearchBounds({ fastContext: true })!
  const kept = new Set<string>()
  for (const candidate of raw) {
    try {
      // Same boundary checks as an ordinary read from the parent turn.
      const { absolutePath } = await resolveWorkspacePath(candidate, context)
      const relativePath = normalizeToolPath(relative(root, absolutePath))
      if (!relativePath || relativePath === '.' || relativePath.startsWith('..') || isAbsolute(relativePath)) continue
      if (isFastContextExcludedPath(relativePath, bounds)) continue
      if (!await stat(absolutePath).then(() => true, () => false)) continue
      kept.add(relativePath)
    } catch {
      // Outside the workspace or the delegated read scope: ignore the hint.
    }
  }
  return [...kept]
}

async function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(undefined), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Parent-side work done once per fast_context call, before the child starts:
 * validate hint paths, make sure the workspace file index is warm (it also
 * feeds the child's overview and the large-workspace guard), and start the
 * definition index in the background for later calls.
 */
export async function prepareFastContextRun(input: {
  context: ToolHostContext
  hintPaths: readonly string[]
  rg?: string | null
  capture?: SourceCommandCapture
  overviewWaitMs?: number
}): Promise<FastContextRunPreparation> {
  const root = workspaceRoot(input.context.workspace)
  const bounds = fastContextSearchBounds({ fastContext: true })!
  const rg = input.rg !== undefined
    ? input.rg
    : resolveRipgrepExecutable({ candidates: RG_EXECUTABLE_CANDIDATES, allowPathFallback: false })
  const capture = input.capture ?? spawnCapture
  const listing = getFastContextFileIndex(root, { rg, capture, bounds }).catch(() => null)
  // The definition index is built only for a bounded, fully listed project.
  void listing.then((index) => {
    if (!index || index.truncated || index.timedOut || index.files.length === 0) return
    return warmFastContextSymbolIndex(root, {
      rg,
      capture,
      bounds,
      ...(input.context.runtimeDataDir ? { dataDir: input.context.runtimeDataDir } : {})
    })
  }).catch(() => undefined)
  const [hintPaths, index] = await Promise.all([
    validHintPaths(input.hintPaths, input.context, root),
    withinMs(listing, input.overviewWaitMs ?? OVERVIEW_WAIT_MS)
  ])
  const skeleton = index ? buildFastContextWorkspaceSkeleton(index) : ''
  return { hintPaths, ...(skeleton ? { skeleton } : {}) }
}
