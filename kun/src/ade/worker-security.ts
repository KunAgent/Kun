import { isAbsolute, relative, resolve } from 'node:path'
import type { ChildSecuritySnapshot } from '../delegation/delegation-runtime-contracts.js'
import { isPathInsideOrEqual } from '../adapters/tool/workspace-path.js'

/** Map an inherited scope onto the host-created checkout, preserving its ceiling. */
export function workerWorkspaceSecurity(snapshot: ChildSecuritySnapshot, workspace: string): ChildSecuritySnapshot {
  const parentRoot = resolve(snapshot.sandboxRoot)
  const root = resolve(workspace)
  const rebase = (scopes: readonly string[]): string[] => [...new Set(scopes.flatMap((scope) => {
    const source = isAbsolute(scope) ? resolve(scope) : resolve(parentRoot, scope)
    if (!isPathInsideOrEqual(parentRoot, source)) return []
    return [resolve(root, relative(parentRoot, source))]
  }))]
  return {
    ...snapshot,
    sandboxRoot: workspace,
    ...(snapshot.allowedReadPaths !== undefined ? { allowedReadPaths: rebase(snapshot.allowedReadPaths) } : {}),
    allowedWritePaths: snapshot.allowedWritePaths === undefined ? [root] : rebase(snapshot.allowedWritePaths)
  }
}
