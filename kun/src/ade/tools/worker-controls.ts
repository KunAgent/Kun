import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'

/**
 * Thin handlers for the control-plane tools (09 §4.1): the ManagerRuntime's
 * controls/teamControls do the work; these exist so the provider file stays
 * declarative.
 */
export async function workerSend(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['workerSend']> {
  return runtime.controls.workerSend(ctx, args)
}

export async function workerStop(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['workerStop']> {
  return runtime.controls.workerStop(ctx, args)
}

export async function workerRelease(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['workerRelease']> {
  return runtime.controls.workerRelease(ctx, args)
}

export async function workerAnswer(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['workerAnswer']> {
  return runtime.controls.workerAnswer(ctx, args)
}

export async function dispatchQueue(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['dispatchQueue']> {
  return runtime.controls.dispatchQueue(ctx, args)
}

export async function dispatchUpdate(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['dispatchUpdate']> {
  return runtime.controls.dispatchUpdate(ctx, args)
}

export async function dispatchCancel(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['dispatchCancel']> {
  return runtime.controls.dispatchCancel(ctx, args)
}

export async function workerApprove(
  runtime: ManagerRuntime,
  ctx: ManagerToolContext,
  args: unknown
): ReturnType<ManagerRuntime['controls']['workerApprove']> {
  return runtime.controls.workerApprove(ctx, args)
}
