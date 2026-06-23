import { describe, it, expect } from 'vitest'
import {
  estimateComplexity,
  isLowComplexity,
  classifyTier,
  COMPLEXITY_THRESHOLDS,
} from '../src/loop/router/complexity-estimator.js'
import { RoutingHistory, computeOverallQuality } from '../src/loop/router/routing-history.js'

describe('ComplexityEstimator', () => {
  it('scores simple queries as low complexity', () => {
    const result = estimateComplexity('hello')
    expect(result.tier).toBe('low')
    expect(result.score).toBeLessThanOrEqual(30)
  })

  it('scores simple questions as low complexity', () => {
    const result = estimateComplexity('现在几点')
    expect(result.tier).toBe('low')
  })

  it('scores complex coding tasks as high complexity', () => {
    const input = '实现一个OAuth 2.0中间件，需要支持JWT token验证和refresh token机制，考虑并发安全和数据库连接池'
    const result = estimateComplexity(input)
    expect(result.tier).toBe('high')
  })

  it('scores multi-step reasoning tasks appropriately', () => {
    const input = '分析这个分布式系统的性能瓶颈，比较不同的优化方案，评估各自的trade-off'
    const result = estimateComplexity(input)
    expect(result.score).toBeGreaterThan(30)
  })

  it('returns dimensions with signals', () => {
    const result = estimateComplexity('write a function to implement a binary search algorithm')
    expect(result.dimensions.length).toBe(5)
    expect(result.dimensions.some((d) => d.dimension === 'code_generation')).toBe(true)
    expect(result.dimensions.some((d) => d.dimension === 'multi_step_reasoning')).toBe(true)
  })

  it('completes in under 500ms', () => {
    const result = estimateComplexity('a'.repeat(10000))
    expect(result.durationMs).toBeLessThan(500)
  })

  it('classifies tiers correctly', () => {
    expect(classifyTier(0)).toBe('low')
    expect(classifyTier(30)).toBe('low')
    expect(classifyTier(31)).toBe('medium')
    expect(classifyTier(70)).toBe('medium')
    expect(classifyTier(71)).toBe('high')
    expect(classifyTier(100)).toBe('high')
  })

  it('isLowComplexity returns true for simple input', () => {
    expect(isLowComplexity('hi')).toBe(true)
    expect(isLowComplexity('实现一个微服务架构的分布式事务系统，要求支持SAGA和TCC两种模式')).toBe(false)
  })

  it('has correct threshold constants', () => {
    expect(COMPLEXITY_THRESHOLDS.lowMax).toBe(30)
    expect(COMPLEXITY_THRESHOLDS.mediumMax).toBe(70)
  })
})

describe('RoutingHistory', () => {
  it('records routing decisions', () => {
    const history = new RoutingHistory()
    const assessment = estimateComplexity('test query')

    const decision = history.record({
      threadId: 't1', turnId: 'turn1', requestText: 'test query',
      complexity: assessment, tier: assessment.tier,
      selected: { model: 'deepseek-v4-flash' }, reason: 'low complexity task',
      source: 'complexity-estimator',
    })

    expect(decision.id).toBe(1)
    expect(decision.tier).toBe('low')
    expect(decision.requestSummary).toBe('test query')
  })

  it('supports finish and quality recording', () => {
    const history = new RoutingHistory()
    const assessment = estimateComplexity('implement OAuth middleware')

    const decision = history.record({
      threadId: 't1', turnId: 'turn1', requestText: 'implement OAuth middleware',
      complexity: assessment, tier: assessment.tier,
      selected: { model: 'deepseek-v4-pro' }, reason: 'complex coding task',
      source: 'complexity-estimator',
    })

    history.finish(decision)
    const quality = computeOverallQuality({ requirementCompletion: 8, outputQuality: 9, reasoningDepth: 7 })
    history.recordQuality(decision, quality)

    expect(decision.completedAt).toBeTruthy()
    expect(decision.quality?.overall).toBe(8)
  })

  it('returns snapshot in reverse order', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    history.record({ threadId: 't1', turnId: 't1', requestText: 'a', complexity: a, tier: a.tier, selected: { model: 'm1' }, reason: 'r', source: 'complexity-estimator' })
    history.record({ threadId: 't1', turnId: 't2', requestText: 'b', complexity: a, tier: a.tier, selected: { model: 'm2' }, reason: 'r', source: 'complexity-estimator' })

    const snapshot = history.snapshot()
    expect(snapshot.length).toBe(2)
    expect(snapshot[0]!.turnId).toBe('t2')
    expect(snapshot[1]!.turnId).toBe('t1')
  })

  it('finds decisions by turn', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    history.record({ threadId: 't1', turnId: 'turn_a', requestText: 'a', complexity: a, tier: a.tier, selected: { model: 'm' }, reason: 'r', source: 'complexity-estimator' })
    history.record({ threadId: 't1', turnId: 'turn_b', requestText: 'b', complexity: a, tier: a.tier, selected: { model: 'm' }, reason: 'r', source: 'complexity-estimator' })

    const found = history.findByTurn('t1', 'turn_b')
    expect(found?.requestSummary).toBe('b')
  })

  it('enforces capacity limit', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')

    for (let i = 0; i < 150; i++) {
      history.record({ threadId: 't1', turnId: `t${i}`, requestText: `req${i}`, complexity: a, tier: a.tier, selected: { model: 'm' }, reason: 'r', source: 'complexity-estimator' })
    }

    expect(history.snapshot().length).toBeLessThanOrEqual(100)
  })

  it('clears all history', () => {
    const history = new RoutingHistory()
    const a = estimateComplexity('a')
    history.record({ threadId: 't1', turnId: 't1', requestText: 'a', complexity: a, tier: a.tier, selected: { model: 'm' }, reason: 'r', source: 'complexity-estimator' })
    history.clear()
    expect(history.snapshot()).toEqual([])
  })
})

describe('computeOverallQuality', () => {
  it('computes average correctly', () => {
    const result = computeOverallQuality({ requirementCompletion: 8, outputQuality: 9, reasoningDepth: 7 })
    expect(result.overall).toBe(8)
    expect(result.requirementCompletion).toBe(8)
    expect(result.outputQuality).toBe(9)
    expect(result.reasoningDepth).toBe(7)
  })
})
