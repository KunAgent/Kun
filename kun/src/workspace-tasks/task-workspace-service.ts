import { realpath, stat } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { workspaceGit, workspaceWriteMutexContext } from './workspace-git.js'
import { resolveStartFrom } from './start-from-resolver.js'
import type { WorktreeLifecycle } from './worktree-lifecycle.js'
import type { TaskWorkspaceStore } from './task-workspace-store.js'
import {
  captureTaskWorkspace,
  patchDiffStats,
  cleanupIntegratedTaskWorkspace,
  discardTaskWorkspace,
  integrateTaskWorkspace,
  preservedBranchesForRepo,
  type TaskWorkspaceArtifacts,
  type TaskWorkspaceIntegrateResult,
  type WorkspaceIntegrationContext
} from './task-workspace-integration.js'
import type { KunProjectWorktreeConfig } from '../config/project-config.js'
import type {
  ApprovedSetupStep,
  SetupRunOptions
} from './setup-runner.js'
import type { EnvFillResult } from './environment-fill.js'
import {
  taskBranchName,
  type CreateTaskWorkspaceRequest,
  type TaskWorkspaceRecord,
  type TaskWorkspaceSetup
} from '../contracts/task-workspace.js'

export type SetupStep = ApprovedSetupStep

export type TaskWorkspaceServiceOptions = {
  store: TaskWorkspaceStore
  lifecycle: WorktreeLifecycle
  events?: { record(draft: RuntimeEventDraft): Promise<unknown> | unknown }
  /** Root under which task worktrees live; defaults to ~/.kun/worktrees/tasks. */
  worktreeRoot?: string
  fetchTimeoutMs?: number
  nowIso?: () => string
  newId?: () => string
  /** Live `.kun/project.json` resolution; absent → no env fill, setup 'skipped'. */
  projectConfig?: (repoRoot: string) => Promise<TaskWorkspaceProjectConfig | null>
  /** Approved setup steps for a repo (07 §7.1); absent/[] → 'not-approved'. */
  approvedSetup?: (repoRoot: string) => Promise<SetupStep[]>
  /** Runs the approved setup steps; absent → 'not-approved' when declared. */
  setupRunner?: {
    run(
      workspaceId: string,
      cwd: string,
      steps: SetupStep[],
      signal: AbortSignal,
      options?: SetupRunOptions
    ): Promise<TaskWorkspaceSetup>
  }
  /** shareDirectories + copyIncludedFiles (07 §6); absent → no env fill. */
  environmentFill?: (input: {
    repoRoot: string
    worktreePath: string
    config: KunProjectWorktreeConfig | undefined
  }) => Promise<EnvFillResult>
  /** Patch/log artifact storage (07 §8.1); absent → capture keeps no patch. */
  artifacts?: TaskWorkspaceArtifacts
}

/** Shape this service needs from `.kun/project.json`. */
export type TaskWorkspaceProjectConfig = {
  worktree?: KunProjectWorktreeConfig
}

const WRITE_MUTEX_RESOURCE = 'ade/task-workspace-git'

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
}

/** Host-owned task workspace lifecycle (docs/ade/07 §5). */
export class TaskWorkspaceService {
  private readonly options: TaskWorkspaceServiceOptions
  private readonly nowIso: () => string
  private readonly newId: () => string
  private readonly worktreeRoot: string
  private readonly repoLocks = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<(record: TaskWorkspaceRecord) => void>()

  constructor(options: TaskWorkspaceServiceOptions) {
    this.options = options
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.newId =
      options.newId ??
      (() => `tws_${randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0')}`)
    this.worktreeRoot =
      options.worktreeRoot ?? join(homedir(), '.kun', 'worktrees', 'tasks')
  }

  /** creating/setting-up records from a previous process are stale. */
  recoverInterrupted(): number {
    let recovered = 0
    for (const record of this.options.store.list()) {
      if (record.state === 'creating' || record.state === 'setting-up') {
        this.options.store.update(record.workspaceId, {
          state: 'failed',
          lastError: 'interrupted: runtime restarted while the workspace was being created',
          updatedAt: this.nowIso()
        })
        recovered += 1
      }
    }
    return recovered
  }

