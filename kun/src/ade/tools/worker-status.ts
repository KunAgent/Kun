import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'

/** `worker_status` — read-only worker/dispatch/activity view (09 §4). */
export async function workerStatus(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['workerStatus']> {
  return runtime.workerStatus(ctx, args)
}

/** `worker_read` — read-only recent worker messages for the manager. */
export async function workerRead(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['workerRead']> {
  return runtime.workerRead(ctx, args)
}
