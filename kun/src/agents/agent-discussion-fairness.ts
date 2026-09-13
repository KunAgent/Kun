/** User-directed work gets two admissions before a waiting peer gets one. No running turn is preempted. */
export class AgentDiscussionFairness {
  private readonly streaks = new Map<string, number>()
  private readonly direct = new Set<string>()
  private readonly peer = new Set<string>()
  resetWaiting() { this.direct.clear(); this.peer.clear() }
  waiting(agentId: string, priority: 'user' | 'peer') { (priority === 'user' ? this.direct : this.peer).add(agentId) }
  canStart(agentId: string, priority: 'user' | 'peer'): boolean {
    const streak = this.streaks.get(agentId) ?? 0
    return priority === 'user' ? streak < 2 || !this.peer.has(agentId) : streak >= 2 || !this.direct.has(agentId)
  }
  started(agentId: string, priority: 'user' | 'peer') {
    this.streaks.set(agentId, priority === 'user' ? Math.min(2, (this.streaks.get(agentId) ?? 0) + 1) : 0)
  }
}
