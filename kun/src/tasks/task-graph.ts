/**
 * Persistent task graph (P1 #2).
 *
 * More than a flat todo list or a single useWorktree flag: tasks form a DAG with
 * dependencies, priority, a concurrency limit, pause/resume, failure retry, a
 * per-task resource budget, and an optional per-task worktree. This is the pure
 * scheduling core — it computes the ready set (respecting deps + concurrency),
 * applies state transitions, handles retry with backoff bookkeeping, and detects
 * cycles. Persistence and actual execution live in a thin layer on top.
 */

export type TaskState = 'pending' | 'ready' | 'running' | 'blocked' | 'paused' | 'succeeded' | 'failed' | 'cancelled'

export type TaskNode = {
  id: string
  title: string
  /** Ids this task depends on; it cannot start until all have succeeded. */
  dependsOn: string[]
  /** Higher runs first among ready tasks. Default 0. */
  priority: number
  state: TaskState
  attempts: number
  maxAttempts: number
  /** Optional per-task worktree path. */
  worktree?: string
  /** Optional resource budget (tokens) for the task. */
  tokenBudget?: number
  lastError?: string
  /** Earliest time (ms epoch) the task may be retried after a failure. */
  nextAttemptAt?: number
}

export type TaskGraphData = {
  tasks: Record<string, TaskNode>
  /** Max tasks allowed in `running` at once. */
  concurrency: number
}

export type AddTaskInput = {
  id: string
  title: string
  dependsOn?: string[]
  priority?: number
  maxAttempts?: number
  worktree?: string
  tokenBudget?: number
}

export type TaskGraphOptions = {
  concurrency?: number
  now?: () => number
  /** First retry backoff; doubles per attempt up to retryMaxDelayMs. Default 1000. */
  retryBaseDelayMs?: number
  retryMaxDelayMs?: number
}

export class TaskGraph {
  private readonly tasks = new Map<string, TaskNode>()
  private concurrency: number
  private readonly now: () => number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number

  constructor(input: TaskGraphOptions = {}) {
    this.concurrency = Math.max(1, input.concurrency ?? 1)
    this.now = input.now ?? (() => Date.now())
    this.retryBaseDelayMs = input.retryBaseDelayMs ?? 1_000
    this.retryMaxDelayMs = input.retryMaxDelayMs ?? 30_000
  }

  add(input: AddTaskInput): TaskNode {
    if (this.tasks.has(input.id)) throw new Error(`duplicate task id: ${input.id}`)
    const node: TaskNode = {
      id: input.id,
      title: input.title,
      dependsOn: [...(input.dependsOn ?? [])],
      priority: input.priority ?? 0,
      state: 'pending',
      attempts: 0,
      maxAttempts: Math.max(1, input.maxAttempts ?? 1),
      ...(input.worktree ? { worktree: input.worktree } : {}),
      ...(input.tokenBudget ? { tokenBudget: input.tokenBudget } : {})
    }
    this.tasks.set(input.id, node)
    const cycle = this.detectCycle()
    if (cycle) {
      this.tasks.delete(input.id)
      throw new Error(`dependency cycle: ${cycle.join(' -> ')}`)
    }
    return node
  }

  setConcurrency(limit: number): void {
    this.concurrency = Math.max(1, limit)
  }

  get(id: string): TaskNode | undefined {
    return this.tasks.get(id)
  }

  list(): TaskNode[] {
    return [...this.tasks.values()]
  }

  /** Detect a dependency cycle; returns the cycle path or null when acyclic. */
  detectCycle(): string[] | null {
    const visited = new Set<string>()
    const stack = new Set<string>()
    const path: string[] = []
    const visit = (id: string): string[] | null => {
      if (stack.has(id)) return [...path.slice(path.indexOf(id)), id]
      if (visited.has(id)) return null
      visited.add(id)
      stack.add(id)
      path.push(id)
      for (const dep of this.tasks.get(id)?.dependsOn ?? []) {
        if (!this.tasks.has(dep)) continue
        const cycle = visit(dep)
        if (cycle) return cycle
      }
      stack.delete(id)
      path.pop()
      return null
    }
    for (const id of this.tasks.keys()) {
      const cycle = visit(id)
      if (cycle) return cycle
    }
    return null
  }

  private depsSucceeded(node: TaskNode): boolean {
    return node.dependsOn.every((dep) => this.tasks.get(dep)?.state === 'succeeded')
  }

