import type { ToolHostContext } from '../../ports/tool-host.js'
import type {
  ManagerRuntime,
  ManagerToolContext,
  WorkerCreateResult
} from '../manager-runtime.js'

/** `worker_create` — delegates to ManagerRuntime.createWorker. */
export async function workerCreate(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown,
  toolContext: ToolHostContext
): Promise<WorkerCreateResult> {
  return runtime.createWorker(ctx, args, toolContext)
}

/** `worker_create_batch` — sequential create with skip semantics. */
export async function workerCreateBatch(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown,
  toolContext: ToolHostContext
): ReturnType<ManagerRuntime['createWorkerBatch']> {
  return runtime.createWorkerBatch(ctx, args, toolContext)
}
