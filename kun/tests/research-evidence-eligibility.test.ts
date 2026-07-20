import { describe, expect, it } from 'vitest'
import {
  BasicCoverageEvaluator,
  ScopeFrameMappingError,
  buildResearchFrame,
  hashText,
  resolveResearchBudget,
  type AtomicClaim,
  type EvidenceSpan,
  type ResearchBrief,
  type ResearchFrame,
  type ResearchNote,
  type ResearchScopeAssessment,
  type SourceRecord
} from '../src/research/index.js'

describe('research frame mapping and evidence eligibility', () => {
  it('does not map scope clarification prompts into central questions', () => {
    const scope = makeChinaUsScope()
    const frame = buildResearchFrame({
      topic: '调研中美经济差异',
      scope,
      userClarifications: [
        [
          '领域：宏观经济总量、产业结构与竞争力、贸易与供应链、科技创新与数字经济。',
          '用途：投资或商业决策。',
          '核心是综合实力对比和特定领域差距。'
        ].join('\n')
      ]
    })

    expect(frame.centralQuestion).toBe('中美综合经济实力谁更强？主要领域差距、优势与商业/投资启示是什么？')
    expect(frame.centralQuestion).not.toContain('您是否')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('宏观经济总量与增速')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('产业结构与竞争力')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('贸易与供应链')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('科技创新与数字经济')
  })

  it('throws when an override tries to put a clarification prompt into the frame', () => {
    expect(() => buildResearchFrame({
      topic: '调研中美经济差异',
      scope: makeChinaUsScope(),
      overrides: {
        centralQuestion: '4. 您是否有特定的比较角度或核心问题？请说明。'
      }
    })).toThrow(ScopeFrameMappingError)
  })

  it('does not count fallback extracted web cards as strong evidence coverage', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const source = makeWebSource('source_fallback', ['web_fetch', 'strong_web_evidence', 'fallback_extracted', 'fallback_structured'])
    const span: EvidenceSpan = {
      id: 'span_fallback',
      sourceId: source.id,
      text: '网页来源已抓取，但模型未能抽取结构化证据：This operation was aborted。最终报告应避免从该片段过度推断。',
      textHash: hashText('span_fallback'),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_eligibility'
    }
    const claim: AtomicClaim = {
      id: 'claim_fallback',
      text: '抽取失败页面不能支撑关键结论。',
      entities: ['中美经济'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'medium',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_fallback',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: '兜底资料卡不应算作强证据。',
      implicationForBrief: '需要重新搜索或修复抽取。',
      confidence: 'medium',
      limitations: ['抽取失败。']
    }

    const verdict = await evaluator.evaluate({
      runId: 'rr_eligibility',
      brief: makeBrief(),
      frame: makeFrame(),
      plan: {
        id: 'plan_eligibility',
        runId: 'rr_eligibility',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        maxSources: 6,
        targetSources: 6,
        maxResearchRounds: 2,
        maxSubagents: 2
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.coverageMatrix.strongWebSourceCount).toBe(0)
    expect(verdict.coverageByQuestion[0]?.strongWebSourceCount).toBe(0)
    expect(verdict.missingEvidence.join('\n')).toContain('真实网页来源数 0')
    expect(verdict.followUpTasks.length).toBeGreaterThan(0)
  })
})

function makeChinaUsScope(): ResearchScopeAssessment {
  return {
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    assessmentSource: 'model',
    assessmentModel: 'fake-scope',
    summary: '用户真实确认了中美经济差异的多维对比和投资/商业决策用途。',
    mainContradiction: '需要判断中美综合经济实力差异，并识别最能影响商业和投资判断的领域差距。',
    assumptions: ['输出中文完整报告。'],
    clarificationQuestions: [],
    confirmationChecklist: [
      '需求理解：围绕中美经济差异生成报告。',
      '核心问题：4. 您是否有特定的比较角度或核心问题？例如，是想了解中国在哪些领域已超越美国，还是分析两国经济脱钩风险？'
    ],
    createdAt: '2026-07-07T00:00:00.000Z'
  }
}

function makeBrief(): ResearchBrief {
  return {
    id: 'brief_eligibility',
    version: 1,
    topic: '调研中美经济差异',
    userIntent: '比较中美经济综合实力和关键领域差距。',
    outputFormat: '中文完整报告',
    sourcePolicy: {
      allowedSourceTypes: ['web'],
      minSourceCount: 2,
      maxSourceCount: 6,
      requireCitations: true
    },
    successCriteria: ['覆盖关键维度并引用真实网页证据。'],
    constraints: [],
    createdAt: '2026-07-07T00:00:00.000Z'
  }
}

function makeFrame(): ResearchFrame {
  return {
    coreResearchThread: '判断中美经济综合实力差异，并识别最能改变商业和投资判断的证据。',
    centralQuestion: '中美综合经济实力谁更强？主要领域差距、优势与商业/投资启示是什么？',
    coreQuestions: [{
      id: 'q1',
      text: '在宏观经济总量与产业结构维度上，中美关键差距是什么？',
      priority: 'high',
      required: true
    }],
    investigationPath: ['搜索', '抽取', '校验'],
    evidenceNeeded: ['真实网页证据。'],
    disconfirmingEvidenceNeeded: ['反例和口径限制。'],
    nonGoals: ['不使用模型 fallback 作为强证据。']
  }
}

function makeWebSource(id: string, tags: string[]): SourceRecord {
  return {
    id,
    sourceType: 'web',
    title: 'Fallback extracted source',
    canonicalUrl: 'https://example.test/fallback',
    accessedAt: '2026-07-07T00:00:00.000Z',
    importedAt: '2026-07-07T00:00:00.000Z',
    reliability: 'high',
    reliabilityReason: 'test',
    sourcePolicyTags: tags,
    fingerprint: hashText(id),
    status: 'fetched',
    kind: 'web_strong'
  }
}