  private depsUnsatisfiable(node: TaskNode): boolean {
    return node.dependsOn.some((dep) => {
      const depNode = this.tasks.get(dep)
      // A missing dependency can never be satisfied → the task is blocked, not
      // left pending forever.
      if (!depNode) return true
      return depNode.state === 'failed' || depNode.state === 'cancelled' || depNode.state === 'blocked'
    })
  }

  /**
   * Recompute derived states: a pending task whose deps all succeeded becomes
   * `ready`; one with a failed/cancelled/blocked/missing dep becomes `blocked`.
   * Running/paused/terminal states are left untouched.
   */
  reconcile(): void {
    for (const node of this.tasks.values()) {
      if (node.state !== 'pending' && node.state !== 'ready' && node.state !== 'blocked') continue
      if (this.depsUnsatisfiable(node)) {
        node.state = 'blocked'
      } else if (this.depsSucceeded(node)) {
        node.state = 'ready'
      } else {
        node.state = 'pending'
      }
    }
  }

  /** Number of tasks currently running. */
  runningCount(): number {
    return this.list().filter((node) => node.state === 'running').length
  }

  /**
   * The next batch of tasks to start: ready tasks (deps satisfied, not paused),
   * highest priority first, bounded by remaining concurrency.
   */
  nextRunnable(): TaskNode[] {
    this.reconcile()
    const slots = this.concurrency - this.runningCount()
    if (slots <= 0) return []
    return this.list()
      .filter((node) => node.state === 'ready')
      .filter((node) => node.nextAttemptAt === undefined || node.nextAttemptAt <= this.now())
      .sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id))
      .slice(0, slots)
  }

  markRunning(id: string): void {
    const node = this.require(id)
    if (node.state !== 'ready') throw new Error(`task ${id} is not ready (state: ${node.state})`)
    node.state = 'running'
    node.attempts += 1
    node.nextAttemptAt = undefined
  }

  markSucceeded(id: string): void {
    const node = this.require(id)
    if (node.state !== 'running') throw new Error(`task ${id} is not running (state: ${node.state})`)
    node.state = 'succeeded'
    node.lastError = undefined
    this.reconcile()
  }

  /**
   * Fail a running task. Retries (back to `ready`) while attempts remain;
   * otherwise terminal `failed`, which cascades dependents to `blocked` on the
   * next reconcile.
   */
  markFailed(id: string, error: string): { retried: boolean } {
    const node = this.require(id)
    if (node.state !== 'running') throw new Error(`task ${id} is not running (state: ${node.state})`)
    node.lastError = error
    if (node.attempts < node.maxAttempts) {
      node.state = 'ready'
      // Exponential backoff so a flapping task does not hot-loop; nextRunnable
      // skips it until nextAttemptAt.
      const delay = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** (node.attempts - 1))
      node.nextAttemptAt = this.now() + delay
      return { retried: true }
    }
    node.state = 'failed'
    this.reconcile()
    return { retried: false }
  }

  pause(id: string): void {
    const node = this.require(id)
    if (node.state === 'succeeded' || node.state === 'failed' || node.state === 'cancelled') return
    node.state = 'paused'
  }

  resume(id: string): void {
    const node = this.require(id)
    if (node.state !== 'paused') return
    node.state = 'pending'
    this.reconcile()
  }

  cancel(id: string): void {
    const node = this.require(id)
    if (node.state === 'succeeded' || node.state === 'failed' || node.state === 'cancelled') return
    node.state = 'cancelled'
    this.reconcile()
  }

  /** True when every task reached a terminal state (blocked is terminal: its deps can never satisfy). */
  isComplete(): boolean {
    this.reconcile()
    return this.list().every((node) => ['succeeded', 'failed', 'cancelled', 'blocked'].includes(node.state))
  }

  toJSON(): TaskGraphData {
    const tasks: Record<string, TaskNode> = {}
    for (const [id, node] of this.tasks) tasks[id] = { ...node, dependsOn: [...node.dependsOn] }
    return { tasks, concurrency: this.concurrency }
  }

  static fromJSON(data: TaskGraphData): TaskGraph {
    const graph = new TaskGraph({ concurrency: data.concurrency })
    for (const node of Object.values(data.tasks)) {
      graph.tasks.set(node.id, { ...node, dependsOn: [...node.dependsOn] })
    }
    const cycle = graph.detectCycle()
    if (cycle) throw new Error(`dependency cycle: ${cycle.join(' -> ')}`)
    return graph
  }

  private require(id: string): TaskNode {
    const node = this.tasks.get(id)
    if (!node) throw new Error(`unknown task: ${id}`)
    return node
  }
}
