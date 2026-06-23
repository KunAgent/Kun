/**
 * RoutingHistory — in-memory ring buffer recording every routing decision
 * plus post-task quality self-assessment.
 *
 * Addresses GitHub Issue #364 (routing strategy observability).
 */

import type { ComplexityAssessment, ComplexityTier } from './complexity-estimator.js'

export type RoutingModelSelection = {
  model: string
  providerId?: string
  reasoningEffort?: string
}

export type QualityScores = {
  requirementCompletion: number
  outputQuality: number
  reasoningDepth: number
  overall: number
}

export type RoutingDecision = {
  id: number
  threadId: string
  turnId: string
  requestSummary: string
  complexity: ComplexityAssessment
  tier: ComplexityTier
  selected: RoutingModelSelection
  reason: string
  routedAt: string
  completedAt?: string
  durationMs?: number
  quality?: QualityScores
  source: 'complexity-estimator' | 'heuristic-fallback' | 'fixed-model'
}

const CAPACITY = 100

export class RoutingHistory {
  private readonly decisions: RoutingDecision[] = []
  private nextId = 1

  record(input: {
    threadId: string; turnId: string; requestText: string
    complexity: ComplexityAssessment; tier: ComplexityTier
    selected: RoutingModelSelection; reason: string; source: RoutingDecision['source']
  }): RoutingDecision {
    const decision: RoutingDecision = {
      id: this.nextId++, threadId: input.threadId, turnId: input.turnId,
      requestSummary: input.requestText.slice(0, 120), complexity: input.complexity,
      tier: input.tier, selected: input.selected, reason: input.reason,
      routedAt: new Date().toISOString(), source: input.source,
    }
    this.decisions.push(decision)
    while (this.decisions.length > CAPACITY) this.decisions.shift()
    return decision
  }

  finish(decision: RoutingDecision): void {
    decision.completedAt = new Date().toISOString()
    decision.durationMs = Date.now() - decision.complexity.assessedAt
  }

  recordQuality(decision: RoutingDecision, quality: QualityScores): void {
    decision.quality = quality
  }

  snapshot(): RoutingDecision[] { return [...this.decisions].reverse() }

  findByTurn(threadId: string, turnId: string): RoutingDecision | undefined {
    for (let i = this.decisions.length - 1; i >= 0; i--) {
      const d = this.decisions[i]
      if (d && d.threadId === threadId && d.turnId === turnId) return d
    }
    return undefined
  }

  clear(): void { this.decisions.length = 0 }
}

export function computeOverallQuality(scores: Omit<QualityScores, 'overall'>): QualityScores {
  const overall = Math.round(((scores.requirementCompletion + scores.outputQuality + scores.reasoningDepth) / 3) * 10) / 10
  return { ...scores, overall }
}
