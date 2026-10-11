import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'

/**
 * `workspace_integrate`: user-approved merge of a task worktree
 * back into its source checkout. Unattended managers defer to the user.
 */
export async function workspaceIntegrate(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['workspaces']['integrate']> {
  return runtime.workspaces.integrate(ctx, args)
}