  onChange(listener: (record: TaskWorkspaceRecord) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get(workspaceId: string): TaskWorkspaceRecord | undefined {
    return this.options.store.get(workspaceId)
  }

  list(filter?: { ownerThreadId?: string }): TaskWorkspaceRecord[] {
    return this.options.store.list(filter)
  }

  create(input: CreateTaskWorkspaceRequest, callerSignal?: AbortSignal): TaskWorkspaceRecord {
    const now = this.nowIso()
    const record = this.options.store.insert({
      workspaceId: this.newId(),
      ownerThreadId: input.ownerThreadId,
      ...(input.unitId ? { unitId: input.unitId } : {}),
      ...(input.label ? { label: input.label } : {}),
      isolation: input.isolation,
      sourceRoot: input.sourceRoot,
      path: input.sourceRoot,
      startFrom: input.startFrom,
      state: 'creating',
      setup: { status: 'pending' },
      changedFiles: [],
      createdAt: now,
      updatedAt: now
    })
    const controller = new AbortController()
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort()
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    this.controllers.set(record.workspaceId, controller)
    void this.runCreate(record.workspaceId, input, controller.signal)
    return record
  }

  retry(workspaceId: string): TaskWorkspaceRecord {
    const record = this.options.store.get(workspaceId)
    if (!record) throw new TaskWorkspaceError('not_found', 'task workspace not found')
    if (record.state !== 'failed') {
      throw new TaskWorkspaceError('conflict', `task workspace is ${record.state}, not failed`)
    }
    if (this.controllers.has(workspaceId)) {
      throw new TaskWorkspaceError('conflict', 'task workspace creation is still running')
    }
    const input: CreateTaskWorkspaceRequest = {
      ownerThreadId: record.ownerThreadId,
      ...(record.unitId ? { unitId: record.unitId } : {}),
      ...(record.label ? { label: record.label } : {}),
      sourceRoot: record.sourceRoot,
      isolation: record.isolation,
      startFrom: record.startFrom
    }
    const controller = new AbortController()
    this.controllers.set(workspaceId, controller)
    this.options.store.update(workspaceId, {
      state: 'creating',
      lastError: undefined,
      updatedAt: this.nowIso()
    })
    this.emit(workspaceId)
    void this.runCreate(workspaceId, input, controller.signal)
    return this.options.store.get(workspaceId) ?? record
  }

  markReady(workspaceId: string): TaskWorkspaceRecord {
    const record = this.options.store.get(workspaceId)
    if (!record) throw new TaskWorkspaceError('not_found', 'task workspace not found')
    if (record.state !== 'failed') {
      throw new TaskWorkspaceError('conflict', `task workspace is ${record.state}, not failed`)
    }
    return this.finish(workspaceId, { state: 'ready' })
  }

  cancel(workspaceId: string): TaskWorkspaceRecord {
    const record = this.options.store.get(workspaceId)
    if (!record) throw new TaskWorkspaceError('not_found', 'task workspace not found')
    const controller = this.controllers.get(workspaceId)
    if (!controller || (record.state !== 'creating' && record.state !== 'setting-up')) {
      throw new TaskWorkspaceError('conflict', `task workspace is ${record.state}; nothing to cancel`)
    }
    controller.abort()
    return this.options.store.get(workspaceId) ?? record
  }

  /** Capture committed + uncommitted worktree changes into a patch artifact. */
  async capture(workspaceId: string): Promise<TaskWorkspaceRecord> {
    const { record } = await captureTaskWorkspace(this.integrationContext(), workspaceId)
    return record
  }

  /**
   * Capture plus the dispatch-facing diff stat (09 §6.1): changed-file count,
   * insertions/deletions parsed from the patch, and the patch artifact id.
   */
  async captureForDispatch(workspaceId: string): Promise<{
    record: TaskWorkspaceRecord
    stat: {
      changedFiles: number
      insertions: number
      deletions: number
      patchArtifactId?: string
    }
  }> {
    const { record, patch } = await captureTaskWorkspace(this.integrationContext(), workspaceId)
    return {
      record,
      stat: {
        changedFiles: record.changedFiles.length,
        ...patchDiffStats(patch),
        ...(record.patchArtifactId ? { patchArtifactId: record.patchArtifactId } : {})
      }
    }
  }

  /**
   * Working-tree baseline sha for the ADE user-takeover interval (09 §9).
   * Only worktree-isolated workspaces have a host worktree to snapshot.
   */
  async snapshotBaseline(workspaceId: string): Promise<string | undefined> {
    const record = this.options.store.get(workspaceId)
    if (
      !record?.path ||
      record.isolation !== 'worktree' ||
      record.path === record.sourceRoot ||
      !['ready', 'captured', 'conflict'].includes(record.state)
    ) {
      return undefined
    }
    return this.options.lifecycle.snapshot(record.path).catch(() => undefined)
  }

  /** Diff stats between a snapshotBaseline() sha and the live worktree. */
  async diffSinceBaseline(
    workspaceId: string,
    baseTree: string
  ): Promise<{ changedFiles: number; insertions: number; deletions: number } | undefined> {
    const record = this.options.store.get(workspaceId)
    if (
      !record?.path ||
      record.isolation !== 'worktree' ||
      record.path === record.sourceRoot
    ) {
      return undefined
    }
    const diff = await this.options.lifecycle
      .diffSince({ path: record.path, baseTree })
      .catch(() => undefined)
    if (!diff) return undefined
    return { changedFiles: diff.changedFiles.length, ...patchDiffStats(diff.patch) }
  }

  /** Integrate into the source repository; serialized per repo (07 §8). */
  async integrate(
    workspaceId: string,
    mode: 'apply-patch' | 'merge-branch' = 'apply-patch'
  ): Promise<TaskWorkspaceIntegrateResult> {
    return integrateTaskWorkspace(this.integrationContext(), workspaceId, mode)
  }

  /** Preview without confirm; force-removes worktree + branch with it. */
  async discard(workspaceId: string, confirm: boolean): Promise<TaskWorkspaceRecord> {
    return discardTaskWorkspace(this.integrationContext(), workspaceId, confirm)
  }

  /** Non-force cleanup after integrate; unmerged branches are preserved. */
  async cleanupIntegrated(workspaceId: string): Promise<TaskWorkspaceRecord> {
    return cleanupIntegratedTaskWorkspace(this.integrationContext(), workspaceId)
  }

  async preservedBranches(repoRoot: string) {
    return preservedBranchesForRepo(this.integrationContext(), repoRoot)
  }

  private integrationContext(): WorkspaceIntegrationContext {
    return {
      store: this.options.store,
      lifecycle: this.options.lifecycle,
      artifacts: this.options.artifacts,
      nowIso: this.nowIso,
      withRepoLock: (repoRoot, operation) => this.withRepoLock(repoRoot, operation),
      withWriteContext: (operation) => this.withWriteContext(operation),
      emit: (workspaceId) => this.emit(workspaceId)
    }
  }

  // ------------------------------------------------------------------

  private async runCreate(
    workspaceId: string,
    input: CreateTaskWorkspaceRequest,
    signal: AbortSignal
  ): Promise<void> {
    try {
      signal.throwIfAborted()
      const repo = await this.detectRepository(input.sourceRoot)
      if (!repo) {
        if (input.isolation === 'worktree') {
          this.fail(
            workspaceId,
            'source is not a git repository; choose local or directory isolation'
          )
          return
        }
        this.finish(workspaceId, {
          state: 'ready',
          path: input.sourceRoot,
          setup: { status: 'skipped' }
        })
        return
      }
      if (input.isolation !== 'worktree') {
        this.finish(workspaceId, {
          state: 'ready',
          path: input.sourceRoot,
          repositoryRoot: repo.root,
          setup: { status: 'skipped' }
        })
        return
      }

      const existing = this.options.store.get(workspaceId)
      const resumable =
        existing?.baseRevision !== undefined &&
        existing.path !== input.sourceRoot &&
        (await stat(existing.path).then(() => true, () => false))
      if (resumable && existing) {
        // Retry after a post-worktree failure: keep the existing checkout.
        await this.runSettingUp(workspaceId, repo.root, existing.path, signal)
        return
      }

      await this.progress(workspaceId, 'resolve', 'Resolving start point')
      const start = await resolveStartFrom(repo, input.startFrom, {
        signal,
        fetchTimeoutMs: this.options.fetchTimeoutMs
      })
      if (start.warning) {
        await this.progress(workspaceId, 'resolve', start.warning.slice(0, 256))
      }
      await this.progress(workspaceId, 'worktree', 'Creating worktree')
      const path = this.worktreePath(repo.root, workspaceId)
      const config = this.options.projectConfig
        ? await this.options.projectConfig(repo.root)
        : null
      const branch = taskBranchName(
        config?.worktree?.branchPrefix ?? 'kun/',
        input.label ?? 'task',
        workspaceId
      )
      await this.withRepoLock(repo.root, () =>
        this.withWriteContext(() =>
          this.options.lifecycle.create({
            repositoryRoot: repo.root,
            path,
            startRevision: start.sha,
            branch
          })))
      const targetBranch = await this.resolveTargetBranch(repo.root, input.startFrom, start, signal)
      this.options.store.update(workspaceId, {
        repositoryRoot: repo.root,
        path,
        baseRevision: start.sha,
        branch,
        ...(targetBranch ? { targetBranch } : {}),
        updatedAt: this.nowIso()
      })
      if (this.options.environmentFill) {
        await this.progress(workspaceId, 'share', 'Linking shared directories')
        const fill = await this.options.environmentFill({
          repoRoot: repo.root,
          worktreePath: path,
          config: config?.worktree
        })
        this.options.store.update(workspaceId, {
          environmentFill: {
            shared: fill.shared.slice(0, 256),
            copied: fill.copied.slice(0, 256),
            skipped: fill.skipped.slice(0, 256),
            warnings: fill.warnings.slice(0, 64)
          },
          updatedAt: this.nowIso()
        })
        const summary =
          `shared ${fill.shared.length}, copied ${fill.copied.length}, skipped ${fill.skipped.length}`
        await this.progress(workspaceId, 'copy', `Local files: ${summary}`.slice(0, 256))
      }
      await this.runSettingUp(workspaceId, repo.root, path, signal)
    } catch (error) {
      if (signal.aborted) {
        await this.rollbackWorktree(workspaceId)
        return this.fail(workspaceId, 'cancelled')
      }
      return this.fail(workspaceId, boundedError(error))
    }
  }

  private async runSettingUp(
    workspaceId: string,
    repoRoot: string,
    path: string,
    signal: AbortSignal
  ): Promise<void> {
    this.options.store.update(workspaceId, {
      state: 'setting-up',
      repositoryRoot: repoRoot,
      path,
      updatedAt: this.nowIso()
    })
    this.emit(workspaceId)
    signal.throwIfAborted()
    const config = this.options.projectConfig
      ? await this.options.projectConfig(repoRoot)
      : null
    const declared = config?.worktree?.setup ?? []
    let setup: TaskWorkspaceSetup
    if (!declared.length) {
      setup = { status: 'skipped' }
    } else {
      const approved = this.options.approvedSetup
        ? await this.options.approvedSetup(repoRoot)
        : []
      if (!approved.length || !this.options.setupRunner) {
        setup = { status: 'not-approved' }
      } else {
        await this.progress(workspaceId, 'setup', 'Running setup')
        this.options.store.update(workspaceId, {
          setup: { status: 'running' },
          updatedAt: this.nowIso()
        })
        this.emit(workspaceId)
        const fill = this.options.store.get(workspaceId)?.environmentFill
        const logHeader = fill
          ? [
              `shared: ${fill.shared.join(', ') || '-'}`,
              `copied: ${fill.copied.join(', ') || '-'}`,
              `skipped: ${fill.skipped.map((entry) => `${entry.path} (${entry.reason})`).join(', ') || '-'}`,
              ...fill.warnings.map((warning) => `warning: ${warning}`)
            ].join('\n')
          : undefined
        setup = await this.options.setupRunner.run(
          workspaceId, path, approved, signal,
          logHeader ? { logHeader } : {}
        )
      }
    }
    this.finish(workspaceId, {
      state: setup.status === 'failed' ? 'failed' : 'ready',
      setup
    })
  }

  /**
   * Local branch that `merge-branch` integration targets. Remote-tracking
   * starts map to their local counterpart when it exists; detached/commit
   * starts have no target.
   */
  private async resolveTargetBranch(
    repoRoot: string,
    startFrom: CreateTaskWorkspaceRequest['startFrom'],
    start: { sha: string; ref?: string },
    signal: AbortSignal
  ): Promise<string | undefined> {
    if (startFrom.kind === 'branch') return startFrom.name
    if (startFrom.kind !== 'current-head' && startFrom.kind !== 'default-branch') return undefined
    const ref = start.ref
      ?? await workspaceGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
        .then((out) => out.trim(), () => '')
    if (!ref) return undefined
    if (ref.startsWith('origin/')) {
      const local = ref.slice('origin/'.length)
      const exists = await workspaceGit(repoRoot, [
        'rev-parse', '--verify', `refs/heads/${local}^{commit}`
      ], signal).then(() => true, () => false)
      return exists ? local : undefined
    }
    return ref
  }

  private async detectRepository(sourceRoot: string): Promise<{ root: string } | null> {
    try {
      const topLevel = (await workspaceGit(sourceRoot, ['rev-parse', '--show-toplevel'])).trim()
      const root = await realpath(topLevel).catch(() => topLevel)
      return { root }
    } catch {
      return null
    }
  }

  private worktreePath(repoRoot: string, workspaceId: string): string {
    const name = basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'repo'
    const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)
    return join(this.worktreeRoot, `${name}-${hash}`, workspaceId)
  }

