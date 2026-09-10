/** Shared asset transfers retain independent manual and playback owners. */
type Task = { owners: Set<string>; controller: AbortController; result: Promise<unknown> }
export class KokoroDownloadTasks {
  private readonly tasks = new Map<string, Task>()
  private closed = false

  has(key: string): boolean { return this.tasks.has(key) }

  run<T>(key: string, owner: string | undefined, start: (controller: AbortController) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Local speech downloads are shutting down'))
    const existing = this.tasks.get(key)
    if (existing && !existing.controller.signal.aborted) {
      existing.owners.add(owner ?? 'manual')
      return existing.result as Promise<T>
    }
    const controller = new AbortController()
    const task: Task = { owners: new Set([owner ?? 'manual']), controller, result: Promise.resolve() }
    this.tasks.set(key, task)
    task.result = (existing?.result.catch(() => undefined) ?? Promise.resolve()).then(() => {
      controller.signal.throwIfAborted()
      return start(controller)
    }).finally(() => {
      if (this.tasks.get(key) === task) this.tasks.delete(key)
    })
    return task.result as Promise<T>
  }

  release(owner: string): void {
    for (const task of this.tasks.values()) {
      if (task.owners.delete(owner) && task.owners.size === 0) task.controller.abort()
    }
  }

  async cancel(key: string): Promise<void> {
    const task = this.tasks.get(key)
    task?.controller.abort()
    await task?.result.catch(() => undefined)
  }

  releasePlayback(): void {
    for (const task of this.tasks.values()) {
      for (const owner of task.owners) if (owner !== 'manual') task.owners.delete(owner)
      if (task.owners.size === 0) task.controller.abort()
    }
  }

  shutdown(): void {
    this.closed = true
    for (const task of this.tasks.values()) task.controller.abort()
  }
}
