import type { ToolHostContext } from '../../ports/tool-host.js'
import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'

/**
 * `review_request` (10 §5): spawn an ephemeral read-only reviewer on a
 * different harness for a worker's completed dispatch.
 */
export async function reviewRequest(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown,
  toolContext: ToolHostContext
): ReturnType<ManagerRuntime['reviews']['request']> {
  return runtime.reviews.request(ctx, args, toolContext)
}
