const mutations = new Set<string>()
export function queueMutationPending(threadId: string | null | undefined): boolean {
  return Boolean(threadId && mutations.has(threadId))
}
export async function withQueueMutation<T>(threadId: string | null | undefined, fallback: T, action: () => Promise<T>): Promise<T> {
  if (!threadId) return action()
  if (mutations.has(threadId)) return fallback
  mutations.add(threadId)
  try { return await action() } finally { mutations.delete(threadId) }
}
