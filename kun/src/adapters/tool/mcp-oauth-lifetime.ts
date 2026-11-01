export class McpOAuthLifetime {
  private readonly controller = new AbortController()
  private readonly writes = new Set<Promise<unknown>>()

  get signal(): AbortSignal { return this.controller.signal }

  track<T>(operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    const promise = operation()
    this.writes.add(promise)
    void promise.finally(() => this.writes.delete(promise)).catch(() => undefined)
    return promise
  }

  async close(): Promise<void> {
    this.controller.abort()
    await Promise.allSettled([...this.writes])
  }
}
