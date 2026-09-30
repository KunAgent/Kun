import type { QualityCheck } from '../contracts/ade.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { FileTeamStore } from './team-store.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { ApprovedSetupStep } from '../workspace-tasks/setup-runner.js'
import { BoundedLog } from '../workspace-tasks/setup-runner.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { shellSpawnEnv } from '../adapters/tool/builtin-shell-utils.js'
import { reportLanguage, type ReportLanguage } from './user-report.js'
import { captureReviewRevision } from '../workspace-tasks/review-revision.js'
import { reviewRevisionValidity } from '../contracts/review-revision.js'

/**
 * Host-originated quality checks (10 §4.2): the approved `worktree.checks`
 * commands run sequentially inside the worker's task workspace under managed
 * processes — never in the source checkout, and never without the whole-
 * config digest approval from P0-11. Results merge onto the worker's latest
 * dispatch verdict as `source: 'host'` checks; the combined log lands in the
 * artifact store.
 */
export type WorkspaceCheckRunnerDeps = {
  teams: Pick<FileTeamStore, 'get'>
  dispatches: Pick<FileDispatchStore, 'list' | 'mutate'>
  taskWorkspaces?: Pick<TaskWorkspaceService, 'get'>
  approvedChecks: (repoRoot: string) => Promise<readonly ApprovedSetupStep[]>
  artifacts?: Pick<ArtifactStore, 'put'>
  spawn?: typeof spawnOwnedProcess
  stop?: typeof stopOwnedProcess
  env?: () => NodeJS.ProcessEnv
  now?: () => number
  nowIso: () => string
  language?: () => string | undefined
}

export type RunWorkspaceChecksResult = {
  ok: boolean
  refusal?:
    | 'worker_not_found'
    | 'checks_unavailable'
    | 'no_workspace'
    | 'workspace_not_ready'
    | 'no_approved_checks'
    | 'no_dispatch'
  checks?: QualityCheck[]
  dispatchId?: string
  logArtifactId?: string
  userReport: string
}

