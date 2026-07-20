import { describe, expect, it } from 'vitest'
import { buildModelScopePrompt, ModelScopeAgent } from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

describe('ModelScopeAgent', () => {
  it('anchors relative date ranges to the runtime date', () => {
    const prompt = buildModelScopePrompt({
      topic: '分析过去五年的中国乒乓球实力',
      nowIso: '2026-07-11T00:00:00.000Z'
    })

    expect(prompt).toContain('当前日期：2026-07-11')
    expect(prompt).toContain('相对时间范围必须以上述当前日期为基准')
  })

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

  it('does not let the model add preference questions to an already actionable request', async () => {
    const model = new FakeModelClient(JSON.stringify({
      understood: true,
      coreQuestionsConfirmed: false,
      readyForBrief: false,
      summary: '解释 HTTP 缓存验证机制。',
      mainContradiction: '在缓存效率与数据新鲜度之间取得平衡。',
      assumptions: [],
      clarificationQuestions: [{
        id: 'scope_depth',
        question: '希望采用什么技术深度？',
        why: '可以进一步调整篇幅。',
        options: ['基础', '深入'],
        required: true
      }]
    }))
    const agent = new ModelScopeAgent({ modelClient: model, model: 'fake-scope-model', timeoutMs: 1_000 })

    const scope = await agent.assess({
      topic: '仅基于 MDN 官方文档，解释 HTTP 缓存中强弱 ETag、freshness 与 validation、no-cache 与 no-store 的区别和协同机制；面向开发者和架构师，包含 API 与静态资源场景，输出完整中文报告，不补充其他来源',
      nowIso: '2026-07-12T00:00:00.000Z'
    })

    expect(scope.readyForBrief).toBe(true)
    expect(scope.coreQuestionsConfirmed).toBe(true)
    expect(scope.clarificationQuestions).toEqual([])
    expect(scope.mainContradiction).toContain('缓存效率与数据新鲜度')
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

  it('does not hide an explicitly unknown provider behind deterministic scope fallback', async () => {
    const model: ModelClient = {
      provider: 'compat-multi',
      model: 'fake-scope-model',
      stream: () => { throw new Error('unknown_provider_id: missing-provider') }
    }
    const agent = new ModelScopeAgent({ modelClient: model, model: 'fake-scope-model', timeoutMs: 1_000 })

    await expect(agent.assess({
      topic: '研究 HTTP 缓存验证机制',
      providerId: 'missing-provider',
      nowIso: '2026-07-12T00:00:00.000Z'
    })).rejects.toThrow('unknown_provider_id: missing-provider')
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
    expect(checklist).toContain('中美经济与贸易竞争中的结构性差异')
    expect(checklist).not.toContain('以下是用户在 scope 交互表单')
  })

  it('treats optional-only follow-up questions as non-blocking after user clarification', async () => {
    const model = new FakeModelClient(JSON.stringify({
      understood: true,
      coreQuestionsConfirmed: true,
      readyForBrief: false,
      summary: '用户已经选择中美经济与贸易、科技创新作为对比维度。',
      mainContradiction: '中美结构性差异如何影响未来趋势。',
      assumptions: ['未选择可选补充时使用默认时间边界。'],
      clarificationQuestions: [{
        id: 'scope_optional_boundary',
        question: '是否要额外限定时间范围？',
        why: '时间范围只用于细化报告边界，不应阻塞简报。',
        options: ['最近三年', '不限时间'],
        required: false
      }]
    }))
    const agent = new ModelScopeAgent({
      modelClient: model,
      model: 'fake-scope-model',
      timeoutMs: 1_000
    })

    const scope = await agent.assess({
      topic: '对比中美差异',
      clarifications: [{
        message: [
          '1. 您希望对比中美两国的哪个具体领域或维度？',
          '回答：经济与贸易；科技与创新',
          '',
          '未选择可选补充，使用默认边界继续。'
        ].join('\n')
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(scope.readyForBrief).toBe(true)
    expect(scope.coreQuestionsConfirmed).toBe(true)
    expect(scope.clarificationQuestions).toEqual([])
    expect(scope.confirmationChecklist.join('\n')).toContain('核心问题')
  })

  it('does not clear unanswered required questions after a partial structured answer', async () => {
    const model = new FakeModelClient(JSON.stringify({
      understood: true,
      coreQuestionsConfirmed: false,
      readyForBrief: false,
      summary: '用户只回答了调研对象，核心决策问题仍未确认。',
      mainContradiction: '还需要确认研究要支持的核心判断。',
      assumptions: [],
      clarificationQuestions: [{
        id: 'scope_decision',
        question: '这次研究最终要帮助你判断什么？',
        why: '没有核心判断就无法组织证据。',
        options: ['解释原因', '辅助选择'],
        required: true
      }]
    }))
    const agent = new ModelScopeAgent({ modelClient: model, model: 'fake-scope-model', timeoutMs: 1_000 })
    const pendingQuestions = [{
      id: 'scope_target',
      question: '你想调研的具体对象是什么？',
      why: '需要明确对象。',
      options: ['产品', '公司'],
      required: true
    }, {
      id: 'scope_decision',
      question: '这次研究最终要帮助你判断什么？',
      why: '需要明确核心判断。',
      options: ['解释原因', '辅助选择'],
      required: true
    }]

    const scope = await agent.assess({
      topic: '帮我研究一下',
      pendingQuestions,
      clarifications: [{ message: '1. 你想调研的具体对象是什么？\n回答：Cursor' }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(scope.readyForBrief).toBe(false)
    expect(scope.clarificationQuestions.map((question) => question.id)).toContain('scope_decision')
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
