import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'

/**
 * `worker_verdict` (10 §4.2): the manager records a quality decision for a
 * dispatch. Thin wrapper — QualityVerdicts owns the supersede/lock rules.
 */
export async function workerVerdict(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['verdicts']['workerVerdict']> {
  return runtime.verdicts.workerVerdict(ctx, args)
}
