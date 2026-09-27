import type { ToolHostContext } from '../../ports/tool-host.js'
import type { ManagerRuntime, ManagerToolContext } from '../manager-runtime.js'
import {
  recommendRace,
  startRace,
  type RaceServiceDeps
} from '../race.js'

/** Tool-side race deps: the manager supplies ctx + toolContext per call. */
export type RaceToolDeps = RaceServiceDeps & { ids: { next(prefix: string): string } }

/** `worker_race` (10 §6.1): dispatch 2–3 contenders from one baseline sha. */
export async function workerRace(
  runtime: ManagerRuntime,
  deps: RaceToolDeps,
  ctx: ManagerToolContext,
  args: unknown,
  toolContext: ToolHostContext
) {
  return startRace(runtime, deps, ctx, args, toolContext)
}

/**
 * `race_recommend` (10 §6.4): the manager records its pick rationale on the
 * race's `notes`; the user still decides in the compare view.
 */
export async function raceRecommend(
  deps: RaceToolDeps,
  ctx: ManagerToolContext,
  args: unknown
) {
  return recommendRace(deps, ctx, args)
}
