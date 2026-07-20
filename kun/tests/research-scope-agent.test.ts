import { describe, expect, it } from 'vitest'
import { ModelScopeAgent } from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

describe('ModelScopeAgent', () => {
  it('uses a short JSON model call to decide scope clarification', async () => {
    const model = new FakeModelClient(JSON.stringify({
      understood: false,
      coreQuestionsConfirmed: false,
      readyForBrief: false,
      summary: '用户只说想研究一下，还没有说明具体对象。',
      mainContradiction: '当前主要矛盾是调研对象和核心问题不明确。',
      assumptions: ['不会直接进入简报。'],
      clarificationQuestions: [{
        id: 'scope_target',
        question: '你想调研的具体对象是什么？',
        why: '没有对象就无法设计搜索路径和报告结构。',
        options: ['产品', '公司', '行业', '技术方案'],
        required: true
      }],
      confirmationChecklist: [
        '需求理解：还需确认调研对象。',
        '核心问题：还需确认用户真正想搞懂的问题。'
      ]
    }))
    const agent = new ModelScopeAgent({
      modelClient: model,
      model: 'fake-scope-model',
      timeoutMs: 1_000
    })

    const scope = await agent.assess({
      topic: '帮我研究一下',
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(model.requests).toHaveLength(1)
    const request = model.requests[0] as ModelRequest
    expect(request.tools).toEqual([])
    expect(request.responseFormat).toBe('json_object')
    expect(request.history[0]?.kind).toBe('user_message')
    expect(scope.assessmentSource).toBe('model')
    expect(scope.assessmentModel).toBe('fake-scope-model')
    expect(scope.readyForBrief).toBe(false)
    expect(scope.clarificationQuestions.map((question) => question.id)).toEqual(['scope_target'])
    expect(scope.confirmationChecklist.join('\n')).toContain('等待用户')
  })

  it('falls back to deterministic scope when the model response is unusable', async () => {
    const model = new FakeModelClient('not json')
    const agent = new ModelScopeAgent({
      modelClient: model,
      model: 'fake-scope-model',
      timeoutMs: 1_000
    })

    const scope = await agent.assess({
      topic: '帮我研究一下',
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(model.requests).toHaveLength(1)
    expect(scope.assessmentSource).toBe('deterministic_fallback')
    expect(scope.readyForBrief).toBe(false)
    expect(scope.clarificationQuestions.map((question) => question.id)).toContain('scope_target')
    expect(scope.confirmationChecklist.join('\n')).toContain('等待用户')
  })

  it('does not keep asking when the user already filled core scope fields', async () => {
    const model = new FakeModelClient(JSON.stringify({
      understood: true,
      coreQuestionsConfirmed: false,
      readyForBrief: false,
      summary: '用户希望深度分析中美近两年经济与贸易对比。',
      mainContradiction: '中美经济与贸易竞争中的结构性差异与动态博弈如何影响未来趋势。',
      assumptions: ['输出中文完整报告。'],
      clarificationQuestions: [{
        id: 'scope_target',
        question: '是否还要确认中国大陆还是大中华区？',
        why: '进一步收窄边界。',
        options: ['中国大陆 vs 美国', '大中华区 vs 美国'],
        required: true
      }]
    }))
    const agent = new ModelScopeAgent({
      modelClient: model,
      model: 'fake-scope-model',
      timeoutMs: 1_000
    })

    const scope = await agent.assess({
      topic: '深度分析中美对比',
      clarifications: [{
        message: [
          '领域：经济与贸易。',
          '核心问题：搞懂中美对比的核心矛盾，判断未来 2-5 年趋势。',
          '受众和输出：普通公众和内容创作者，输出完整中文报告。',
          '时间范围：最近 1-2 年，以 2023-2026 年公开资料为主。'
        ].join('\n')
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(scope.readyForBrief).toBe(true)
    expect(scope.coreQuestionsConfirmed).toBe(true)
    expect(scope.clarificationQuestions).toEqual([])
    const checklist = scope.confirmationChecklist.join('\n')
    expect(checklist).toContain('核心问题')
    expect(checklist).toContain('搞懂中美对比的核心矛盾')
    expect(checklist).not.toContain('以下是用户在 scope 交互表单')
  })
})

class FakeModelClient implements ModelClient {
  readonly provider = 'fake'
  readonly model = 'fake'
  readonly requests: ModelRequest[] = []

  constructor(private readonly responseText: string) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: this.responseText }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}
