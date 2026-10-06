/** Logical forgetting has committed, but remaining local projections must be retried. */
export class MemoryErasureIncompleteError extends Error {
  constructor(cause?: unknown) {
    super('Memory is hidden, but erasing local projections is incomplete. Retry after the storage lock is released or restart Kun.', { cause })
    this.name = 'MemoryErasureIncompleteError'
  }
}
