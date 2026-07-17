export function randomCommandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function humanTaskActions(status: string): string[] {
  const actions: Record<string, string[]> = {
    proposed: ['accept', 'decline'], accepted: ['start'], in_progress: ['submit'],
    review: ['request_revision', 'complete', 'waive'], revision_requested: ['start']
  }
  return actions[status] ?? []
}
