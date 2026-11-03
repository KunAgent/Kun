import type { ToolHostContext } from '../ports/tool-host.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { isBoundGmailSensitiveHistory } from './thread-data-state.js'
import { isGmailRestrictedToolContext, restrictGmailToolContext } from './tool-policy.js'

/** Host-owned storage, never a model/renderer supplied sensitivity or room identifier. */
export class GmailToolContextPolicy {
  constructor(private readonly threads?: ThreadStore) {}

  get requiresCanonicalLookup(): boolean { return Boolean(this.threads) }

  async apply(context?: ToolHostContext): Promise<ToolHostContext | undefined> {
    if (!context || isGmailRestrictedToolContext(context)) return context
    if (!this.threads) return context
    // Hydrate canonical items as well as sticky grants: legacy/imported Gmail results
    // may predate the classification store, and cannot trust caller-provided history.
    const thread = await this.threads.get(context.threadId)
    const history = thread?.turns.flatMap((turn) => turn.items) ?? []
    if (!await isBoundGmailSensitiveHistory(this.threads, context.threadId, history)) return context
    return restrictGmailToolContext(context)
  }
}