  private async rollbackWorktree(workspaceId: string): Promise<void> {
    const record = this.options.store.get(workspaceId)
    if (!record?.repositoryRoot || record.path === record.sourceRoot) return
    const exists = await stat(record.path).then(() => true, () => false)
    if (!exists) return
    await this.withWriteContext(() =>
      this.options.lifecycle.remove(
        { repositoryRoot: record.repositoryRoot as string, path: record.path },
        { force: true }
      )).catch(() => undefined)
  }

  private withRepoLock<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.repoLocks.get(repoRoot) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    this.repoLocks.set(repoRoot, run.then(() => undefined, () => undefined))
    return run
  }

  private withWriteContext<T>(operation: () => Promise<T>): Promise<T> {
    return withManagerDataMutex(WRITE_MUTEX_RESOURCE, (context) =>
      workspaceWriteMutexContext.run(context, operation))
  }

  private async progress(
    workspaceId: string,
    step: 'resolve' | 'fetch' | 'worktree' | 'share' | 'copy' | 'setup',
    message: string
  ): Promise<void> {
    this.options.store.update(workspaceId, {
      progress: { step, message },
      updatedAt: this.nowIso()
    })
    this.emit(workspaceId)
  }

  private finish(
    workspaceId: string,
    patch: Partial<TaskWorkspaceRecord>
  ): TaskWorkspaceRecord {
    const record = this.options.store.update(workspaceId, {
      progress: undefined,
      ...patch,
      updatedAt: this.nowIso()
    })
    this.controllers.delete(workspaceId)
    this.emit(workspaceId)
    if (!record) throw new TaskWorkspaceError('not_found', 'task workspace not found')
    return record
  }

  private fail(workspaceId: string, reason: string): void {
    this.finish(workspaceId, { state: 'failed', lastError: reason.slice(0, 2_048) })
  }

  private emit(workspaceId: string): void {
    const record = this.options.store.get(workspaceId)
    if (!record) return
    for (const listener of this.listeners) {
      try {
        listener(record)
      } catch {
        // listeners are best-effort
      }
    }
    if (!this.options.events) return
    try {
      void Promise.resolve(this.options.events.record({
        kind: 'task_workspace',
        threadId: record.ownerThreadId,
        taskWorkspace: {
          workspaceId: record.workspaceId,
          ...(record.unitId ? { unitId: record.unitId } : {}),
          state: record.state,
          ...(record.progress ? { progress: record.progress } : {}),
          setup: record.setup,
          workspace: {
            path: record.path,
            sourceRoot: record.sourceRoot,
            kind: record.isolation,
            ...(record.branch ? { branch: record.branch } : {})
          }
        }
      })).catch(() => undefined)
    } catch {
      // event fan-out must never break workspace operations
    }
  }
}

export class TaskWorkspaceError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string
  ) {
    super(message)
  }
}
