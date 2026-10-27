import { AssistantHost, type AssistantSummary } from '@kun/assistant-agent'

/** Keeps at most one notification subscription for each assistant in the current account. */
export class AssistantLiveSubscriptions {
  private readonly subscriptions = new Map<string, { stop(): void; finished: Promise<void> }>()
  constructor(private readonly wake: () => void, private readonly warn: (error: unknown) => void) {}
  reconcile(host: AssistantHost, assistants: AssistantSummary[]): void {
    const allowed = new Set(assistants.map(assistant => assistant.id))
    for (const [id, subscription] of this.subscriptions) if (!allowed.has(id)) { subscription.stop(); this.subscriptions.delete(id) }
    for (const id of allowed) {
      if (this.subscriptions.has(id)) continue
      const subscription = host.subscribe(id, this.wake, { onReady: this.wake, onError: this.warn })
      this.subscriptions.set(id, subscription)
      void subscription.finished.catch(this.warn).finally(() => {
        if (this.subscriptions.get(id) === subscription) this.subscriptions.delete(id)
      })
    }
  }
  stop(): void {
    for (const subscription of this.subscriptions.values()) subscription.stop()
    this.subscriptions.clear()
  }
}