export async function runWorkspaceChecks(
  deps: WorkspaceCheckRunnerDeps,
  input: { teamId: string; workerId: string; names?: string[]; signal?: AbortSignal }
): Promise<RunWorkspaceChecksResult> {
  const language = reportLanguage(deps.language?.())
  const team = await deps.teams.get(input.teamId).catch(() => null)
  const worker = team?.workers.find((entry) => entry.workerId === input.workerId)
  if (!worker) {
    return { ok: false, refusal: 'worker_not_found', userReport: say(language, '该 worker 不在团队中。', 'That worker is not in the team.') }
  }
  const workspace = worker.taskWorkspaceId
    ? deps.taskWorkspaces?.get(worker.taskWorkspaceId) ?? null
    : null
  if (!workspace) {
    return { ok: false, refusal: 'no_workspace', userReport: say(language, '该 worker 没有任务工作区。', 'The worker has no task workspace.') }
  }
  if (!['ready', 'captured'].includes(workspace.state)) {
    return { ok: false, refusal: 'workspace_not_ready', userReport: say(language, `工作区状态为 ${workspace.state}，不能运行检查。`, `Workspace state is ${workspace.state}; checks cannot run.`) }
  }
  const dispatch = (await deps.dispatches.list(input.teamId))
    .filter((entry) => entry.workerId === input.workerId)
    .at(-1)
  if (!dispatch) {
    return { ok: false, refusal: 'no_dispatch', userReport: say(language, '该 worker 还没有派活记录。', 'The worker has no dispatch to attach checks to.') }
  }
  const declared = await deps.approvedChecks(workspace.sourceRoot)
  const wanted = input.names?.length
    ? declared.filter((step) => input.names!.includes(step.name))
    : [...declared]
  if (!wanted.length) {
    return { ok: false, refusal: 'no_approved_checks', userReport: say(language, '没有已批准且匹配的检查命令。', 'No approved check commands match.') }
  }

  const beforeRevision = await captureReviewRevision(workspace.workspaceId, workspace.path)

  const spawn = deps.spawn ?? spawnOwnedProcess
  const stop = deps.stop ?? stopOwnedProcess
  const now = deps.now ?? (() => Date.now())
  const log = new BoundedLog()
  const checks: QualityCheck[] = []
  for (const step of wanted) {
    if (input.signal?.aborted) {
      checks.push({ name: step.name, status: 'skipped', source: 'host' })
      continue
    }
    const started = now()
    log.line(`$ ${step.command} ${step.args.join(' ')}`.trimEnd())
    const code = await spawn(step.command, step.args, {
      cwd: workspace.path,
      // Repo-declared commands never see Kun tokens or provider credentials.
      env: (deps.env ?? (() => shellSpawnEnv(process.env)))(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).then(
      (child) => waitForExit(child, step.timeoutMs, stop, log, input.signal),
      (error: unknown) => {
        log.line(`[check] spawn failed: ${errorMessage(error)}`)
        return 'spawn-error' as const
      }
    )
    const durationMs = Math.max(0, now() - started)
    const detail = `exit ${code === null ? 'timeout' : code === 'spawn-error' ? 'spawn failed' : code} · ${durationMs}ms`
    checks.push({
      name: step.name,
      status: code === 0 ? 'passed' : 'failed',
      source: 'host',
      detail
    })
    if (code !== 0) log.line(`[check] "${step.name}" ${detail}`)
  }

  const logText = log.text()
  const afterRevision = await captureReviewRevision(workspace.workspaceId, workspace.path)
  const revision = reviewRevisionValidity(beforeRevision, afterRevision) === 'current'
    ? afterRevision
    : {
        ...afterRevision,
        contentHash: undefined,
        completeness: 'incomplete' as const,
        reason: 'concurrent_change' as const
      }
  for (const check of checks) check.revision = revision
  const stored = logText.trim() && deps.artifacts
    ? await deps.artifacts.put({
        content: logText,
        source: 'other',
        origin: `workspace-checks:${workspace.workspaceId}`
      }).catch(() => null)
    : null
  // Reruns replace the same-name host entries; worker/reviewer rows stay.
  const names = new Set(checks.map((check) => check.name))
  const updated = await deps.dispatches.mutate(input.teamId, dispatch.dispatchId, (current) => ({
    verdict: {
      status: 'pending',
      ...current.verdict,
      checks: [
        ...(current.verdict?.checks ?? []).filter(
          (check) => !(check.source === 'host' && names.has(check.name))
        ),
        ...checks
      ].slice(-64)
    }
  }))
  if (!updated) {
    return { ok: false, refusal: 'no_dispatch', userReport: say(language, '派活记录已变化，检查结果未写入。', 'The dispatch changed; check results were not recorded.') }
  }
  const failed = checks.filter((check) => check.status === 'failed').length
  return {
    ok: true,
    checks,
    dispatchId: dispatch.dispatchId,
    ...(stored ? { logArtifactId: stored.meta.id } : {}),
    userReport: say(
      language,
      failed ? `检查完成：${checks.length - failed} 过、${failed} 失败。` : `检查完成：${checks.length} 项全部通过。`,
      failed ? `Checks done: ${checks.length - failed} passed, ${failed} failed.` : `Checks done: all ${checks.length} passed.`
    )
  }
}

function waitForExit(
  child: Awaited<ReturnType<typeof spawnOwnedProcess>>,
  timeoutMs: number,
  stop: typeof stopOwnedProcess,
  log: BoundedLog,
  signal?: AbortSignal
): Promise<number | null> {
  return new Promise((resolvePromise) => {
    let timedOut = false
    const append = (chunk: Buffer | string) => log.append(chunk)
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const kill = () => {
      void stop(child).catch((error: unknown) =>
        log.line(`[check] stop failed: ${errorMessage(error)}`))
    }
    const timer = setTimeout(() => {
      timedOut = true
      log.line('[check] timed out')
      kill()
    }, timeoutMs)
    const onAbort = () => kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', (error) => append(`${error.message}\n`))
    child.once('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolvePromise(timedOut ? null : code)
    })
  })
}

function say(language: ReportLanguage, zh: string, en: string): string {
  return language === 'zh' ? zh : en
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
