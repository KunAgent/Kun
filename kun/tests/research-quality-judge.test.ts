import { describe, expect, it } from 'vitest'
import {
  buildQualityJudgePrompt,
  HeuristicQualityJudge,
  mergeQualityVerdictWithJudge,
  ModelQualityJudge,
  parseQualityJudgeVerdict,
  reconcileJudgeVerdictWithArgumentAudit,
  resolveResearchBudget,
  type QualityJudgeInput
} from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

describe('ModelQualityJudge', () => {
  it('fails closed when standard mode is wired without a model judge', async () => {
    const verdict = await new HeuristicQualityJudge().judge({
      ...makeJudgeInput(),
      budget: resolveResearchBudget({ preset: 'standard' })
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.failureKind).toBe('judge_unavailable')
    expect(verdict.blockingIssues.join('\n')).toContain('未配置可用的 LLM Judge')
  })

  it('accepts an explicit evidence-gap non-answer after deterministic verification passes', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.frame = {
      ...input.frame,
      coreQuestions: [{ id: 'q_cost', text: '在「过去五年成本变化」维度上，成本如何变化？', priority: 'high', required: true }]
    }
    input.reportBlueprint = {
      reportType: 'investigation',
      title: '成本变化研究',
      directAnswer: '现有材料不足以形成可靠趋势结论。',
      thesis: '现有材料不足以形成可靠趋势结论。',
      sections: [{
        id: 'cost',
        title: '过去五年成本变化',
        purpose: '回答已确认的成本变化问题。',
        questionIds: ['q_cost'],
        claimIds: [],
        evidenceMode: 'evidence_gap',
        sourceIds: [],
        argument: {
          conclusion: '现有材料不足以形成可靠趋势结论。',
          claimIds: [],
          inference: '不得用背景材料替代趋势证据。',
          conditions: ['缺少时间范围和口径一致的可比证据。'],
          counterClaimIds: []
        },
        limitations: ['缺少时间范围和口径一致的可比证据。']
      }],
      createdAt: input.nowIso
    }
    input.reportMarkdown = [
      '# 成本变化研究',
      '',
      '## 摘要',
      '',
      '现有材料不足以形成可靠趋势结论。',
      '',
      '## 主要发现',
      '',
      '### 过去五年成本变化',
      '',
      '现有可引用材料不足以对“过去五年成本变化”形成可靠结论。本报告不把相关背景、单一案例或时间范围不匹配的材料外推为该问题的答案。',
      '',
      '本次补研没有形成能直接回答该问题的新增证据，因此不能据此判断总体变化方向。',
      '',
      '## 结论',
      '',
      '当前只能保留结论，不能以不匹配的数据替代。',
      '',
      '## 局限与不确定性',
      '',
      '缺少时间范围一致的序列。缺少口径一致的可比指标。'
    ].join('\n')
    const verdict = {
      source: 'llm_judge' as const,
      model: 'fake-judge',
      pass: false,
      failureKind: 'report_quality' as const,
      scores: {
        requirementsAlignment: 0.7,
        answersConfirmedScope: 0.6,
        followsResearchFrame: 0.7,
        reportCompleteness: 0.5,
        evidenceUse: 0.5,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.8,
        overall: 0.55
      },
      rationale: 'The cost section lacks data.',
      issues: [
        {
          code: 'missing_cost_data',
          category: 'evidence' as const,
          message: '成本变化章节未提供具体数据。',
          severity: 'blocking' as const,
          unsupportedFragment: '现有可引用材料不足以对“过去五年成本变化”形成可靠结论。'
        },
        {
          code: 'overall_score_below_threshold',
          category: 'coverage' as const,
          message: 'LLM Judge 总分低于通过线。',
          severity: 'blocking' as const
        }
      ],
      blockingIssues: ['成本变化章节未提供具体数据。', 'LLM Judge 总分低于通过线。'],
      warnings: [],
      recommendedFixes: ['继续寻找相同数据。'],
      judgedAt: input.nowIso
    }

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('bounded non-answer')
  })

  it('does not let an evidence-gap section disable the single-section recap safeguard', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.reportBlueprint = {
      reportType: 'investigation',
      title: '受限研究',
      directAnswer: '一项问题可回答，另一项证据不足。',
      thesis: '结论受证据边界限制。',
      sections: [{
        id: 'gap', title: '历史变化', purpose: '回答历史变化。', questionIds: ['q_gap'], claimIds: [],
        evidenceMode: 'evidence_gap', sourceIds: [],
        argument: { conclusion: '证据不足。', claimIds: [], inference: '不得外推。', conditions: [], counterClaimIds: [] },
        limitations: ['缺少直接证据。']
      }, {
        id: 'risk', title: '主要风险', purpose: '回答主要风险。', questionIds: ['q_risk'], claimIds: ['claim_1'],
        evidenceMode: 'direct', sourceIds: ['source_1'],
        argument: { conclusion: '存在局部风险。', claimIds: ['claim_1'], inference: '只能形成局部判断。', conditions: [], counterClaimIds: [] },
        limitations: ['未覆盖更大范围。']
      }],
      createdAt: input.nowIso
    }
    input.reportMarkdown = [
      '# 受限研究',
      '## 摘要',
      '局部对象受到影响 [1]。',
      '## 主要发现',
      '### 历史变化',
      '现有可引用材料不足以直接回答“历史变化”，因此无法形成可靠结论。',
      '现有材料没有覆盖直接事实与适用范围，不能用背景材料替代，也不能据此外推总体方向。',
      '### 主要风险',
      '局部对象受到影响 [1]。',
      '由此判断，该结论只适用于已观察对象 [1]。',
      '现有证据未覆盖更大范围，因此不能据此外推。',
      '## 结论',
      '局部对象受到影响 [1]。',
      '## 局限与不确定性',
      '现有证据未覆盖更大范围。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.7, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.6
      },
      rationale: '结论概括正文。',
      issues: [{
        code: 'redundant_content', category: 'writing', severity: 'blocking',
        message: '结论部分重复摘要和主要发现中的句子，无新增分析价值。',
        unsupportedFragment: '局部对象受到影响 [1]。'
      }],
      blockingIssues: ['结论部分重复摘要和主要发现中的句子，无新增分析价值。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.warnings.join('\n')).toContain('summary and conclusion recaps')
  })

  it('rejects a stale quoted writing fragment and accepts the current bounded evidence-gap answer', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.reportBlueprint = {
      reportType: 'investigation', title: '历史变化', directAnswer: '证据不足。', thesis: '不得外推。',
      sections: [{
        id: 'gap', title: '历史变化', purpose: '回答历史变化。', questionIds: ['q_gap'], claimIds: [],
        evidenceMode: 'evidence_gap', sourceIds: [],
        argument: { conclusion: '证据不足。', claimIds: [], inference: '不得外推。', conditions: [], counterClaimIds: [] },
        limitations: ['缺少直接证据。']
      }],
      createdAt: input.nowIso
    }
    input.reportMarkdown = [
      '# 历史变化', '## 主要发现', '### 历史变化',
      '现有可引用材料不足以直接回答“历史变化”，因此无法形成可靠结论。',
      '现有材料没有覆盖直接事实与适用范围，不能用背景材料替代，也不能据此外推总体方向。',
      '## 结论', '当前不能形成可靠结论。', '## 局限与不确定性', '缺少直接证据。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.8, answersConfirmedScope: 0.5, followsResearchFrame: 0.7,
        reportCompleteness: 0.5, evidenceUse: 0.5, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.5
      },
      rationale: '沿用了上一稿问题。',
      issues: [{
        code: 'scope_gap', category: 'scope', severity: 'blocking',
        message: '历史变化章节无实质内容，未回答核心问题。',
        unsupportedFragment: '现有可引用材料不足以直接回答“历史变化”，因此无法形成可靠结论。'
      }, {
        code: 'writing_quality', category: 'writing', severity: 'blocking',
        message: '结论包含上一稿的病句。',
        unsupportedFragment: '综合来看，旧稿中两个不相关事实被与此同时强行粘连。'
      }],
      blockingIssues: ['历史变化章节无实质内容，未回答核心问题。', '结论包含上一稿的病句。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.warnings.join('\n')).toContain('bounded non-answer')
    expect(reconciled.warnings.join('\n')).toContain('quoted fragment is absent')
  })

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
    expect(request.systemPrompt).toContain('报告完整度不能只按标题、篇幅或引用数量判断')
    expect(request.systemPrompt).toContain('“简洁”只允许删除重复和空话')
    expect(request.systemPrompt).toContain('同一 displayId 表示同一 canonical 来源')
    expect(request.systemPrompt).toContain('必须按 occurrence 的完整证据包核验')
    expect(request.systemPrompt).toContain('不得自行发明“至少三篇”')
    expect(request.systemPrompt).toContain('不得把由句号、分号或 Markdown 分段明确分开的相邻句子误报')
    expect(request.systemPrompt).toContain('不得把证据中没有明确主体')
    expect(request.systemPrompt).not.toContain('bfcache、CDN、文件哈希')
    expect(verdict.source).toBe('llm_judge')
    expect(verdict.model).toBe('fake-judge-model')
    expect(verdict.scores.requirementsAlignment).toBe(0.91)
    expect(verdict.scores.overall).toBe(0.88)
  })

  it('includes the previous failed verdict when judging a repaired report', () => {
    const input = makeJudgeInput()
    input.previousVerdict = {
      ...input.deterministicVerdict,
      pass: false,
      blockingIssues: ['竞争地位章节仍缺少可核验对比。'],
      recommendedFixes: ['补充对比证据。'],
      llmJudge: {
        source: 'llm_judge',
        model: 'fake-judge-model',
        pass: false,
        scores: {
          requirementsAlignment: 1,
          answersConfirmedScope: 1,
          followsResearchFrame: 1,
          reportCompleteness: 0.6,
          evidenceUse: 0.7,
          citationFaithfulness: 0.9,
          uncertaintyCalibration: 0.8,
          writingQuality: 0.6,
          overall: 0.7
        },
        rationale: '章节不完整。',
        issues: [{
          code: 'incomplete_analysis',
          category: 'coverage',
          message: '竞争地位章节仍缺少可核验对比。',
          severity: 'blocking',
          unsupportedFragment: '现有证据未涉及具体竞争对手。'
        }],
        blockingIssues: ['竞争地位章节仍缺少可核验对比。'],
        warnings: [],
        recommendedFixes: ['补充对比证据。'],
        judgedAt: input.nowIso
      }
    }

    const prompt = buildQualityJudgePrompt(input)

    expect(prompt).toContain('上一轮未通过项')
    expect(prompt).toContain('竞争地位章节仍缺少可核验对比')
    expect(prompt).toContain('现有证据未涉及具体竞争对手')
  })

  it('fails when structured issues contain a blocking finding even if pass is true', () => {
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: true,
      scores: {
        requirementsAlignment: 0.95,
        answersConfirmedScope: 0.95,
        followsResearchFrame: 0.95,
        reportCompleteness: 0.95,
        evidenceUse: 0.95,
        citationFaithfulness: 0.95,
        uncertaintyCalibration: 0.95,
        writingQuality: 0.95,
        overall: 0.95
      },
      rationale: '正文存在大面积重复。',
      issues: [{
        code: 'section_repetition',
        category: 'writing',
        message: '章节大面积重复。',
        severity: 'blocking'
      }],
      blockingIssues: [],
      warnings: [],
      recommendedFixes: []
    }), {
      source: 'llm_judge',
      model: 'fake-judge-model',
      judgedAt: '2026-07-12T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues).toContain('章节大面积重复。')
  })

  it('rejects a global Judge synthesis claim that contradicts the deterministic section audit', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# HTTP cache',
      '## 主要发现',
      '### ETag',
      '弱 ETag 使用 W/ 前缀 [1]。',
      '',
      '强 ETag 与弱 ETag 的比较语义不同 [2]。',
      '',
      '因此，两类验证器不能在需要相同比较语义的条件下互相替代 [1][2]。',
      '',
      '现有证据未覆盖验证器的生成实现，因此不能据此外推。',
      '## 结论',
      '两类验证器受不同证据条件约束 [1][2]。',
      '## 局限与不确定性',
      '现有证据未覆盖生成实现。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.5, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.6
      },
      rationale: '所有章节都没有综合。',
      issues: [{
        code: 'no_evidence_synthesis', category: 'coverage', severity: 'blocking',
        message: '所有核心章节均无证据综合。', unsupportedFragment: '整个报告的主要发现部分'
      }],
      blockingIssues: ['所有核心章节均无证据综合。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.scores.overall).toBeGreaterThanOrEqual(0.65)
    expect(reconciled.warnings.join('\n')).toContain('与章节审计矛盾')
  })

  it('does not let a deterministic structure audit erase deep quality score failures', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'deep' })
    input.reportMarkdown = [
      '# HTTP cache',
      '## 主要发现',
      '### ETag',
      '弱 ETag 使用 W/ 前缀 [1]。',
      '',
      '强 ETag 与弱 ETag 的比较语义不同 [2]。',
      '',
      '因此，两类验证器不能在需要相同比较语义的条件下互相替代 [1][2]。',
      '',
      '现有证据未覆盖验证器的生成实现，因此不能据此外推。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: true,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.7, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.65, overall: 0.75
      },
      rationale: '章节过短，未达到 deep 深度。',
      issues: [{
        code: 'no_evidence_synthesis', category: 'coverage', severity: 'blocking',
        message: '所有核心章节均无证据综合。', unsupportedFragment: '整个报告的主要发现部分'
      }],
      blockingIssues: ['所有核心章节均无证据综合。'],
      warnings: [], recommendedFixes: ['扩展每个核心章节。']
    }), { source: 'llm_judge', model: 'fake', preset: 'deep', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(false)
    expect(reconciled.blockingIssues.join('\n')).toContain('写作与结论质量评分 0.65 低于通过线 0.75')
    expect(reconciled.blockingIssues.join('\n')).toContain('报告完整度评分 0.70 低于通过线 0.75')
    expect(reconciled.warnings.join('\n')).toContain('与章节审计矛盾')
  })

  it('does not treat a summary and conclusion recap as blocking whole-report repetition', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# HTTP cache',
      '## 摘要',
      '弱 ETag 使用 W/ 前缀 [1]。',
      '## 主要发现',
      '### ETag',
      '弱 ETag 使用 W/ 前缀 [1]。',
      '',
      '强 ETag 使用另一种比较语义 [2]。',
      '',
      '因此，两类验证器的比较行为不同 [1][2]。',
      '',
      '现有证据未覆盖生成实现，因此不能据此外推。',
      '## 结论',
      '弱 ETag 使用 W/ 前缀 [1]。',
      '',
      '因此，两类验证器的比较行为不同 [1][2]。',
      '## 局限与不确定性',
      '现有证据未覆盖生成实现。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.5, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.6, overall: 0.7
      },
      rationale: '报告存在大量重复。',
      issues: [{
        code: 'writing_quality', category: 'writing', severity: 'blocking',
        message: '报告存在大量重复和机械拼接，如结论部分重复摘要内容。',
        unsupportedFragment: '弱 ETag 使用 W/ 前缀 [1]。'
      }],
      blockingIssues: ['报告存在大量重复和机械拼接，如结论部分重复摘要内容。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('summary and conclusion recaps')
  })

  it('does not treat a summary recap of one findings section as blocking repetition', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# 研究报告',
      '## 摘要',
      '由此判断，已观察指标需要结合证据边界解释 [1][2]。',
      '## 主要发现',
      '### 核心判断',
      '第一项指标在报告期内上升 [1]。',
      '',
      '第二项指标在报告期内下降 [2]。',
      '',
      '由此判断，已观察指标需要结合证据边界解释 [1][2]。',
      '',
      '现有证据仅覆盖上述两个指标，未覆盖更长时间范围。',
      '## 结论',
      '当前只能形成受限判断 [1][2]。',
      '## 局限与不确定性',
      '现有证据未覆盖更长时间范围。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.7, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.6
      },
      rationale: '摘要与主要发现重复。',
      issues: [{
        code: 'writing_repetition', category: 'writing', severity: 'blocking',
        message: '摘要与主要发现中重复同一事实，无新增分析。',
        unsupportedFragment: '由此判断，已观察指标需要结合证据边界解释 [1][2]。'
      }],
      blockingIssues: ['摘要与主要发现中重复同一事实，无新增分析。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('summary and conclusion recaps')
  })

  it('drops a previous repetition issue whose labeled summary fragment is absent from the current report', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# 公司研究',
      '## 摘要',
      '当前摘要只保留资产负债率判断 [1]。',
      '## 主要发现',
      '### 财务健康',
      '资产负债率从22.0%升至26.8% [1]。',
      '',
      '营收和利润同期增长 [2]。',
      '',
      '因此，杠杆变化和经营增长需要结合判断 [1][2]。',
      '',
      '现有证据未覆盖现金流，不能据此外推偿债安全边际。',
      '## 结论',
      '公司营收增长，但判断仍受现金流证据缺口限制 [2]。',
      '## 局限与不确定性',
      '现有证据未覆盖现金流。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.9, followsResearchFrame: 0.9,
        reportCompleteness: 0.9, evidenceUse: 0.9, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9, writingQuality: 0.9, overall: 0.9
      },
      rationale: '沿用了上一轮重复问题。',
      issues: [{
        code: 'writing_repetition', category: 'writing', severity: 'blocking',
        message: '摘要和结论中重复出现相同的营收数据。',
        unsupportedFragment: '摘要：2025年营收371.2亿元。结论：2025年营收371.2亿元。'
      }],
      blockingIssues: ['摘要和结论中重复出现相同的营收数据。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('no longer present')
  })

  it('rejects standard Judge claims that a quoted synthesis and boundary do not exist', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    const synthesis = '因此，新产品收入增长率高于成熟产品，但两者共同扩大了收入基础。'
    const boundary = '现有证据仅覆盖两类产品的收入变化，未覆盖市场饱和度和长期留存。'
    input.reportMarkdown = [
      '# 增长研究',
      '## 主要发现',
      '### 增长潜力',
      '新产品收入同比增长120% [1]。',
      '',
      '成熟产品收入同比增长30% [2]。',
      '',
      `${synthesis} [1][2]。`,
      '',
      boundary
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.9, followsResearchFrame: 0.9,
        reportCompleteness: 0.9, evidenceUse: 0.9, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9, writingQuality: 0.9, overall: 0.9
      },
      rationale: '主观否定已存在的结构。',
      issues: [{
        code: 'incomplete_synthesis', category: 'coverage', severity: 'blocking',
        message: '增长潜力章节仅堆砌事实，缺乏综合推理。', unsupportedFragment: synthesis
      }, {
        code: 'no_boundary', category: 'coverage', severity: 'blocking',
        message: '增长潜力章节缺乏边界分析。', unsupportedFragment: boundary
      }, {
        code: 'missing_boundary', category: 'coverage', severity: 'blocking',
        message: '增长潜力章节末尾缺少适用边界或证据缺口说明。',
        unsupportedFragment: '增长潜力章节末尾未提及任何边界或证据缺口。'
      }],
      blockingIssues: [
        '增长潜力章节缺乏实质综合推理和边界分析',
        '增长潜力章节仅堆砌事实，缺乏综合推理。',
        '增长潜力章节缺乏边界分析。',
        '增长潜力章节末尾缺少适用边界或证据缺口说明。'
      ],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('satisfies the audited synthesis')
  })

  it('does not turn a concrete evidence boundary into an out-of-scope synthesis requirement', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    const synthesis = '因此，现有增长事实与外部可持续性判断形成时间边界，当前增速不能直接外推至未来。'
    const boundary = '现有证据仅覆盖当前增速和外部判断，并未解释两个产品增速差异的具体原因。'
    input.reportMarkdown = [
      '# 增长研究',
      '## 主要发现',
      '### 增长潜力',
      '新产品收入同比增长120% [1]。',
      '',
      '分析师认为当前增速未来可能放缓 [2]。',
      '',
      `${synthesis} [1][2]。`,
      '',
      boundary
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.9, followsResearchFrame: 0.9,
        reportCompleteness: 0.9, evidenceUse: 0.9, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9, writingQuality: 0.9, overall: 0.9
      },
      rationale: '把局限误判为必答项。',
      issues: [{
        code: 'incomplete_synthesis', category: 'coverage', severity: 'blocking',
        message: '增长潜力章节未解释两个产品增速差异的原因，缺乏综合推理。',
        unsupportedFragment: boundary
      }],
      blockingIssues: ['增长潜力章节未解释两个产品增速差异的原因，缺乏综合推理。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('evidence-boundary contract')
  })

  it('rejects named requirements invented by the Judge from model-authored scope prose', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.brief = {
      ...input.brief,
      topic: '分析项目的执行状态、交付方式和主要风险。',
      userIntent: '回答项目当前状况。'
    }
    input.scope = {
      ...input.scope,
      mainContradiction: '项目能否应对供应商锁定和区域故障。'
    }
    input.frame = {
      ...input.frame,
      coreQuestions: [{ id: 'q1', text: '主要风险是什么？', priority: 'high', required: true }]
    }
    input.reportMarkdown = [
      '# 项目研究',
      '## 主要发现',
      '### 主要风险',
      '现有材料确认了交付依赖关系 [1]。',
      '',
      '另一份材料确认了执行条件 [2]。',
      '',
      '因此，两条证据分别限定了风险判断的事实基础和成立条件 [1][2]。',
      '',
      '现有证据未覆盖这些条件之外的结果，不能据此外推。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.9, followsResearchFrame: 0.9,
        reportCompleteness: 0.5, evidenceUse: 0.9, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9, writingQuality: 0.9, overall: 0.6
      },
      rationale: '把模型摘要写入用户要求。',
      issues: [{
        code: 'scope_expansion', category: 'coverage', severity: 'blocking',
        message: '主要风险章节未覆盖供应商锁定、区域故障等用户明确要求的风险子项。'
      }],
      blockingIssues: ['主要风险章节未覆盖供应商锁定、区域故障等用户明确要求的风险子项。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('absent from the user topic')
  })

  it('treats disclosed company self-reporting without required independent sourcing as a warning', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    const synthesis = '由此判断，公司将通过提升品牌价值和用户忠诚度来维持市场地位。'
    input.reportMarkdown = [
      '# 市场研究',
      '## 主要发现',
      '### 竞争地位',
      '公司表示将提升品牌价值 [1]。',
      '',
      '公司表示将增强用户忠诚度 [2]。',
      '',
      `${synthesis} [1][2]。`,
      '',
      '现有证据仅覆盖公司自身的战略意图和已宣称的成果，未获第三方市场数据交叉验证。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.9, followsResearchFrame: 0.9,
        reportCompleteness: 0.9, evidenceUse: 0.9, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9, writingQuality: 0.9, overall: 0.9
      },
      rationale: '要求第三方材料。',
      issues: [{
        code: 'citation_unfaithful', category: 'citation', severity: 'blocking',
        message: '竞争地位章节引用公司自我陈述，缺乏第三方验证，且未明确标注局限性。',
        unsupportedFragment: synthesis
      }],
      blockingIssues: [
        '竞争地位章节引用公司自我陈述，缺乏第三方验证，且未明确标注局限性',
        '竞争地位章节引用公司自我陈述，缺乏第三方验证，且未明确标注局限性。'
      ],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('self-claimed results')
  })

  it('keeps a concrete section-level Judge finding blocking after audit reconciliation', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# HTTP cache', '## 主要发现', '### ETag',
      '弱 ETag 使用 W/ 前缀 [1]。', '', '强 ETag 使用另一种比较语义 [2]。', '',
      '因此，两类验证器的比较行为不同 [1][2]。', '',
      '现有证据未覆盖生成实现，因此不能据此外推。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.7, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.6, overall: 0.65
      },
      rationale: 'ETag 章节含有具体无依据结论。',
      issues: [{
        code: 'unsupported_conclusion', category: 'writing', severity: 'blocking',
        message: 'ETag 章节把比较差异写成了性能优势。', unsupportedFragment: '性能优势'
      }],
      blockingIssues: ['ETag 章节把比较差异写成了性能优势。'], warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(false)
    expect(reconciled.blockingIssues).toContain('ETag 章节把比较差异写成了性能优势。')
  })

  it('rejects a no-substance allegation that omits the required report fragment', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# HTTP cache', '## 主要发现', '### API 响应缓存场景',
      'no-cache 允许存储，但要求每次复用前验证 [1]。', '',
      'validation 通过条件请求重新确认过期响应 [2]。', '',
      '由此判断，若 API 响应使用 no-cache，则复用前仍要按 validation 机制完成验证 [1][2]。', '',
      '现有证据未覆盖这种选择在 API 场景中的性能结果，因此不能据此外推。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.6, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.7
      },
      rationale: '场景章只有定义。',
      issues: [{
        code: 'writing_no_substance', category: 'writing', severity: 'blocking',
        message: 'API 响应缓存场景仅堆砌事实，未进行真正的场景分析。'
      }],
      blockingIssues: ['API 响应缓存场景仅堆砌事实，未进行真正的场景分析。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('did not quote a concrete section fragment')
  })

  it('keeps a thin-section Judge finding blocking when the deterministic verifier agrees', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.reportMarkdown = [
      '# 通用比较', '## 主要发现', '### 访问门槛',
      '系统甲允许本地访问 [1]。', '',
      '系统乙允许远程访问 [2]。', '',
      '因此，两项事实分别描述不同入口 [1][2]。', '',
      '现有证据仅覆盖访问入口。'
    ].join('\n\n')
    input.deterministicVerdict = {
      ...input.deterministicVerdict,
      pass: true,
      issues: [{
        code: 'report_argument_depth_advisory',
        message: '必填章节「访问门槛」仍是事实摘要，没有形成足够完整的结论、证据、推理与边界论证。',
        severity: 'warning'
      }],
      warnings: ['必填章节「访问门槛」仍是事实摘要。']
    }
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.5, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.6
      },
      rationale: '访问门槛章节过薄。',
      issues: [{
        code: 'incomplete_synthesis', category: 'coverage', severity: 'blocking',
        message: '访问门槛章节仅有事实摘要，没有解释证据如何推出局部结论。'
      }],
      blockingIssues: ['访问门槛章节仅有事实摘要，没有解释证据如何推出局部结论。'],
      warnings: [], recommendedFixes: ['重写访问门槛章节。']
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)
    const merged = mergeQualityVerdictWithJudge(input.deterministicVerdict, reconciled)

    expect(reconciled.pass).toBe(false)
    expect(merged.pass).toBe(false)
    expect(merged.blockingIssues.join('\n')).toContain('访问门槛章节仅有事实摘要')
  })

  it('accepts a quoted conditional scene application instead of demanding unsupported effects', () => {
    const input = makeJudgeInput()
    const conditional = '由此判断，若在 API 响应缓存场景中应用 no-cache 指令，则每次复用前必须执行验证，且验证可通过条件请求完成，但这并非场景实测结论。'
    input.reportMarkdown = [
      '# HTTP cache', '## 主要发现', '### API 响应缓存场景',
      'no-cache 允许存储，但要求每次复用前验证 [1]。', '',
      'validation 通过条件请求重新确认过期响应 [2]。', '',
      `${conditional} [1][2]`, '',
      '现有证据未覆盖这种选择在 API 场景中的性能结果，因此不能据此外推。'
    ].join('\n\n')
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9, answersConfirmedScope: 0.8, followsResearchFrame: 0.8,
        reportCompleteness: 0.6, evidenceUse: 0.7, citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8, writingQuality: 0.5, overall: 0.7
      },
      rationale: '要求更多场景效果。',
      issues: [{
        code: 'scene_no_analysis', category: 'coverage', severity: 'blocking',
        message: 'API 响应缓存场景仅重复一般定义，未进行场景特有的分析。',
        unsupportedFragment: `API 响应缓存场景：${conditional}`
      }],
      blockingIssues: ['API 响应缓存场景仅重复一般定义，未进行场景特有的分析。'],
      warnings: [], recommendedFixes: []
    }), { source: 'llm_judge', model: 'fake', judgedAt: input.nowIso })

    const reconciled = reconcileJudgeVerdictWithArgumentAudit(verdict, input)

    expect(reconciled.pass).toBe(true)
    expect(reconciled.blockingIssues).toEqual([])
    expect(reconciled.warnings.join('\n')).toContain('concrete if-then application')
  })

  it('falls back after one bounded model call when judge output remains invalid', async () => {
    const model = new FakeModelClient('not json')
    const judge = new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    })

    const verdict = await judge.judge(makeJudgeInput())

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.maxTokens).toBe(1_800)
    expect(verdict.source).toBe('heuristic_fallback')
    expect(verdict.failureKind).toBe('judge_unavailable')
    expect(verdict.warnings.join('\n')).toContain('LLM Judge')
  })

  it('isolates citation findings that contradict occurrence evidence without discarding the judge score', async () => {
    const response = JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.9,
        citationFaithfulness: 0.5,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.9,
        overall: 0.7
      },
      rationale: '声称引用不支持原文明确出现的事实。',
      issues: [{
        code: 'citation_unfaithful',
        category: 'citation',
        message: '报告中的冠军事实没有证据。',
        severity: 'blocking',
        occurrenceId: 'cit_occurrence_1',
        claimId: 'claim_1',
        unsupportedFragment: '中国队获得该届赛事冠军',
        evidenceQuote: '官方结果明确记录中国队获得该届赛事冠军。'
      }, {
        code: 'writing_unsupported_expansion',
        category: 'writing',
        message: '中国队获得该届赛事冠军属于无依据技术扩写。',
        severity: 'blocking',
        unsupportedFragment: '中国队获得该届赛事冠军'
      }],
      blockingIssues: ['报告中的冠军事实没有证据。', '中国队获得该届赛事冠军属于无依据技术扩写。'],
      warnings: [],
      recommendedFixes: ['删除冠军事实。']
    })
    const model = new FakeModelClient(response)
    const judge = new ModelQualityJudge({ modelClient: model, model: 'fake-judge-model', timeoutMs: 1_000 })
    const base = makeJudgeInput()
    const verdict = await judge.judge({
      ...base,
      budget: resolveResearchBudget({ preset: 'standard' }),
      sources: [{
        id: 'source_1',
        sourceType: 'local_file',
        title: '官方结果',
        path: '/tmp/result.txt',
        accessedAt: base.nowIso,
        importedAt: base.nowIso,
        reliability: 'high',
        reliabilityReason: '测试证据。',
        sourcePolicyTags: ['user_file'],
        fingerprint: 'fp_1',
        status: 'fetched',
        kind: 'user_file'
      }],
      evidenceSpans: [{
        id: 'span_1',
        sourceId: 'source_1',
        text: '官方结果明确记录中国队获得该届赛事冠军。',
        textHash: 'hash_1',
        location: { paragraphIndex: 1 },
        extractedAt: base.nowIso,
        extractorRunId: 'rr_1'
      }],
      claims: [{
        id: 'claim_1',
        text: '中国队获得该届赛事冠军。',
        entities: ['中国队'],
        claimType: 'fact',
        supportSpanIds: ['span_1'],
        confidence: 'high',
        critical: true
      }],
      citations: [{
        id: 'cit_occurrence_1',
        reportPath: '/tmp/report.md',
        reportAnchor: 'claim:claim_1:1',
        reportClaimText: '中国队获得该届赛事冠军。',
        claimId: 'claim_1',
        evidenceSpanIds: ['span_1'],
        status: 'verified',
        verifiedAt: base.nowIso
      }]
    })

    expect(verdict.source).toBe('llm_judge')
    expect(verdict.failureKind).toBe('report_quality')
    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).not.toContain('冠军事实没有证据')
    expect(verdict.blockingIssues.join('\n')).not.toContain('无依据技术扩写')
    expect(verdict.blockingIssues.join('\n')).toContain('引用忠实度评分')
    expect(verdict.warnings.join('\n')).toContain('contradicts occurrence evidence')
    expect(model.requests).toHaveLength(1)
  })

  it('isolates an unpunctuated-prose allegation when the quoted fragment already has sentence boundaries', async () => {
    const message = '报告存在无标点粘连长句：第一句已经结束。第二句也已经结束。'
    const model = new FakeModelClient(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.9,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.9,
        overall: 0.9
      },
      rationale: '误把两个完整句子当作无标点长句。',
      issues: [{
        code: 'unpunctuated_prose',
        category: 'writing',
        message,
        severity: 'blocking',
        unsupportedFragment: '第一句已经结束。第二句也已经结束。'
      }],
      blockingIssues: [message],
      warnings: [],
      recommendedFixes: []
    }))
    const verdict = await new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    }).judge(makeJudgeInput())

    expect(verdict.pass).toBe(true)
    expect(verdict.blockingIssues).toEqual([])
    expect(verdict.warnings.join('\n')).toContain('explicit sentence or paragraph boundaries')
  })

  it('isolates an unpunctuated-prose allegation when the report sentence ends before its citation', async () => {
    const message = '句子粘连：该事实缺少句号。'
    const model = new FakeModelClient(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.9,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.9,
        overall: 0.9
      },
      rationale: '误把引用前的句号忽略了。',
      issues: [{
        code: 'unpunctuated_prose',
        category: 'writing',
        message,
        severity: 'blocking',
        unsupportedFragment: '该事实已经完整结束'
      }],
      blockingIssues: [message],
      warnings: [],
      recommendedFixes: []
    }))
    const input = makeJudgeInput()
    const verdict = await new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    }).judge({
      ...input,
      reportMarkdown: `${input.reportMarkdown}\n\n该事实已经完整结束。 [1]`
    })

    expect(verdict.pass).toBe(true)
    expect(verdict.blockingIssues).toEqual([])
    expect(verdict.warnings.join('\n')).toContain('explicit sentence or paragraph boundaries')
  })

  it('rejects an unauditable generic citation block when citation score is above threshold', async () => {
    const message = 'API 响应缓存场景引用错误。'
    const model = new FakeModelClient(JSON.stringify({
      pass: false,
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.9,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.9,
        overall: 0.9
      },
      rationale: '没有给出可定位的引用证据。',
      issues: [],
      blockingIssues: [message],
      warnings: [],
      recommendedFixes: []
    }))
    const verdict = await new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    }).judge(makeJudgeInput())

    expect(verdict.pass).toBe(true)
    expect(verdict.blockingIssues).toEqual([])
    expect(verdict.warnings.join('\n')).toContain('missing occurrenceId')
  })

  it('does not allow heuristic fallback to pass standard preset reports', async () => {
    const model = new FakeModelClient('not json')
    const judge = new ModelQualityJudge({
      modelClient: model,
      model: 'fake-judge-model',
      timeoutMs: 1_000
    })

    const verdict = await judge.judge({
      ...makeJudgeInput(),
      budget: resolveResearchBudget({ reasoningEffort: 'high', maxWorkers: 1, maxRounds: 1, maxSources: 12, timeoutMs: 1_000 })
    })

    expect(verdict.source).toBe('heuristic_fallback')
    expect(verdict.pass).toBe(false)
    expect(verdict.failureKind).toBe('judge_unavailable')
    expect(verdict.blockingIssues.join('\n')).toContain('未返回可用结果')
    expect(model.requests).toHaveLength(1)
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
    expect(verdict.failureKind).toBe('judge_unavailable')
    expect(verdict.blockingIssues.join('\n')).toContain('未返回可用结果')
    expect(model.requests).toHaveLength(1)
  })

  it('treats subjective judge failures as advisory after deterministic verification passes', () => {
    const input = makeJudgeInput()
    const merged = mergeQualityVerdictWithJudge(input.deterministicVerdict, {
      source: 'heuristic_fallback',
      failureKind: 'judge_unavailable',
      pass: false,
      scores: {
        requirementsAlignment: 0.4,
        answersConfirmedScope: 0.4,
        followsResearchFrame: 0.4,
        reportCompleteness: 0.4,
        evidenceUse: 0.4,
        citationFaithfulness: 0.4,
        uncertaintyCalibration: 0.4,
        writingQuality: 0.4,
        overall: 0.4
      },
      rationale: 'Judge unavailable.',
      issues: [{
        code: 'judge_unavailable',
        category: 'writing',
        message: 'Judge unavailable.',
        severity: 'blocking'
      }],
      blockingIssues: ['Judge unavailable.'],
      warnings: [],
      recommendedFixes: [],
      judgedAt: input.nowIso
    })

    expect(merged.pass).toBe(true)
    expect(merged.blockingIssues).toEqual([])
    expect(merged.warnings.join('\n')).toContain('Judge unavailable')
  })

  it('keeps concrete repetition and auditable citation mismatches blocking', () => {
    const input = makeJudgeInput()
    const baseJudge = {
      source: 'llm_judge' as const,
      model: 'fake',
      pass: false,
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.9,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.9,
        overall: 0.9
      },
      rationale: 'Concrete publication defect.',
      warnings: [],
      recommendedFixes: [],
      judgedAt: input.nowIso
    }
    const repetition = mergeQualityVerdictWithJudge(input.deterministicVerdict, {
      ...baseJudge,
      issues: [{
        code: 'writing_repetition',
        category: 'writing',
        message: '主要发现跨章节重复同一事实。',
        severity: 'blocking'
      }],
      blockingIssues: ['主要发现跨章节重复同一事实。']
    })
    const citation = mergeQualityVerdictWithJudge(input.deterministicVerdict, {
      ...baseJudge,
      issues: [{
        code: 'citation_unfaithful',
        category: 'citation',
        message: '引用原文不支持报告句。',
        severity: 'blocking',
        occurrenceId: 'cit_1',
        claimId: 'claim_1',
        unsupportedFragment: '报告中的具体断言。',
        evidenceQuote: '原文只支持另一项事实。'
      }],
      blockingIssues: ['引用原文不支持报告句。']
    })

    expect(repetition.pass).toBe(false)
    expect(citation.pass).toBe(false)
  })

  it('rejects judge pass=true when critical quality scores are below threshold', () => {
    const verdict = parseQualityJudgeVerdict(JSON.stringify({
      pass: true,
      scores: {
        requirementsAlignment: 0.61,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.88,
        reportCompleteness: 0.9,
        evidenceUse: 0.52,
        citationFaithfulness: 0.93,
        uncertaintyCalibration: 0.84,
        writingQuality: 0.89,
        overall: 0.81
      },
      rationale: '自称通过，但核心质量分不足。',
      blockingIssues: [],
      warnings: [],
      recommendedFixes: []
    }), {
      source: 'llm_judge',
      model: 'fake-judge-model',
      judgedAt: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('需求匹配评分')
    expect(verdict.blockingIssues.join('\n')).toContain('证据使用评分')
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
    expect(prompt).toContain('citationEvidenceChains')
    expect(prompt).toContain('"occurrenceId": "cit_1"')
    expect(prompt).toContain('交易规则：A股T+1')
    expect(prompt).toContain('Useful Source')
    expect(prompt).not.toContain('noisy claim 20')
    expect(prompt).not.toContain('noisy evidence 20')
    expect(prompt).not.toContain('data-citation-id=')
    expect(prompt.length).toBeLessThan(24_000)
  })

  it('preserves every findings subsection and exposes argument structure in compact standard prompts', () => {
    const input = makeJudgeInput()
    const transitions = ['由此可见', '综合判断', '总体而言', '总体来看', '由此判断']
    const section = (title: string, index: number) => [
      `### ${title}`,
      '',
      `${'本章事实由证据支持 [1]。'.repeat(25)}`,
      '',
      `${transitions[index]}，本章形成了局部结论。这一判断的适用边界是当前样本仍然有限。`
    ].join('\n')
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.reportMarkdown = [
      '# 中国乒乓球实力分析',
      '## 摘要',
      '短摘要。',
      '## 调研范围与方法',
      '短方法。',
      '## 主要发现',
      ...['竞技成绩', '人才储备', '技战术', '国际竞争格局', '男女队'].map(section),
      '## 结论',
      '综合结论 [1]。',
      '## 局限与不确定性',
      '样本有限。'
    ].join('\n\n')

    const prompt = buildQualityJudgePrompt(input, { compact: true })

    for (const title of ['竞技成绩', '人才储备', '技战术', '国际竞争格局', '男女队']) {
      expect(prompt).toContain(`### ${title}`)
      expect(prompt).toContain(`"title": "${title}"`)
    }
    expect(prompt).toContain('"hasEvidenceSynthesis": true')
    expect(prompt).toContain('"hasBoundary": true')
  })

  it('keeps at least one evidence chain for every displayed citation in compact prompts', () => {
    const input = makeJudgeInput()
    input.budget = resolveResearchBudget({ preset: 'standard' })
    input.citations = Array.from({ length: 12 }, (_, index) => ({
      id: `cit_occurrence_${index + 1}`,
      displayId: index === 11 ? 'cit_4' : 'cit_1',
      reportPath: '/tmp/report.md',
      reportAnchor: `claim:claim_1:${index + 1}`,
      reportClaimText: index === 11 ? '第四个来源支持 API 缓存事实。' : '第一个来源支持缓存事实。',
      claimId: 'claim_1',
      evidenceSpanIds: ['span_1'],
      status: 'verified' as const,
      verifiedAt: input.nowIso
    }))
    input.claims = [{
      id: 'claim_1', text: '缓存事实。', entities: [], claimType: 'fact',
      supportSpanIds: ['span_1'], confidence: 'high', critical: true
    }]
    input.evidenceSpans = [{
      id: 'span_1', sourceId: 'source_1', text: '来源明确记录缓存事实。', textHash: 'hash_1',
      location: { paragraphIndex: 1 }, extractedAt: input.nowIso, extractorRunId: 'rr_1'
    }]
    input.sources = [{
      id: 'source_1', sourceType: 'local_file', title: 'Source', path: '/tmp/source.txt',
      accessedAt: input.nowIso, importedAt: input.nowIso, reliability: 'high',
      reliabilityReason: 'test', sourcePolicyTags: ['user_file'], fingerprint: 'fp_1',
      status: 'fetched', kind: 'user_file'
    }]

    const prompt = buildQualityJudgePrompt(input, { compact: true })

    expect(prompt).toContain('"occurrenceId": "cit_occurrence_1"')
    expect(prompt).toContain('"occurrenceId": "cit_occurrence_12"')
    expect(prompt).toContain('"displayId": "cit_4"')
  })

  it('uses the shared Writer argument signals for judge section audits', () => {
    const input = makeJudgeInput()
    input.reportMarkdown = [
      '# HTTP 缓存',
      '## 主要发现',
      '### 缓存机制',
      '缓存响应在新鲜期可以直接复用 [1]。验证机制负责处理不能直接复用的响应 [1]。',
      '',
      '关键在于，两种机制分别处理缓存生命周期中的不同阶段。现有证据未覆盖具体浏览器实现，因此不能把协议层结论外推为实现细节。',
      '## 结论',
      '两种机制共同限定缓存行为 [1]。',
      '## 局限与不确定性',
      '现有证据未覆盖具体浏览器实现。'
    ].join('\n\n')

    const prompt = buildQualityJudgePrompt(input)

    expect(prompt).toContain('"title": "缓存机制"')
    expect(prompt).toContain('"hasEvidenceSynthesis": true')
    expect(prompt).toContain('"hasBoundary": true')
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
