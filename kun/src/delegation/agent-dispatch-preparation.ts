/** Validation rejected an edit before any dispatch transaction or ledger entry was written. */
export class AgentDispatchPreparationError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Dispatch edit validation failed', { cause })
    this.name = 'AgentDispatchPreparationError'
  }
}
