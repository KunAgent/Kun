import { describe, expect, it } from 'vitest'
import {
  buildQualityJudgePrompt,
  ModelQualityJudge,
  parseQualityJudgeVerdict,
  resolveResearchBudget,
  type QualityJudgeInput
} from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

describe('ModelQualityJudge', () => {
  it('uses a JSON model call for requirement-alignment scoring', async () => {
    const model = new FakeModelClient(JSON.stringify({
      pass: true,
      scores: {
        requirementsAlignment: 0.91,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.88,
        reportCompleteness: 0.86,
        evidenceUse: 0.82,
        citationFaithfulness: 0.93,
        uncertaintyCalibration: 0.84,
        writingQuality: 0.89,
        overall: 0.88
      },
      rationale: '报告回应了已确认需求和核心研究主线。',
      blockingIssues: [],
      warnings: ['来源仍偏少。'],
      recommendedFixes: ['接入更多真实来源。']
    }))
    const judge = new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    })

    const verdict = await judge.judge(makeJudgeInput())

    expect(model.requests).toHaveLength(1)
    const request = model.requests[0] as ModelRequest
    expect(request.tools).toEqual([])
    expect(request.responseFormat).toBe('json_object')
    expect(request.reasoningEffort).toBe('off')
    expect(request.history[0]?.kind).toBe('user_message')
    expect(verdict.source).toBe('llm_judge')
    expect(verdict.model).toBe('fake-judge-model')
    expect(verdict.scores.requirementsAlignment).toBe(0.91)
    expect(verdict.scores.overall).toBe(0.88)
  })

  it('falls back when model judge output is invalid', async () => {
    const model = new FakeModelClient('not json')
    const judge = new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    })

    const verdict = await judge.judge(makeJudgeInput())

    expect(model.requests).toHaveLength(1)
    expect(verdict.source).toBe('heuristic_fallback')
    expect(verdict.warnings.join('\n')).toContain('LLM Judge')
  })

  it('does not allow heuristic fallback to pass deep preset reports', async () => {
    const model = new FakeModelClient('not json')
    const judge = new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    })

    const verdict = await judge.judge({
      ...makeJudgeInput(),
      budget: resolveResearchBudget({ reasoningEffort: 'max', maxWorkers: 1, maxRounds: 1, maxSources: 40, timeoutMs: 1_000 })
    })

    expect(verdict.source).toBe('heuristic_fallback')
    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('deep preset')
  })

  it('compacts judge prompts to cited evidence and a section-aware report slice', () => {
    const base = makeJudgeInput()
    const input: QualityJudgeInput = {
      ...base,
      budget: resolveResearchBudget({ reasoningEffort: 'max', maxSources: 80, timeoutMs: 1_000 }),
      reportMarkdown: [
        '# DeepResearch eval',
        '',
        '## 摘要',
        '',
        '短摘要。',
        '',
        '## 调研范围与方法',
        '',
        '短方法。',
        '',
        '## 主要发现',
        '',
        `${'主要发现需要被评估。<sup data-citation-id="cit_1"><a href="https://example.test/1" title="Source">[1]</a></sup>'.repeat(180)}`,
        '',
        '## 结论与建议',
        '',
        `${'结论与建议需要保留。'.repeat(120)}`,
        '',
        '## 局限与不确定性',
        '',
        `${'局限需要保留。'.repeat(120)}`,
        '',
        '## 后续研究建议',
        '',
        `${'后续建议需要保留。'.repeat(80)}`
      ].join('\n'),
      sources: Array.from({ length: 40 }, (_, index) => ({
        id: `source_${index + 1}`,
        sourceType: 'web' as const,
        title: index === 0 ? 'Useful Source' : `Skip to main content Toggle navigation noisy source ${index + 1}`,
        canonicalUrl: `https://example.test/${index + 1}`,
        accessedAt: '2026-06-29T00:00:00.000Z',
        importedAt: '2026-06-29T00:00:00.000Z',
        reliability: index === 0 ? 'high' as const : 'medium' as const,
        reliabilityReason: 'test',
        sourcePolicyTags: ['web_fetch'],
        fingerprint: `fp_${index + 1}`,
        status: 'fetched' as const
      })),
      evidenceSpans: Array.from({ length: 40 }, (_, index) => ({
        id: `span_${index + 1}`,
        sourceId: `source_${index + 1}`,
        text: index === 0
          ? 'A股通常采用T+1交易，美股交易机制更灵活。'
          : `Skip to main content Toggle navigation Main navigation noisy evidence ${index + 1}`,
        textHash: `hash_${index + 1}`,
        location: { url: `https://example.test/${index + 1}`, paragraphIndex: 1 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'rr_1'
      })),
      claims: Array.from({ length: 40 }, (_, index) => ({
        id: `claim_${index + 1}`,
        text: index === 0
          ? '交易规则：A股T+1与美股交易机制差异会影响配置。'
          : `Skip to main content Toggle navigation noisy claim ${index + 1}`,
        entities: ['A股', '美股'],
        claimType: 'fact' as const,
        supportSpanIds: [`span_${index + 1}`],
        confidence: 'medium' as const,
        critical: index === 0
      })),
      notes: Array.from({ length: 40 }, (_, index) => ({
        id: `note_${index + 1}`,
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: [`claim_${index + 1}`],
        summary: index === 0 ? '交易规则差异影响配置。' : `noisy note ${index + 1}`,
        implicationForBrief: index === 0 ? '交易规则差异应进入配置建议。' : `noisy implication ${index + 1}`,
        confidence: 'medium' as const,
        limitations: []
      })),
      citations: [{
        id: 'cit_1',
        reportPath: '/tmp/report.md',
        reportAnchor: 'claim:claim_1:1',
        reportClaimText: '主要发现需要被评估。',
        claimId: 'claim_1',
        evidenceSpanIds: ['span_1'],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }]
    }

    const prompt = buildQualityJudgePrompt(input)

    expect(prompt).toContain('[cit_1]')
    expect(prompt).toContain('交易规则：A股T+1')
    expect(prompt).toContain('Useful Source')
    expect(prompt).not.toContain('noisy claim 20')
    expect(prompt).not.toContain('noisy evidence 20')
    expect(prompt).not.toContain('data-citation-id=')
    expect(prompt.length).toBeLessThan(24_000)
  })

  it('normalizes parsed scores into the zero-to-one range', () => {
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: true,
      scores: {
        requirementsAlignment: 2,
        answersConfirmedScope: -1,
        followsResearchFrame: 0.5,
        reportCompleteness: '0.7',
        evidenceUse: 1,
        citationFaithfulness: 1,
        uncertaintyCalibration: 1,
        writingQuality: 1,
        overall: 1.5
      },
      rationale: 'ok'
    }), {
      source: 'llm_judge',
      model: 'fake',
      judgedAt: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.scores.requirementsAlignment).toBe(1)
    expect(verdict.scores.answersConfirmedScope).toBe(0)
    expect(verdict.scores.reportCompleteness).toBe(0.7)
    expect(verdict.scores.overall).toBe(1)
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

function makeJudgeInput(): QualityJudgeInput {
  return {
    scope: {
      understood: true,
      coreQuestionsConfirmed: true,
      readyForBrief: true,
      summary: '用户要验证报告流程。',
      mainContradiction: '报告必须围绕 confirmed brief 输出。',
      assumptions: ['中文完整报告。'],
      clarificationQuestions: [],
      confirmationChecklist: ['需求理解：验证报告流程。'],
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    brief: {
      id: 'brief_1',
      version: 1,
      topic: 'DeepResearch eval',
      userIntent: '验证报告是否符合需求。',
      outputFormat: 'Markdown report',
      sourcePolicy: { allowedSourceTypes: ['local_file'], requireCitations: true },
      successCriteria: ['输出完整报告。'],
      constraints: [],
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    frame: {
      coreResearchThread: '报告必须围绕 confirmed brief 输出。',
      centralQuestion: '报告是否符合需求？',
      coreQuestions: [{ id: 'q1', text: '是否符合需求？', priority: 'high', required: true }],
      investigationPath: ['写报告', '评分'],
      evidenceNeeded: ['引用'],
      disconfirmingEvidenceNeeded: ['偏离需求'],
      nonGoals: []
    },
    plan: {
      id: 'plan_1',
      runId: 'rr_1',
      rationale: 'test',
      tasks: [{
        id: 'task_1',
        questionIds: ['q1'],
        objective: 'test',
        expectedEvidence: ['引用'],
        sourceTypes: ['local_file'],
        searchHints: ['test'],
        maxSources: 1,
        priority: 'high',
        status: 'done'
      }],
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    budget: resolveResearchBudget({ reasoningEffort: 'medium', maxWorkers: 1, maxRounds: 1, maxSources: 1, timeoutMs: 1_000 }),
    reportMarkdown: '# DeepResearch eval\n\n## 摘要\n\n报告必须围绕 confirmed brief 输出。\n\n## 调研范围与方法\n\n说明范围和方法。\n\n## 主要发现\n\n- 是否符合需求？[^cit_1]\n\n## 结论与建议\n\n- pass\n\n## 局限与不确定性\n\n- limited\n',
    sources: [],
    notes: [],
    claims: [],
    evidenceSpans: [],
    citations: [],
    deterministicVerdict: {
      pass: true,
      scores: {
        requirementsAlignment: 1,
        answersCoreQuestions: 1,
        followsCoreResearchThread: 1,
        reportCompleteness: 1,
        citationAccuracy: 1,
        evidenceCoverage: 1,
        sourceQuality: 0.7,
        conflictHandling: 0.7,
        uncertaintyCalibration: 1,
        writingQuality: 0.7,
        llmJudgeOverall: 0
      },
      blockingIssues: [],
      warnings: [],
      recommendedFixes: [],
      issues: [],
      verifiedAt: '2026-06-29T00:00:00.000Z'
    },
    nowIso: '2026-06-29T00:00:01.000Z'
  }
}
