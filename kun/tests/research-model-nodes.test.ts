import { describe, expect, it } from 'vitest'
import {
  BasicPlanAgent,
  BasicCoverageEvaluator,
  BasicHypothesisProposer,
  BasicResearchSupervisor,
  BasicTestDesigner,
  BasicSynthesisWriter,
  ModelResearchTaskWorker,
  SeededWebResearchTaskWorker,
  ModelSynthesisWriter,
  CitationResolver,
  buildResearchWorkerPrompt,
  buildSynthesisWriterPrompt,
  buildWebExtractionPrompt,
  researchPresetForReasoningEffort,
  resolveResearchBudget,
  selectTasksByValueOfInformation,
  validateWorkerResult,
  type ResearchTask,
  type ResearchTaskWorkerInput,
  type SynthesisWriterInput
} from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { DeterministicWebProvider } from '../src/ports/web-provider.js'

const RECENT_YEAR_QUERY_SUFFIX = '最近一年 after:2025-06-29 before:2026-06-29'

describe('model-backed research nodes', () => {
  it('maps composer reasoning efforts to bounded research presets', () => {
    expect(researchPresetForReasoningEffort('low')).toBe('quick')
    expect(researchPresetForReasoningEffort('medium')).toBe('quick')
    expect(researchPresetForReasoningEffort('high')).toBe('standard')
    expect(researchPresetForReasoningEffort('max')).toBe('deep')

    expect(resolveResearchBudget({ reasoningEffort: 'medium' })).toMatchObject({
      preset: 'quick',
      maxSubagents: 2,
      maxResearchRounds: 1
    })
    expect(resolveResearchBudget({ reasoningEffort: 'max' })).toMatchObject({
      preset: 'deep',
      maxSubagents: 8,
      maxResearchRounds: 4
    })
  })

  it('lets the supervisor choose bounded parallel tasks for the selected preset', async () => {
    const supervisor = new BasicResearchSupervisor()
    const input = makeWorkerInput()
    const plan = await supervisor.createInitialPlan({
      runId: input.runId,
      brief: input.brief,
      frame: {
        ...input.frame,
        coreQuestions: [
          { id: 'q1', text: '如何界定中美经济竞争的范围？', priority: 'high', required: true },
          { id: 'q2', text: '当前有哪些关键指标？', priority: 'high', required: true },
          { id: 'q3', text: '竞争形成的机制是什么？', priority: 'high', required: true },
          { id: 'q4', text: '有哪些反例和边界条件？', priority: 'medium', required: false },
          { id: 'q5', text: '结论对用户决策意味着什么？', priority: 'medium', required: false }
        ]
      },
      budget: resolveResearchBudget({ reasoningEffort: 'max', maxSources: 30, targetSources: 24 }),
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(plan.supervisor).toMatchObject({ preset: 'deep', complexity: 'complex' })
    expect(plan.tasks.length).toBeGreaterThan(1)
    expect(plan.tasks.length).toBeLessThanOrEqual(8)
    expect(plan.tasks.reduce((sum, task) => sum + task.maxSources, 0)).toBeLessThanOrEqual(30)
    expect(new Set(plan.tasks.flatMap((task) => task.questionIds))).toEqual(new Set(['q1', 'q2', 'q3', 'q4', 'q5']))
  })

  it('keeps research tasks only when their evidence can change the final judgment', async () => {
    const input = makeWorkerInput()
    const budget = resolveResearchBudget({ reasoningEffort: 'high', maxSources: 8, targetSources: 6 })
    const hypotheses = await new BasicHypothesisProposer().propose({
      runId: input.runId,
      brief: input.brief,
      frame: input.frame,
      budget,
      nowIso: '2026-06-29T00:00:00.000Z'
    })
    const tests = await new BasicTestDesigner().design({
      runId: input.runId,
      brief: input.brief,
      frame: input.frame,
      budget,
      hypotheses,
      nowIso: '2026-06-29T00:00:00.000Z'
    })
    const tasks: ResearchTask[] = [{
      id: 'task_decisive',
      questionIds: ['q1'],
      objective: '寻找能区分需求疲软和竞争加剧的反证、指标和管理层归因。',
      expectedEvidence: ['能够削弱或支持核心判断的决定性证据。'],
      sourceTypes: ['web'],
      searchHints: ['需求疲软 竞争加剧 管理层归因 反证'],
      maxSources: 3,
      priority: 'high',
      status: 'pending'
    }, {
      id: 'task_background',
      questionIds: ['q1'],
      objective: '补充一般背景资料和百科式介绍。',
      expectedEvidence: ['相关背景资料。'],
      sourceTypes: ['local_file'],
      searchHints: ['背景 介绍'],
      maxSources: 8,
      priority: 'low',
      status: 'pending'
    }]

    const selected = selectTasksByValueOfInformation(tasks, tests, { preset: 'standard', maxSources: 8 })

    expect(selected.map((task) => task.id)).toContain('task_decisive')
    expect(selected.map((task) => task.id)).not.toContain('task_background')
    expect(selected[0]?.expectedEvidence[0]).toContain('如果这个搜索任务成功，会不会改变最终判断')
    expect(selected[0]?.valueOfInformation?.score).toBeGreaterThan(0.1)
  })

  it('creates follow-up tasks when coverage is below the selected preset', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const input = makeWriterInput()
    const verdict = await evaluator.evaluate({
      runId: input.runId,
      brief: input.brief,
      frame: input.frame,
      plan: input.plan,
      budget: resolveResearchBudget({ reasoningEffort: 'high', maxSources: 6, minSources: 3, targetSources: 4 }),
      roundIndex: 1,
      sources: input.sources,
      evidenceSpans: input.evidenceSpans,
      claims: input.claims,
      notes: input.notes,
      nowIso: input.nowIso
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks.length).toBeGreaterThan(0)
    expect(verdict.followUpTasks[0]?.objective).toContain('补足缺口')
  })

  it('does not count model generated source cards as strong web evidence for standard research', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const input = makeWriterInput()
    const budget = resolveResearchBudget({ reasoningEffort: 'high', maxSources: 8, minSources: 3, targetSources: 5 })
    const verdict = await evaluator.evaluate({
      runId: input.runId,
      brief: {
        ...input.brief,
        sourcePolicy: {
          allowedSourceTypes: ['web', 'local_file'],
          requireCitations: true
        }
      },
      frame: input.frame,
      plan: input.plan,
      budget,
      roundIndex: 1,
      sources: [
        { ...input.sources[0]!, id: 'source_model_1', sourceType: 'web', sourcePolicyTags: ['model_generated'] },
        { ...input.sources[0]!, id: 'source_model_2', sourceType: 'web', sourcePolicyTags: ['model_generated'] },
        { ...input.sources[0]!, id: 'source_model_3', sourceType: 'local_file', sourcePolicyTags: ['fake-corpus'] }
      ],
      evidenceSpans: input.evidenceSpans,
      claims: input.claims,
      notes: input.notes,
      nowIso: input.nowIso
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.coverageMatrix.strongWebSourceCount).toBe(0)
    expect(verdict.missingEvidence.join('\n')).toContain('问题「中美经济竞争的主要矛盾在哪里？」真实网页来源数 0 低于要求 1。')
  })

  it('plans multiple focused research tasks when the frame has multiple core questions', async () => {
    const planner = new BasicPlanAgent()
    const input = makeWorkerInput()
    const plan = await planner.createPlan({
      runId: input.runId,
      brief: input.brief,
      frame: {
        ...input.frame,
        coreQuestions: [
          { id: 'q1', text: '如何界定中美经济竞争的范围？', priority: 'high', required: true },
          { id: 'q2', text: '当前有哪些关键指标？', priority: 'high', required: true },
          { id: 'q3', text: '竞争形成的机制是什么？', priority: 'high', required: true },
          { id: 'q4', text: '有哪些反例和边界条件？', priority: 'medium', required: false },
          { id: 'q5', text: '结论对用户决策意味着什么？', priority: 'medium', required: false }
        ]
      },
      budget: resolveResearchBudget({ reasoningEffort: 'medium', maxWorkers: 2, maxRounds: 2, maxSources: 10, timeoutMs: 30_000 }),
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(plan.tasks).toHaveLength(5)
    expect(plan.tasks.reduce((sum, task) => sum + task.maxSources, 0)).toBeLessThanOrEqual(10)
    expect(plan.tasks.map((task) => task.objective).join('\n')).toContain('界定范围')
    expect(plan.tasks.map((task) => task.objective).join('\n')).toContain('反证')
    expect(plan.tasks.flatMap((task) => task.searchHints).join('\n')).toContain('定义 范围 可比口径')
    expect(plan.tasks.flatMap((task) => task.searchHints).join('\n')).toContain('反例 风险 争议 局限')
  })

  it('fallback synthesis writer expands into a detailed report instead of a short summary', async () => {
    const writer = new BasicSynthesisWriter()
    const input: SynthesisWriterInput = {
      ...makeWriterInput(),
      frame: {
        ...makeWriterInput().frame,
        coreQuestions: [
          { id: 'q1', text: '中美经济竞争的主要矛盾在哪里？', priority: 'high' as const, required: true },
          { id: 'q2', text: '哪些事实和指标最关键？', priority: 'high' as const, required: true },
          { id: 'q3', text: '这些事实如何影响未来趋势？', priority: 'medium' as const, required: false }
        ]
      }
    }

    const draft = await writer.writeDraft(input)

    expect(draft.markdown).not.toContain('## 摘要')
    expect(draft.markdown).not.toContain('## 调研范围与方法')
    expect(draft.markdown).toContain('## 主要发现')
    expect(draft.markdown).not.toContain('## 核心问题与回答')
    expect(draft.markdown).not.toContain('## 证据链')
    expect(draft.markdown.length).toBeGreaterThan(1800)
    expect(draft.claimIds).toContain('claim_1')
  })

  it('fallback synthesis writer ignores low-signal web boilerplate claims', async () => {
    const writer = new BasicSynthesisWriter()
    const base = makeWriterInput()
    const draft = await writer.writeDraft({
      ...base,
      brief: {
        ...base.brief,
        topic: 'A股与美股对比',
        userIntent: '面向中国内地个人投资者比较长期配置。'
      },
      frame: {
        ...base.frame,
        coreResearchThread: '核心主线是普通个人投资者如何在A股与美股之间做长期配置。',
        centralQuestion: 'A股与美股哪个更适合作为核心配置？'
      },
      claims: [{
        ...base.claims[0]!,
        id: 'claim_dirty',
        text: '交易规则：来源「网页」显示，首页 登录 注册 下载APP 您的浏览器不被支持 Edge Chrome Firefox',
        supportSpanIds: ['span_1']
      }, {
        ...base.claims[0]!,
        id: 'claim_clean',
        text: '交易规则：A股通常采用T+1交易和涨跌幅限制，美股通常采用T+0交易且交易工具更灵活。',
        supportSpanIds: ['span_1']
      }],
      notes: [{
        ...base.notes[0]!,
        claimIds: ['claim_clean'],
        limitations: [
          '网页来源已抓取，但模型未能抽取结构化证据：This operation was aborted。',
          '这是网页抽取模型失败后的确定性兜底证据，最终报告应避免从该片段过度推断。',
          '这是网页抽取模型失败后的确定性兜底证据，最终报告应避免从该片段过度推断。'
        ]
      }]
    })

    expect(draft.markdown).toContain('T+1')
    expect(draft.markdown).toContain('T+0')
    expect(draft.markdown).not.toContain('浏览器不被支持')
    expect(draft.markdown).not.toContain('下载APP')
    expect(draft.claimIds).toContain('claim_clean')
    expect(draft.claimIds).not.toContain('claim_dirty')
  })

  it('fallback synthesis writer keeps generic architecture claims citeable', async () => {
    const writer = new BasicSynthesisWriter()
    const base = makeWriterInput()
    const draft = await writer.writeDraft({
      ...base,
      brief: {
        ...base.brief,
        topic: 'DeepResearch 为什么需要 gap loop 和 LLM Judge',
        userIntent: '解释 gap loop 与 LLM Judge 如何形成 supervisor 式退出机制。'
      },
      frame: {
        ...base.frame,
        coreResearchThread: 'gap loop 负责证据充分性，LLM Judge 负责报告质量，两者共同决定是否退出。',
        centralQuestion: '为什么 DeepResearch 需要 gap loop 和 LLM Judge？'
      },
      evidenceSpans: [{
        ...base.evidenceSpans[0]!,
        id: 'span_architecture',
        text: 'gap loop 检查子问题覆盖、来源数量和未解决缺口；LLM Judge 检查报告是否满足已确认需求。'
      }],
      claims: [{
        ...base.claims[0]!,
        id: 'claim_architecture',
        text: 'gap loop 负责判断证据是否充分，LLM Judge 负责判断报告是否满足已确认需求，两者共同构成 supervisor 式退出机制。',
        supportSpanIds: ['span_architecture']
      }],
      notes: [{
        ...base.notes[0]!,
        claimIds: ['claim_architecture'],
        implicationForBrief: '报告需要解释证据充分性判断和报告质量判断之间的分工。'
      }]
    })

    expect(draft.markdown).toContain('gap loop')
    expect(draft.markdown).toContain('[claim:claim_architecture]')
    expect(draft.claimIds).toContain('claim_architecture')
  })

  it('passes user clarification text into planner, worker and writer prompts', () => {
    const workerInput = {
      ...makeWorkerInput(),
      brief: {
        ...makeWorkerInput().brief,
        userClarifications: ['回答：经济与贸易；科技与创新', '补充说明：重点看最近三年。']
      }
    }
    const writerInput = {
      ...makeWriterInput(),
      brief: {
        ...makeWriterInput().brief,
        userClarifications: ['回答：经济与贸易；科技与创新', '补充说明：重点看最近三年。']
      }
    }

    expect(buildResearchWorkerPrompt(workerInput)).toContain('经济与贸易')
    expect(buildResearchWorkerPrompt(workerInput)).toContain('重点看最近三年')
    expect(buildSynthesisWriterPrompt(writerInput)).toContain('经济与贸易')
    expect(buildSynthesisWriterPrompt(writerInput)).toContain('逐条回应这些用户补充要求')
    expect(buildWebExtractionPrompt(workerInput, [])).toContain('科技与创新')
  })

  it('keeps synthesis retry prompts compact and driven by judge feedback', () => {
    const base = makeWriterInput()
    const prompt = buildSynthesisWriterPrompt({
      ...base,
      evidenceSpans: Array.from({ length: 60 }, (_, index) => ({
        ...base.evidenceSpans[0]!,
        id: `span_${index + 1}`,
        text: `A股与美股对比证据 ${index + 1}：A股通常采用T+1交易，美股交易机制更灵活。`
      })),
      claims: Array.from({ length: 60 }, (_, index) => ({
        ...base.claims[0]!,
        id: `claim_${index + 1}`,
        supportSpanIds: [`span_${index + 1}`],
        text: index % 2 === 0
          ? `交易规则：A股通常采用T+1交易，美股交易机制更灵活。第 ${index + 1} 条。`
          : `可比口径：Skip to main content Toggle navigation Main navigation Data by Topic 第 ${index + 1} 条。`
      })),
      notes: Array.from({ length: 60 }, (_, index) => ({
        ...base.notes[0]!,
        id: `note_${index + 1}`,
        claimIds: [`claim_${index + 1}`],
        implicationForBrief: '该来源可用于回答内部任务，并服务于主线：这句话不应直接进入报告。'
      })),
      revision: {
        attempt: 2,
        maxAttempts: 3,
        previousVerdict: {
          pass: false,
          scores: {
            requirementsAlignment: 0.2,
            answersCoreQuestions: 0.2,
            followsCoreResearchThread: 0.3,
            reportCompleteness: 0.2,
            citationAccuracy: 0.3,
            evidenceCoverage: 0.2,
            sourceQuality: 0.7,
            conflictHandling: 0.7,
            uncertaintyCalibration: 0.2,
            writingQuality: 0.1,
            llmJudgeOverall: 0.2
          },
          blockingIssues: ['报告粘贴了内部证据摘要，没有回答核心问题。'],
          warnings: ['证据需要重新整合。'],
          recommendedFixes: ['围绕交易规则、估值和配置建议重写。'],
          issues: [],
          verifiedAt: '2026-07-06T00:00:00.000Z'
        }
      }
    })

    expect(prompt).toContain('上一轮质量校验反馈')
    expect(prompt).toContain('报告粘贴了内部证据摘要')
    expect(prompt).not.toContain('上一轮报告 Markdown')
    expect(prompt).not.toContain('上一轮报告正文不应该被完整塞回重写 prompt')
    expect(prompt).not.toContain('Skip to main content')
    expect(prompt).not.toContain('该来源可用于回答内部任务')
    expect(prompt.length).toBeLessThan(24_000)
  })

  it('fetches real web source text before asking the model to extract evidence', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: '美国经济分析局页面显示，美国官方经济统计会持续发布国内生产总值、个人收入和国际交易等指标。',
        claimText: '美国官方经济统计可以作为分析美国宏观经济表现的基础来源。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['美国经济分析局'],
        noteSummary: '美国官方统计来源可支撑美国宏观指标分析。',
        implicationForBrief: '报告应把美国宏观经济判断绑定到官方统计来源，而不是只依赖模型资料卡。',
        limitations: ['该来源只覆盖美国侧，需要结合中国官方统计来源。']
      }, {
        sourceIndex: 2,
        evidenceText: '中国国家统计局英文站提供中国统计发布入口和英文统计信息。',
        claimText: '中国国家统计局可以作为中国宏观经济信息的官方来源。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['中国国家统计局'],
        noteSummary: '中国官方统计来源可支撑中国宏观指标分析。',
        implicationForBrief: '中美对比需要同时绑定中美两侧官方口径，避免单边叙述。',
        limitations: ['不同国家统计口径可能不可直接相加比较。']
      }],
      unresolvedQuestions: ['仍需要补充贸易统计。'],
      suggestedNextQueries: ['中美贸易 官方统计']
    }))
    const fetchCalls: string[] = []
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      timeoutMs: 1_000,
      fetchImpl: (async (input) => {
        const url = String(input)
        fetchCalls.push(url)
        if (url.includes('bea.gov')) {
          return new Response(`<html><title>BEA</title><body>${'美国经济分析局页面显示，美国官方经济统计会持续发布国内生产总值、个人收入和国际交易等指标。'.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url.includes('stats.gov.cn')) {
          return new Response(`<html><title>NBS China</title><body>${'中国国家统计局英文站提供中国统计发布入口和英文统计信息。'.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(makeWebWorkerInput())

    expect(fetchCalls.some((url) => url.includes('bea.gov'))).toBe(true)
    expect(fetchCalls.some((url) => url.includes('stats.gov.cn'))).toBe(true)
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools).toEqual([])
    expect(result.sources.map((source) => source.sourceType)).toEqual(['web', 'web'])
    expect(result.sources[0]?.canonicalUrl).toContain('bea.gov')
    expect(result.sources[0]?.sourcePolicyTags).toContain('web_fetch')
    expect(result.sources[0]?.sourcePolicyTags).toContain('strong_web_evidence')
    expect(result.unresolvedQuestions).toContain('仍需要补充贸易统计。')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('treats generic fetched architecture pages as strong web evidence', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Gap loop checks evidence coverage, unresolved questions and source sufficiency before synthesis. LLM Judge evaluates report quality and citation faithfulness after synthesis.',
        claimText: 'Gap loop and LLM Judge form a supervisor-style exit mechanism for DeepResearch.',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Gap loop', 'LLM Judge', 'DeepResearch'],
        noteSummary: 'Generic architecture evidence was extracted from the fetched page.',
        implicationForBrief: 'The report can explain why supervisor exit needs both evidence coverage and report quality gates.',
        limitations: ['The source describes architecture behavior rather than a product-specific benchmark.']
      }],
      unresolvedQuestions: [],
      suggestedNextQueries: []
    }))
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        [`gap loop LLM Judge supervisor ${RECENT_YEAR_QUERY_SUFFIX}`]: [{
          url: 'https://example.test/deepresearch-supervisor',
          title: 'DeepResearch supervisor architecture',
          snippet: 'Gap loop and LLM Judge exit mechanism'
        }]
      }
    })
    const input: ResearchTaskWorkerInput = {
      ...makeWebWorkerInput(),
      task: {
        ...makeWebWorkerInput().task,
        objective: '解释 DeepResearch 为什么需要 gap loop 和 LLM Judge。',
        expectedEvidence: ['gap loop 覆盖检查', 'LLM Judge 质量评审', 'supervisor 退出机制'],
        searchHints: ['gap loop LLM Judge supervisor'],
        maxSources: 2
      },
      brief: {
        ...makeWebWorkerInput().brief,
        topic: 'DeepResearch 为什么需要 gap loop 和 LLM Judge',
        userIntent: '用中文解释两者如何让研究过程知道什么时候停止。'
      },
      frame: {
        ...makeWebWorkerInput().frame,
        coreResearchThread: 'gap loop 判断证据是否充足，LLM Judge 判断最终报告是否达标，两者共同构成退出机制。',
        centralQuestion: 'DeepResearch 为什么需要 gap loop 和 LLM Judge？',
        coreQuestions: [{ id: 'q1', text: 'DeepResearch 为什么需要 gap loop 和 LLM Judge？', priority: 'high', required: true }],
        evidenceNeeded: ['覆盖率、来源充分性、报告质量评估证据'],
        disconfirmingEvidenceNeeded: ['简单请求不需要复杂循环的边界条件']
      }
    }
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (request) => {
        const url = String(request)
        if (url === 'https://example.test/deepresearch-supervisor') {
          return new Response(`<html><title>DeepResearch supervisor architecture</title><body>${'Gap loop checks evidence coverage, unresolved questions and source sufficiency before synthesis. LLM Judge evaluates report quality and citation faithfulness after synthesis. Supervisor exits only when both gates pass. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(input)

    expect(result.sources[0]?.sourcePolicyTags).toContain('web_fetch')
    expect(result.sources[0]?.sourcePolicyTags).toContain('strong_web_evidence')
    expect(result.claims.map((claim) => claim.text).join('\n')).toContain('Gap loop')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('does not add the default recent-year window when the user confirms an explicit time scope', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Gap loop checks evidence coverage across the configured research scope before synthesis.',
        claimText: '用户确认不限时间时，DeepResearch 应沿用该时间边界，而不是强制最近一年。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Gap loop', 'DeepResearch'],
        noteSummary: 'Explicit time scope evidence was extracted from the fetched page.',
        implicationForBrief: '调研可以覆盖历史和当前机制，而不被默认最近一年窗口误伤。',
        limitations: []
      }],
      unresolvedQuestions: [],
      suggestedNextQueries: []
    }))
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        'gap loop LLM Judge supervisor': [{
          url: 'https://example.test/deepresearch-all-time-supervisor',
          title: 'DeepResearch supervisor architecture all-time scope',
          snippet: 'Gap loop and LLM Judge architecture across all-time scope'
        }]
      }
    })
    const baseInput = makeWebWorkerInput()
    const input: ResearchTaskWorkerInput = {
      ...baseInput,
      task: {
        ...baseInput.task,
        objective: '解释 DeepResearch 为什么需要 gap loop 和 LLM Judge。',
        expectedEvidence: ['gap loop 覆盖检查', 'LLM Judge 质量评审'],
        searchHints: ['gap loop LLM Judge supervisor'],
        maxSources: 2
      },
      brief: {
        ...baseInput.brief,
        topic: 'DeepResearch 为什么需要 gap loop 和 LLM Judge',
        userIntent: '用中文解释两者如何让研究过程知道什么时候停止。',
        userClarifications: ['时间范围：不限时间，全面对比。']
      },
      frame: {
        ...baseInput.frame,
        coreResearchThread: 'gap loop 和 LLM Judge 共同构成退出机制。',
        centralQuestion: 'DeepResearch 为什么需要 gap loop 和 LLM Judge？',
        coreQuestions: [{ id: 'q1', text: 'DeepResearch 为什么需要 gap loop 和 LLM Judge？', priority: 'high', required: true }],
        evidenceNeeded: ['覆盖率、来源充分性、报告质量评估证据'],
        disconfirmingEvidenceNeeded: ['简单请求不需要复杂循环的边界条件']
      }
    }
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (request) => {
        const url = String(request)
        if (url === 'https://example.test/deepresearch-all-time-supervisor') {
          return new Response(`<html><title>DeepResearch supervisor architecture</title><body>${'Gap loop checks evidence coverage across the configured research scope before synthesis. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(input)

    expect(result.sources[0]?.canonicalUrl).toBe('https://example.test/deepresearch-all-time-supervisor')
    expect(result.sources[0]?.sourcePolicyTags).toContain('web_search')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('expands Dota 2 versus Counter-Strike esports searches and filters unrelated esports pages', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Dota 2 tournament ecosystem is anchored by The International and Major events, with prize-pool concentration shaping team incentives.',
        claimText: 'Dota 2赛事生态更依赖The International与Major形成的年度峰值叙事和奖金激励。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Dota 2', 'The International'],
        noteSummary: 'Dota 2 tournament ecosystem evidence.',
        implicationForBrief: '报告可以用TI/Major解释Dota 2赛事生态的商业和竞技结构。',
        limitations: []
      }, {
        sourceIndex: 2,
        evidenceText: 'Counter-Strike tournament ecosystem is distributed across Majors, ESL, BLAST, IEM and HLTV-tracked events.',
        claimText: 'Counter-Strike赛事生态更分布式，围绕Major、ESL、BLAST、IEM等赛事系列展开。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Counter-Strike', 'Major', 'ESL', 'BLAST', 'IEM'],
        noteSummary: 'Counter-Strike tournament ecosystem evidence.',
        implicationForBrief: '报告可以用分布式赛事体系解释CS的观众触点和商业节奏。',
        limitations: []
      }],
      unresolvedQuestions: [],
      suggestedNextQueries: []
    }))
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        [`Dota 2 Counter-Strike esports tournaments comparison prize pool viewership ${RECENT_YEAR_QUERY_SUFFIX}`]: [{
          url: 'https://example.test/kpl-lpl',
          title: 'KPL and LPL comparison',
          snippet: 'KPL and LPL are Chinese esports leagues unrelated to Dota 2 versus Counter-Strike.'
        }, {
          url: 'https://example.test/dota-cs-comparison',
          title: 'Dota 2 Counter-Strike esports tournaments comparison',
          snippet: 'Dota 2 and Counter-Strike tournament ecosystem, prize pool and viewership comparison'
        }]
      }
    })
    const fetchCalls: string[] = []
    const input: ResearchTaskWorkerInput = {
      ...makeWebWorkerInput(),
      task: {
        ...makeWebWorkerInput().task,
        objective: '对比 Dota 2 和 CS 电竞赛事生态、奖金、观众规模和竞技深度。',
        expectedEvidence: ['赛事体系', '奖金规模', '观众规模', '竞技深度'],
        searchHints: ['dota2 和 cs 电竞赛事对比'],
        maxSources: 3
      },
      brief: {
        ...makeWebWorkerInput().brief,
        topic: 'dota2 和 cs 电竞赛事对比',
        userIntent: '面向赛事爱好者，对比 Dota 2 和 Counter-Strike 的整体赛事生态。'
      },
      frame: {
        ...makeWebWorkerInput().frame,
        coreResearchThread: '两款游戏在赛事生态上的结构性差异如何影响商业价值、观众参与和竞技深度。',
        centralQuestion: 'Dota 2 和 Counter-Strike 电竞赛事生态有什么关键差异？',
        coreQuestions: [{ id: 'q1', text: 'Dota 2 和 Counter-Strike 电竞赛事生态有什么关键差异？', priority: 'high', required: true }],
        evidenceNeeded: ['TI、Major、ESL、BLAST、IEM 和观众数据'],
        disconfirmingEvidenceNeeded: ['不同年份赛事周期导致不可直接比较的证据']
      }
    }
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (request) => {
        const url = String(request)
        fetchCalls.push(url)
        if (url.includes('escharts.com/games/dota2')) {
          return new Response(`<html><title>Dota 2 Esports Charts</title><body>${'Dota 2 tournament ecosystem is anchored by The International and Major events, with prize-pool concentration shaping team incentives. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url.includes('escharts.com/games/csgo')) {
          return new Response(`<html><title>Counter-Strike Esports Charts</title><body>${'Counter-Strike tournament ecosystem is distributed across Majors, ESL, BLAST, IEM and HLTV-tracked events. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url === 'https://example.test/dota-cs-comparison') {
          return new Response(`<html><title>Dota 2 Counter-Strike esports comparison</title><body>${'Dota 2 and Counter-Strike tournament ecosystem comparison covers prize pool, viewership, Major and The International formats. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(input)
    const claimText = result.claims.map((claim) => claim.text).join('\n')

    expect(fetchCalls).not.toContain('https://example.test/kpl-lpl')
    expect(fetchCalls).toContain('https://example.test/dota-cs-comparison')
    expect(claimText).toContain('Dota 2')
    expect(claimText).toContain('Counter-Strike')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('searches per task and fetches search result pages before extraction', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: '搜索结果页面提供了中美经济结构比较所需的官方统计说明。',
        claimText: 'DeepResearch worker 会优先使用联网搜索结果页面补充任务证据。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['DeepResearch'],
        noteSummary: '联网搜索结果已进入证据抽取链路。',
        implicationForBrief: '任务证据不再只依赖静态 seed。',
        limitations: []
      }],
      unresolvedQuestions: [],
      suggestedNextQueries: []
    }))
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        [`中美经济结构 对比 ${RECENT_YEAR_QUERY_SUFFIX}`]: [{
          url: 'https://example.test/china-us-economy',
          title: 'China US economy comparison',
          snippet: 'official comparison source'
        }, {
          url: 'https://example.test/china-us-trade',
          title: 'China US trade comparison',
          snippet: 'trade comparison source'
        }]
      }
    })
    const fetchCalls: string[] = []
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (input) => {
        const url = String(input)
        fetchCalls.push(url)
        if (url === 'https://example.test/china-us-economy') {
          return new Response(`<html><title>Search source</title><body>${'搜索结果页面提供了中美经济结构比较所需的官方统计说明。'.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url === 'https://example.test/china-us-trade') {
          return new Response(`<html><title>Trade source</title><body>${'第二个搜索结果页面提供了中美贸易比较所需的官方统计说明。'.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(makeWebWorkerInput())

    expect(fetchCalls[0]).toBe('https://www.bea.gov/news/glance')
    expect(fetchCalls).toContain('https://example.test/china-us-economy')
    expect(result.sources[0]?.canonicalUrl).toBe('https://example.test/china-us-economy')
    expect(result.sources[0]?.sourcePolicyTags).toContain('web_search')
    expect(model.requests).toHaveLength(1)
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('keeps fetched web fallback cards informative when extraction JSON fails', async () => {
    const model = new FakeModelClient('not json')
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        [`A股 美股 交易规则 ${RECENT_YEAR_QUERY_SUFFIX}`]: [{
          url: 'https://example.test/a-us-trading-rules',
          title: 'A股与美股交易规则对比',
          snippet: 'T+1 versus T+0 trading rules'
        }, {
          url: 'https://example.test/a-us-index-allocation',
          title: '沪深300与标普500长期配置比较',
          snippet: 'CSI 300 and S&P 500 allocation comparison'
        }]
      }
    })
    const input: ResearchTaskWorkerInput = {
      ...makeWebWorkerInput(),
      task: {
        ...makeWebWorkerInput().task,
        objective: '比较A股与美股交易规则、指数配置和个人投资决策。',
        searchHints: ['A股 美股 交易规则'],
        maxSources: 4
      },
      brief: {
        ...makeWebWorkerInput().brief,
        topic: 'A股与美股对比',
        userIntent: '面向中国内地个人投资者，比较长期配置和选股差异。'
      },
      frame: {
        ...makeWebWorkerInput().frame,
        coreResearchThread: '核心主线是中国内地个人投资者如何在A股与美股之间做长期配置。',
        centralQuestion: 'A股与美股哪个更适合作为核心配置？'
      }
    }
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (request) => {
        const url = String(request)
        if (url === 'https://example.test/a-us-trading-rules') {
          return new Response(`<html><title>A股与美股交易规则对比</title><body>首页 登录 注册 下载APP 您的浏览器不被支持 Edge Chrome Firefox ${'A股通常采用T+1交易和涨跌幅限制，美股通常采用T+0交易且可使用更灵活的做空与衍生品工具。'.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url === 'https://example.test/a-us-index-allocation') {
          return new Response(`<html><title>沪深300与标普500长期配置比较</title><body>${'沪深300和标普500代表不同市场结构，长期配置需要同时比较指数成分、估值、行业集中度和监管披露环境。'.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(input)
    const claimText = result.claims.map((claim) => claim.text).join('\n')

    expect(claimText).toContain('T+1')
    expect(claimText).toContain('T+0')
    expect(claimText).toContain('沪深300')
    expect(result.claims.filter((claim) => claim.text.startsWith('交易规则')).length).toBeLessThan(result.claims.length)
    expect(claimText).not.toContain('提供了可追溯材料')
    expect(claimText).not.toContain('浏览器不被支持')
    expect(claimText).not.toContain('下载APP')
    expect(result.notes[0]?.summary).toContain('交易规则')
    expect(result.sources[0]?.sourcePolicyTags).toContain('fallback_structured')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('filters low-signal web extraction cards before they reach the evidence ledger', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Skip to main content An official website Toggle navigation Main navigation Data by Topic Data by Place',
        claimText: '可比口径：Skip to main content An official website Toggle navigation Main navigation Data by Topic',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['BEA'],
        noteSummary: 'Navigation chrome.',
        implicationForBrief: '该来源可用于回答内部任务，并服务于主线：不要进入报告。',
        limitations: []
      }, {
        sourceIndex: 2,
        evidenceText: 'A股通常采用T+1交易和涨跌幅限制，美股交易机制更灵活，投资者需要把交易制度差异纳入长期配置和风控。',
        claimText: '交易规则：A股T+1与涨跌幅限制、美股更灵活的交易制度，会影响个人投资者的配置和风控方式。',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['A股', '美股'],
        noteSummary: '交易制度差异影响配置和风控。',
        implicationForBrief: '交易制度差异会影响普通投资者在A股和美股之间的长期配置方式。',
        limitations: []
      }],
      unresolvedQuestions: [],
      suggestedNextQueries: []
    }))
    const input: ResearchTaskWorkerInput = {
      ...makeWebWorkerInput(),
      task: {
        ...makeWebWorkerInput().task,
        objective: '比较A股与美股交易规则对长期配置的影响。',
        searchHints: ['A股 美股 交易规则'],
        maxSources: 4
      },
      brief: {
        ...makeWebWorkerInput().brief,
        topic: 'A股与美股对比',
        userIntent: '面向中国内地个人投资者比较A股与美股。'
      },
      frame: {
        ...makeWebWorkerInput().frame,
        coreResearchThread: '普通个人投资者如何根据交易制度差异配置A股与美股。',
        centralQuestion: 'A股与美股哪个更适合作为核心配置？',
        coreQuestions: [{ id: 'q1', text: 'A股与美股哪个更适合作为核心配置？', priority: 'high', required: true }]
      }
    }
    const searchProvider = new DeterministicWebProvider({
      id: 'test-search',
      searchResults: {
        [`A股 美股 交易规则 ${RECENT_YEAR_QUERY_SUFFIX}`]: [{
          url: 'https://example.test/dirty-nav',
          title: 'Dirty navigation page',
          snippet: 'nav'
        }, {
          url: 'https://example.test/trading-rules',
          title: 'A股与美股交易规则对比',
          snippet: 'T+1 versus flexible trading'
        }]
      }
    })
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      webProvider: searchProvider,
      nowIso: () => '2026-06-29T00:00:00.000Z',
      timeoutMs: 1_000,
      fetchImpl: (async (request) => {
        const url = String(request)
        if (url === 'https://example.test/dirty-nav') {
          return new Response('<html><body>Skip to main content An official website Toggle navigation Main navigation Data by Topic</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url === 'https://example.test/trading-rules') {
          return new Response(`<html><body>${'A股通常采用T+1交易和涨跌幅限制，美股交易机制更灵活，投资者需要把交易制度差异纳入长期配置和风控。'.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(input)
    const claimText = result.claims.map((claim) => claim.text).join('\n')

    expect(result.claims).toHaveLength(1)
    expect(claimText).toContain('T+1')
    expect(claimText).not.toContain('Skip to main content')
    expect(result.notes.map((note) => note.implicationForBrief).join('\n')).not.toContain('该来源可用于回答')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('uses SEC and company seeds for semiconductor storage company comparisons', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'SEC submissions metadata identifies MICRON TECHNOLOGY INC with ticker MU on Nasdaq.',
        claimText: 'Micron can be analyzed as an independent listed company through official SEC filings.',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Micron Technology', 'MU'],
        noteSummary: 'Micron has official SEC filing metadata.',
        implicationForBrief: 'The report can compare Micron using public-company data.',
        limitations: []
      }, {
        sourceIndex: 2,
        evidenceText: 'SEC submissions metadata identifies Sandisk Corp with ticker SNDK on Nasdaq.',
        claimText: 'Sandisk has its own current SEC issuer metadata, so the research should not assume it only exists as a Western Digital brand.',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Sandisk', 'SNDK'],
        noteSummary: 'Sandisk has official SEC filing metadata.',
        implicationForBrief: 'The report should verify the current Sandisk entity before comparing investment value.',
        limitations: ['SEC submissions metadata alone does not provide a full valuation model.']
      }],
      unresolvedQuestions: ['仍需要补充最新财务指标。'],
      suggestedNextQueries: ['Micron Sandisk SEC filings comparison']
    }))
    const fetchCalls: string[] = []
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      timeoutMs: 1_000,
      fetchImpl: (async (input) => {
        const url = String(input)
        fetchCalls.push(url)
        if (url.includes('CIK0000723125')) {
          return new Response(JSON.stringify({
            name: 'MICRON TECHNOLOGY INC',
            tickers: ['MU'],
            exchanges: ['Nasdaq'],
            filings: { recent: { form: ['10-K', '10-Q'] } }
          }).repeat(12), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (url.includes('CIK0000106040')) {
          return new Response(JSON.stringify({
            name: 'WESTERN DIGITAL CORP',
            tickers: ['WDC'],
            exchanges: ['Nasdaq'],
            filings: { recent: { form: ['10-K', '10-Q'] } }
          }).repeat(12), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (url.includes('CIK0002023554')) {
          return new Response(JSON.stringify({
            name: 'Sandisk Corp',
            tickers: ['SNDK'],
            exchanges: ['Nasdaq'],
            filings: { recent: { form: ['10-K', '10-Q'] } }
          }).repeat(12), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(makeStorageWebWorkerInput())

    expect(fetchCalls.some((url) => url.includes('CIK0000723125'))).toBe(true)
    expect(fetchCalls.some((url) => url.includes('CIK0002023554'))).toBe(true)
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('CIK0002023554')
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('Sandisk Corp')
    expect(result.sources.map((source) => source.sourceType)).toEqual(['web', 'web'])
    expect(result.sources[0]?.sourcePolicyTags).toContain('sec')
    expect(result.sources[1]?.canonicalUrl).toContain('CIK0002023554')
    expect(result.unresolvedQuestions).toContain('仍需要补充最新财务指标。')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('prioritizes stock financial seeds for storage equity research', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Micron Technology stock profile includes market cap, revenue, financials, valuation and performance data.',
        claimText: 'Micron should be compared using public stock and financial metrics, not only company descriptions.',
        claimType: 'metric',
        confidence: 'high',
        critical: true,
        entities: ['Micron Technology', 'MU'],
        noteSummary: 'Micron has stock financial data available.',
        implicationForBrief: 'The report can rank storage equities by market cap and financial metrics.',
        limitations: []
      }, {
        sourceIndex: 6,
        evidenceText: 'SPDR S&P 500 ETF Trust benchmark profile provides an investable benchmark proxy for S&P 500 comparison.',
        claimText: 'SPY can be used as a benchmark proxy when comparing storage stock performance to the S&P 500.',
        claimType: 'fact',
        confidence: 'medium',
        critical: true,
        entities: ['SPY', 'S&P 500'],
        noteSummary: 'SPY benchmark source is available.',
        implicationForBrief: 'The report can compare storage equities against a broad-market benchmark.',
        limitations: ['SPY is an ETF proxy rather than the index itself.']
      }],
      unresolvedQuestions: ['仍需要补充分领域口径和市值排序。'],
      suggestedNextQueries: ['storage stocks market cap top five S&P 500 comparison']
    }))
    const fetchCalls: string[] = []
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      timeoutMs: 1_000,
      fetchImpl: (async (input) => {
        const url = String(input)
        fetchCalls.push(url)
        if (url.includes('stockanalysis.com/stocks/')) {
          return new Response(`<html><title>Stock financial snapshot</title><body>${'Market cap revenue financials valuation performance storage stock benchmark comparison. '.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url.includes('stockanalysis.com/etf/spy')) {
          return new Response(`<html><title>SPDR S&P 500 ETF Trust</title><body>${'SPY S&P 500 benchmark performance profile market comparison. '.repeat(30)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(makeStorageStockFinancialWebWorkerInput())

    expect(fetchCalls[0]).toContain('stockanalysis.com/stocks/mu')
    expect(fetchCalls[1]).toContain('stockanalysis.com/stocks/wdc')
    expect(fetchCalls[2]).toContain('stockanalysis.com/stocks/stx')
    expect(fetchCalls[5]).toContain('stockanalysis.com/etf/spy')
    expect(fetchCalls.some((url) => url.includes('data.sec.gov'))).toBe(false)
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('market cap')
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('SPDR S&P 500 ETF Trust')
    expect(result.sources[0]?.canonicalUrl).toContain('stockanalysis.com/stocks/mu')
    expect(result.sources[1]?.canonicalUrl).toContain('stockanalysis.com/etf/spy')
    expect(result.unresolvedQuestions).toContain('仍需要补充分领域口径和市值排序。')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('prioritizes product specification seeds for SSD technical comparisons', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        evidenceText: 'Micron says the Crucial P3 SSD delivers PCIe NVMe performance using Micron 3D NAND for consumer workloads.',
        claimText: 'Crucial P3/P5 research should be grounded in Micron product-specific sources, not only company filings.',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['Micron', 'Crucial P3'],
        noteSummary: 'Micron product source is available for Crucial SSD specifications.',
        implicationForBrief: 'The report can answer product technical questions from product-specific evidence.',
        limitations: []
      }, {
        sourceIndex: 2,
        evidenceText: 'SanDisk describes the Extreme Portable SSD as a product with headline read/write performance for portable storage use.',
        claimText: 'SanDisk Extreme product pages can support the Sandisk side of a consumer SSD technical comparison.',
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['SanDisk Extreme'],
        noteSummary: 'SanDisk product source is available for Extreme SSD specifications.',
        implicationForBrief: 'The report should compare product technical claims from both sides.',
        limitations: []
      }],
      unresolvedQuestions: ['仍需核对同容量版本。'],
      suggestedNextQueries: ['Crucial P3 P5 SanDisk Extreme SSD specs']
    }))
    const fetchCalls: string[] = []
    const worker = new SeededWebResearchTaskWorker({
      modelClient: model,
      model: 'fake-web-worker',
      timeoutMs: 1_000,
      fetchImpl: (async (input) => {
        const url = String(input)
        fetchCalls.push(url)
        if (url.includes('micron-ships-crucial-p3-plus')) {
          return new Response(`<html><title>Crucial P3</title><body>${'Micron Crucial P3 PCIe NVMe SSD product specifications with Micron 3D NAND and consumer SSD performance. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        if (url.includes('sandisk.com/products/ssd/external-ssd/portable-ssd-sandisk-extreme')) {
          return new Response(`<html><title>SanDisk Extreme Portable SSD</title><body>${'SanDisk Extreme Portable SSD official product specifications include portable SSD read and write performance. '.repeat(20)}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch
    })

    const result = await worker.runTask(makeStorageProductWebWorkerInput())

    expect(fetchCalls[0]).toContain('micron-ships-crucial-p3-plus')
    expect(fetchCalls[1]).toContain('sandisk.com/products/ssd/external-ssd/portable-ssd-sandisk-extreme')
    expect(fetchCalls.some((url) => url.includes('data.sec.gov'))).toBe(false)
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('Crucial P3')
    expect(JSON.stringify(model.requests[0]?.history ?? [])).toContain('SanDisk Extreme Portable SSD')
    expect(result.sources.map((source) => source.sourceType)).toEqual(['web', 'web'])
    expect(result.sources[0]?.sourcePolicyTags).toContain('product-spec')
    expect(result.sources[1]?.sourcePolicyTags).toContain('sandisk')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('turns model research cards into runtime-owned evidence ledger entries', async () => {
    const model = new FakeModelClient(JSON.stringify({
      evidenceCards: [{
        sourceTitle: '模型资料卡：中美经济结构',
        sourceType: 'web',
        reliability: 'medium',
        reliabilityReason: '基于常识性宏观经济框架，需要真实来源复核。',
        evidenceText: '中国经济更依赖制造业、出口和投资，美国经济更依赖消费、服务业和美元金融体系；该判断仍需外部数据复核。',
        claimText: '中美经济竞争的一个核心差异是中国偏制造与出口，美国偏消费、服务和金融。',
        claimType: 'inference',
        confidence: 'medium',
        critical: true,
        entities: ['中国', '美国'],
        noteSummary: '中美经济结构差异影响竞争方式。',
        implicationForBrief: '报告需要沿着经济结构差异解释贸易竞争和未来趋势。',
        limitations: ['未接入真实网页数据。']
      }],
      unresolvedQuestions: ['需要补充最新贸易数据。'],
      suggestedNextQueries: ['中美 2025 贸易结构 对比']
    }))
    const worker = new ModelResearchTaskWorker({
      modelClient: model,
      model: 'fake-worker',
      timeoutMs: 1_000
    })

    const result = await worker.runTask(makeWorkerInput())

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools).toEqual([])
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.sourceType).toBe('local_file')
    expect(result.sources[0]?.sourcePolicyTags).toContain('model_generated')
    expect(result.claims[0]?.supportSpanIds).toEqual([result.evidenceSpans[0]?.id])
    expect(result.notes[0]?.claimIds).toEqual([result.claims[0]?.id])
    expect(result.unresolvedQuestions).toContain('需要补充最新贸易数据。')
    expect(() => validateWorkerResult(result)).not.toThrow()
  })

  it('uses the model synthesis draft only when it cites known claim ids', async () => {
    const detailedFinding = '中美经济竞争不能只看单一总量指标，而要看增长结构、贸易关系、供应链重组和政策反应之间的组合关系。这个判断会改变报告的写法：它要求先说明比较口径，再说明哪些事实真正改变趋势，最后给出可复核的边界。'
    const model = new FakeModelClient([
      '# 中美经济与贸易对比\n',
      '\n## 摘要\n围绕核心主线回答：中美经济竞争的主要矛盾在于增长结构与供应链重组。 [claim:claim_1]\n',
      '\n## 调研范围与方法\n使用已确认 brief、notes 和 evidence ledger。\n',
      `\n## 主要发现\n### 发现一：中国偏制造与出口，美国偏消费、服务和金融。\n${detailedFinding.repeat(8)} [claim:claim_1]\n`,
      `\n### 发现二：供应链重组会放大两国增长结构差异。\n${detailedFinding.repeat(8)} [claim:claim_1]\n`,
      '\n## 结论与建议\n- 报告应围绕结构差异解释贸易竞争。 [claim:claim_1]\n',
      '\n## 局限与不确定性\n- P0 资料卡需要外部来源复核。\n',
      '\n## 后续研究建议\n- 接入真实宏观和贸易数据。\n'
    ].join(''))
    const writer = new ModelSynthesisWriter({
      modelClient: model,
      model: 'fake-writer',
      timeoutMs: 1_000
    })

    const draft = await writer.writeDraft(makeWriterInput())

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools).toEqual([])
    expect(draft.markdown).toContain('## 主要发现')
    expect(draft.markdown).not.toContain('## 摘要')
    expect(draft.markdown).not.toContain('## 调研范围与方法')
    expect(draft.markdown).not.toContain('## 核心问题与回答')
    expect(draft.markdown).not.toContain('## 证据链')
    expect(draft.claimIds).toEqual(['claim_1'])
  })

  it('falls back when a model synthesis draft omits claim citations', async () => {
    const model = new FakeModelClient('# Bad\n\n## 摘要\n没有引用。\n\n## 调研范围与方法\nx\n\n## 主要发现\nx\n\n## 结论与建议\nx\n\n## 局限与不确定性\nx\n')
    const writer = new ModelSynthesisWriter({
      modelClient: model,
      model: 'fake-writer',
      timeoutMs: 1_000
    })

    const draft = await writer.writeDraft(makeWriterInput())

    expect(model.requests).toHaveLength(1)
    expect(draft.markdown).toContain('[claim:claim_1]')
    expect(draft.claimIds).toContain('claim_1')
  })

  it('resolves multiple claim ids from one citation placeholder', () => {
    const resolver = new CitationResolver()
    const result = resolver.resolve({
      draft: {
        markdown: '两项事实都成立。 [claim:claim_1, claim:claim_2]',
        claimIds: ['claim_1', 'claim_2'],
        generatedAt: '2026-06-29T00:00:00.000Z'
      },
      reportPath: '/workspace/report.md',
      sources: [{
        id: 'source_1',
        sourceType: 'web',
        title: '测试来源',
        canonicalUrl: 'https://example.com',
        accessedAt: '2026-06-29T00:00:00.000Z',
        importedAt: '2026-06-29T00:00:00.000Z',
        reliability: 'high',
        reliabilityReason: '测试。',
        sourcePolicyTags: ['test'],
        fingerprint: 'fp_1',
        status: 'fetched'
      }],
      evidenceSpans: [{
        id: 'span_1',
        sourceId: 'source_1',
        text: '事实一。',
        textHash: 'hash_1',
        location: { headingPath: ['测试'], paragraphIndex: 1 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'rr_1'
      }, {
        id: 'span_2',
        sourceId: 'source_1',
        text: '事实二。',
        textHash: 'hash_2',
        location: { headingPath: ['测试'], paragraphIndex: 2 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'rr_1'
      }],
      claims: [{
        id: 'claim_1',
        text: '事实一成立。',
        entities: [],
        claimType: 'fact',
        supportSpanIds: ['span_1'],
        confidence: 'high',
        critical: true
      }, {
        id: 'claim_2',
        text: '事实二成立。',
        entities: [],
        claimType: 'fact',
        supportSpanIds: ['span_2'],
        confidence: 'high',
        critical: true
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(result.unresolvedCitationIds).toEqual([])
    expect(result.bindings).toHaveLength(2)
    expect(result.markdown).toContain('data-citation-id="cit_1"')
    expect(result.markdown).toContain('data-citation-id="cit_2"')
    expect(result.markdown).toContain('href="https://example.com"')
    expect(result.markdown).not.toContain('[^cit_1]:')
  })

  it('does not turn model fallback cards into visible citations', () => {
    const resolver = new CitationResolver()
    const result = resolver.resolve({
      draft: {
        markdown: '模型资料卡只能作为草稿背景。 [claim:claim_1]',
        claimIds: ['claim_1'],
        generatedAt: '2026-06-29T00:00:00.000Z'
      },
      reportPath: '/workspace/report.md',
      sources: [{
        id: 'source_model_fallback',
        sourceType: 'local_file',
        title: '模型资料卡',
        path: 'synthetic://deep-research/model-worker/rr_1/task_1/1',
        accessedAt: '2026-06-29T00:00:00.000Z',
        importedAt: '2026-06-29T00:00:00.000Z',
        reliability: 'low',
        reliabilityReason: '模型生成，待外部复核。',
        sourcePolicyTags: ['model_generated', 'requires_external_verification'],
        fingerprint: 'model_fallback',
        status: 'fetched',
        kind: 'model_fallback'
      }],
      evidenceSpans: [{
        id: 'span_1',
        sourceId: 'source_model_fallback',
        text: '模型资料卡内容。',
        textHash: 'hash_1',
        location: { paragraphIndex: 1 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'rr_1'
      }],
      claims: [{
        id: 'claim_1',
        text: '模型资料卡不能作为研究证据。',
        entities: [],
        claimType: 'fact',
        supportSpanIds: ['span_1'],
        confidence: 'low',
        critical: true
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(result.bindings).toHaveLength(0)
    expect(result.unresolvedCitationIds).toEqual(['model_fallback:claim:claim_1'])
    expect(result.markdown).not.toContain('data-citation-id')
    expect(result.markdown).not.toContain('<sup')
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

function makeWorkerInput(): ResearchTaskWorkerInput {
  return {
    runId: 'rr_1',
    task: {
      id: 'task_1',
      questionIds: ['q1'],
      objective: '调研中美经济竞争主线',
      expectedEvidence: ['经济结构差异', '贸易竞争'],
      sourceTypes: ['local_file'],
      searchHints: ['中美经济结构 对比'],
      maxSources: 3,
      priority: 'high',
      status: 'running'
    },
    brief: {
      id: 'brief_1',
      version: 1,
      topic: '中美经济与贸易对比',
      userIntent: '面向中文普通读者，解释两国经济竞争的主要矛盾。',
      outputFormat: 'Markdown 中文完整报告',
      sourcePolicy: { allowedSourceTypes: ['local_file'], requireCitations: true },
      successCriteria: ['回答核心问题。'],
      constraints: [],
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    frame: {
      coreResearchThread: '中美经济竞争的主要矛盾在于增长结构、贸易竞争和供应链重组。',
      centralQuestion: '中美经济竞争的主要矛盾在哪里？',
      coreQuestions: [{ id: 'q1', text: '中美经济竞争的主要矛盾在哪里？', priority: 'high', required: true }],
      investigationPath: ['确认范围', '收集资料', '写报告'],
      evidenceNeeded: ['经济结构证据'],
      disconfirmingEvidenceNeeded: ['竞争并非主要矛盾的证据'],
      nonGoals: []
    },
    budget: resolveResearchBudget({ reasoningEffort: 'medium', maxWorkers: 1, maxRounds: 1, maxSources: 3, timeoutMs: 30_000 })
  }
}

function makeWebWorkerInput(): ResearchTaskWorkerInput {
  return {
    ...makeWorkerInput(),
    task: {
      ...makeWorkerInput().task,
      sourceTypes: ['web', 'local_file'],
      maxSources: 4
    },
    brief: {
      ...makeWorkerInput().brief,
      sourcePolicy: { allowedSourceTypes: ['web', 'local_file'], requireCitations: true }
    }
  }
}

function makeStorageWebWorkerInput(): ResearchTaskWorkerInput {
  const input = makeWebWorkerInput()
  return {
    ...input,
    task: {
      ...input.task,
      objective: '从投资价值角度比较美光、闪迪和西部数据。',
      expectedEvidence: ['SEC 公司主体信息', '上市交易代码', '财务数据来源'],
      searchHints: ['Micron MU Sandisk SNDK Western Digital WDC SEC filings'],
      maxSources: 4
    },
    brief: {
      ...input.brief,
      topic: '美光和闪迪哪家公司更好',
      userIntent: '从个人投资决策角度，对美光科技和闪迪进行当前时点的快照比较。'
    },
    frame: {
      ...input.frame,
      coreResearchThread: '先确认 Micron、Sandisk、Western Digital 的当前上市主体和可比口径，再比较投资价值。',
      centralQuestion: '美光和闪迪能否作为独立投资标的直接比较？',
      coreQuestions: [{ id: 'q1', text: '美光和闪迪能否作为独立投资标的直接比较？', priority: 'high', required: true }],
      evidenceNeeded: ['SEC 公司主体和 ticker 信息'],
      disconfirmingEvidenceNeeded: ['闪迪不是独立上市主体的证据']
    }
  }
}

function makeStorageProductWebWorkerInput(): ResearchTaskWorkerInput {
  const input = makeWebWorkerInput()
  return {
    ...input,
    task: {
      ...input.task,
      objective: '调研 Micron Crucial P3/P5 与 SanDisk Extreme 消费级 SSD 的 NAND 类型、层数和读写性能差异。',
      expectedEvidence: ['Crucial P3/P5 产品规格', 'SanDisk Extreme 产品规格', 'SSD 读写性能'],
      searchHints: ['Crucial P3 P5 SanDisk Extreme SSD NAND performance specs'],
      maxSources: 4
    },
    brief: {
      ...input.brief,
      topic: 'micron sandisk difference：对比 Micron Crucial P3/P5 与 SanDisk Extreme 消费级 SSD',
      userIntent: '用于项目选型，只比较消费级 SSD 技术规格和性能。'
    },
    frame: {
      ...input.frame,
      coreResearchThread: '在消费级 SSD 技术选型中，Micron 原厂颗粒与 SanDisk 自研颗粒在 NAND 架构和实际性能上的差异。',
      centralQuestion: '两家在 NAND 闪存技术和实际性能表现上有何差异？',
      coreQuestions: [{ id: 'q1', text: '两家在 NAND 闪存技术和实际性能表现上有何差异？', priority: 'high', required: true }],
      evidenceNeeded: ['产品规格页和评测性能数据'],
      disconfirmingEvidenceNeeded: ['同系列不同容量或版本导致不可直接比较的证据']
    }
  }
}

function makeStorageStockFinancialWebWorkerInput(): ResearchTaskWorkerInput {
  const input = makeWebWorkerInput()
  return {
    ...input,
    task: {
      ...input.task,
      objective: '筛选美股存储板块市值前5的行业龙头，按细分领域分组，提供营收、利润、估值等详细财务指标并对比标普500。',
      expectedEvidence: ['市值排名', '营收和利润', '估值指标', '股票表现', 'S&P 500 对比'],
      searchHints: ['US storage stocks market cap top 5 financial metrics valuation S&P 500 comparison'],
      maxSources: 6
    },
    brief: {
      ...input.brief,
      topic: '美股存储股票有哪些几只：市值前5、财务指标、对比标普500',
      userIntent: '用于个人投资研究，需要中文详细报告，按细分领域筛选市值前5并对比标普500。'
    },
    frame: {
      ...input.frame,
      coreResearchThread: '围绕存储行业细分领域，先确定可比股票池和市值前5，再比较财务质量、估值和相对标普500表现。',
      centralQuestion: '美股存储板块市值前5的龙头中，哪些更值得关注？',
      coreQuestions: [{ id: 'q1', text: '美股存储板块市值前5的龙头中，哪些更值得关注？', priority: 'high', required: true }],
      evidenceNeeded: ['股票市值、财务指标、估值、价格表现和标普500基准数据'],
      disconfirmingEvidenceNeeded: ['市值排名或分领域口径不支持纳入某只股票的证据']
    }
  }
}

function makeWriterInput(): SynthesisWriterInput {
  const workerInput = makeWorkerInput()
  return {
    runId: workerInput.runId,
    brief: workerInput.brief,
    frame: workerInput.frame,
    plan: {
      id: 'plan_1',
      runId: workerInput.runId,
      rationale: '围绕核心主线执行。',
      tasks: [{ ...workerInput.task, status: 'done' }],
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    budget: workerInput.budget,
    sources: [{
      id: 'source_1',
      sourceType: 'local_file',
      title: '模型资料卡：中美经济结构',
      path: 'synthetic://test',
      accessedAt: '2026-06-29T00:00:00.000Z',
      importedAt: '2026-06-29T00:00:00.000Z',
      reliability: 'low',
      reliabilityReason: '测试资料卡。',
      sourcePolicyTags: ['model_generated'],
      fingerprint: 'fp_1',
      status: 'fetched'
    }],
    evidenceSpans: [{
      id: 'span_1',
      sourceId: 'source_1',
      text: '中国偏制造与出口，美国偏消费、服务和金融。',
      textHash: 'hash_1',
      location: { headingPath: ['测试'], paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: workerInput.runId
    }],
    claims: [{
      id: 'claim_1',
      text: '中美经济竞争的一个核心差异是中国偏制造与出口，美国偏消费、服务和金融。',
      entities: ['中国', '美国'],
      claimType: 'inference',
      supportSpanIds: ['span_1'],
      confidence: 'medium',
      critical: true
    }],
    notes: [{
      id: 'note_1',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: ['claim_1'],
      summary: '中美经济结构差异影响竞争方式。',
      implicationForBrief: '报告需要沿着经济结构差异解释贸易竞争和未来趋势。',
      confidence: 'medium',
      limitations: ['P0 资料卡需要外部复核。']
    }],
    nowIso: '2026-06-29T00:00:00.000Z'
  }
}
