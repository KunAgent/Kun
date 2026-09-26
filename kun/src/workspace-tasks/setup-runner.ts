import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { shellSpawnEnv } from '../adapters/tool/builtin-shell-utils.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { TaskWorkspaceSetup } from '../contracts/task-workspace.js'

/** Approved setup execution for task workspaces (docs/ade/07 §7.2). */

export type ApprovedSetupStep = {
  name: string
  command: string
  args: string[]
  timeoutMs: number
}

const SETUP_LOG_MAX_BYTES = 1024 * 1024

/** Tail-bounded in-memory log; chunks are UTF-8 appended, oldest dropped. */
export class BoundedLog {
  private chunks: string[] = []
  private bytes = 0
  constructor(private readonly maxBytes = SETUP_LOG_MAX_BYTES) {}

  append(chunk: Buffer | string): void {
    if (this.maxBytes <= 0) return
    this.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
  }

  line(text: string): void {
    this.push(`${text}\n`)
  }

  text(): string {
    return this.chunks.join('')
  }

  private push(text: string): void {
    if (!text) return
    this.chunks.push(text)
    this.bytes += Buffer.byteLength(text, 'utf8')
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      const first = this.chunks.shift() as string
      this.bytes -= Buffer.byteLength(first, 'utf8')
    }
    if (this.bytes > this.maxBytes) {
      const kept = this.chunks[0]?.slice(-Math.max(0, Math.floor(this.maxBytes / 2))) ?? ''
      this.chunks = [kept]
      this.bytes = Buffer.byteLength(kept, 'utf8')
    }
  }
}

export type TaskWorkspaceSetupRunnerDeps = {
  artifacts?: ArtifactStore
  spawn?: typeof spawnOwnedProcess
  stop?: typeof stopOwnedProcess
  env?: () => NodeJS.ProcessEnv
  now?: () => number
}

export type SetupRunOptions = {
  /** Env-fill summary written at the top of the log (07 §7.3). */
  logHeader?: string
}

export class TaskWorkspaceSetupRunner {
  private readonly spawn: typeof spawnOwnedProcess
  private readonly stop: typeof stopOwnedProcess
  private readonly now: () => number

  constructor(private readonly deps: TaskWorkspaceSetupRunnerDeps) {
    this.spawn = deps.spawn ?? spawnOwnedProcess
    this.stop = deps.stop ?? stopOwnedProcess
    this.now = deps.now ?? (() => Date.now())
  }

  async run(
    workspaceId: string,
    cwd: string,
    steps: readonly ApprovedSetupStep[],
    signal: AbortSignal,
    options: SetupRunOptions = {}
  ): Promise<TaskWorkspaceSetup> {
    const started = this.now()
    const log = new BoundedLog()
    if (options.logHeader) log.line(options.logHeader)
    for (const step of steps) {
      signal.throwIfAborted()
      log.line(`$ ${step.command} ${step.args.join(' ')}`.trimEnd())
      const child = await this.spawn(step.command, step.args, {
        cwd,
        // Repo-declared commands never see Kun tokens or provider credentials.
        env: (this.deps.env ?? (() => shellSpawnEnv(process.env)))(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const code = await this.waitStep(child, step.timeoutMs, signal, log)
      if (signal.aborted) signal.throwIfAborted()
      if (code !== 0) {
        log.line(`[setup] "${step.name}" exited with code ${code ?? 'null'}`)
        return this.finish(workspaceId, 'failed', log, started)
      }
    }
    return this.finish(workspaceId, steps.length ? 'succeeded' : 'skipped', log, started)
  }

  private waitStep(
    child: Awaited<ReturnType<typeof spawnOwnedProcess>>,
    timeoutMs: number,
    signal: AbortSignal,
    log: BoundedLog
  ): Promise<number | null> {
    return new Promise((resolvePromise) => {
      let timedOut = false
      const append = (chunk: Buffer | string) => log.append(chunk)
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      const stop = () => {
        void this.stop(child).catch((error: unknown) =>
          log.line(`[setup] stop failed: ${error instanceof Error ? error.message : error}`))
      }
      const timer = setTimeout(() => {
        timedOut = true
        log.line('[setup] timed out')
        stop()
      }, timeoutMs)
      const onAbort = () => stop()
      signal.addEventListener('abort', onAbort, { once: true })
      child.once('error', (error) => append(`${error.message}\n`))
      child.once('close', (code) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolvePromise(timedOut ? null : code)
      })
    })
  }

  private async finish(
    workspaceId: string,
    status: TaskWorkspaceSetup['status'],
    log: BoundedLog,
    started: number
  ): Promise<TaskWorkspaceSetup> {
    const durationMs = Math.max(0, this.now() - started)
    const content = log.text()
    if (!content.trim() || !this.deps.artifacts) return { status, durationMs }
    const stored = await this.deps.artifacts.put({
      content,
      source: 'other',
      origin: `task-workspace-setup:${workspaceId}`
    })
    return { status, logArtifactId: stored.meta.id, durationMs }
  }
}
