import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  BasicCoverageEvaluator,
  buildCoverageContract,
  buildReportContract,
  conclusionSectionCoverageIssue,
  EvidenceStore,
  evaluateWritableGate,
  hashText,
  QualityVerifier,
  persistedEvidenceGapQuestionIds,
  reportProseQualityIssues,
  ResearchRuntime,
  ResearchRunRepository,
  resolveResearchBudget,
  type AtomicClaim,
  type CitationBinding,
  type EvidenceSpan,
  type ResearchBrief,
  type ResearchEvent,
  type ResearchFrame,
  type QualityJudge,
  type QualityJudgeInput,
  type QualityJudgeVerdict,
  type ResearchScopeAssessment,
  type ResearchTaskWorker,
  type ResearchNote,
  type DraftReport,
  type SourceRecord,
  type SynthesisWriter,
  type SynthesisWriterInput,
  type WorkerResult
} from '../src/research/index.js'
import { renderFinalReportMarkdown } from '../src/research/markdown/ReportRenderer.js'
import { SynthesisWriterFailed } from '../src/research/agents/SynthesisWriter.js'
import { ResearchExecutionController } from '../src/research/runtime/ResearchRuntimeExecution.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ResearchRuntime P0 flow', () => {
  it('renders runtime summary without heading leakage or broken sentence truncation', () => {
    const run = {
      brief: {
        topic: '对比 Cursor 和 Windsurf 的官方定价差异',
        userIntent: '回答个人开发者怎么选'
      },
      frame: {
        centralQuestion: '个人开发者应该选哪个，免费版/Pro 档是否够用',
        coreResearchThread: '在有限预算下平衡功能需求与付费意愿'
      }
    } as never
    const report = renderFinalReportMarkdown(run, [
      '# 对比 Cursor 和 Windsurf 的官方定价差异',
      '',
      '## 主要发现',
      '',
      '围绕“有限预算下如何平衡功能需求与付费意愿”这一主线，综合官方公开信息可得出初步结论：对于中高价格敏感的个人开发者，免费计划主要适合试用，月费 $20 的 Pro 档才是日常编码的自然起点。<sup data-citation-id="cit_1">[1]</sup>',
      '',
      '### 综合判断',
      '',
      '围绕“有限预算下如何平衡功能需求与付费意愿”这一主线，综合官方公开信息可得出初步结论：对于中高价格敏感的个人开发者，免费计划主要适合试用，月费 $20 的 Pro 档才是日常编码的自然起点。<sup data-citation-id="cit_1">[1]</sup>',
      '',
      '## 结论与建议',
      '',
      '建议先试用 Curosr，再根据 Agent 用量决定是否付费。。',
      '',
      '## 局限与不确定性',
      '',
      '官方没有量化全部请求限制。',
      '# 对比 Cursor 和 Windsurf ## 主要发现 ### 综合判断 重复整稿内容。'
    ].join('\n'), {
      generatedAt: '2026-07-08T00:00:00.000Z',
      sourceCount: 2,
      claimCount: 2
    })

    const summary = sectionText(report, '摘要')
    expect(summary).not.toContain('综合判断 围绕')
    expect(summary).not.toContain('而月费。')
    expect(summary).toContain('月费 $20 的 Pro 档才是日常编码的自然起点。')
    expect(summary).toContain('[1]')
    expect(summary).not.toContain('本报告围绕')
    expect(summary).not.toContain('下列核心事实')
    expect(report).toContain('[1]: #citation-1')
    expect(report).not.toContain('<sup')
    expect(report).not.toContain('Curosr')
    expect(report).not.toContain('本报告聚焦：')
    expect(report).not.toContain('围绕已确认问题综合可复核资料')
    expect(report).not.toContain('。。')
    expect(report).toContain('建议先试用 Cursor，再根据 Agent 用量决定是否付费。')
    expect(report).not.toContain('重复整稿内容')
    expect(report).toMatch(/## 主要发现\n\n### 综合判断/)
  })

  it('requires user brief approval before researching and writes the full artifact package', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const runtime = new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_test'),
      nowIso: sequenceTimes()
    })

    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: {
        maxWorkers: 1,
        maxRounds: 1,
        maxSources: 1,
        timeoutMs: 30_000
      }
    })

    expect(run.status).toBe('scoping')
    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/brief approval|scoping/i)
    await expect(runtime.approveBrief(run.id, {
      approvedByUser: true,
      briefHash: run.briefHash,
      source: 'api'
    })).rejects.toThrow(/awaiting confirmation|scoping/i)

    await runtime.confirmScope(run.id, {
      confirmedByUser: true,
      source: 'api',
      confirmationMessageId: 'scope_msg_1'
    })

    await expect(runtime.approveBrief(run.id, {
      approvedByUser: false,
      briefHash: run.briefHash,
      source: 'api'
    })).rejects.toThrow(/user/i)

    await runtime.approveBrief(run.id, {
      approvedByUser: true,
      briefHash: run.briefHash,
      source: 'api',
      approvalMessageId: 'msg_1'
    })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(completed.run.approval?.approvedByUser).toBe(true)
    expect(completed.resolvedReport.bindings.length).toBeGreaterThanOrEqual(1)
    expect(completed.resolvedReport.bindings.every((binding) => binding.evidenceSpanIds.includes('span_1'))).toBe(true)

    await expectFile(completed.run.artifacts.reportPath)
    expect(basename(completed.run.artifacts.reportPath)).toBe('DeepResearch-P0.md')
    await expectFile(completed.run.artifacts.briefPath)
    await expectFile(completed.run.artifacts.planPath)
    await expectFile(completed.run.artifacts.sourcesPath)
    await expectFile(completed.run.artifacts.notesPath)
    await expectFile(completed.run.artifacts.runJsonPath)
    await expectFile(completed.run.artifacts.evidenceJsonlPath)
    await expectFile(completed.run.artifacts.claimsJsonlPath)
    await expectFile(completed.run.artifacts.citationsJsonlPath)
    await expectFile(completed.run.artifacts.eventsJsonlPath)

    const report = await readFile(completed.run.artifacts.reportPath, 'utf-8')
    expect(report).not.toMatch(/^---\n/)
    expect(report).not.toContain('> 运行 ID：rr_test_1')
    expect(report).not.toContain('> 来源数量：1')
    expect(report).not.toContain('> 论断数量：1')
    expect(report).not.toContain('> 校验状态：通过')
    expect(report).not.toContain('> 需求匹配评分：0.92')
    expect(report).not.toContain('> 模型评审：通过 · 来源：LLM Judge · 模型：fake-judge · 总分 0.91')
    expect(report).not.toContain('> 报告完整度：0.90')
    expect(report).toContain('## 摘要')
    expect(report).toContain('## 调研范围与方法')
    expect(sectionText(report, '摘要').length).toBeLessThan(260)
    expect(sectionText(report, '调研范围与方法').length).toBeLessThan(220)
    expect(report).not.toContain('## 核心问题与回答')
    expect(report).toContain('## 主要发现')
    expect(report).not.toContain('## 证据链')
    expect(report).toContain('## 结论与建议')
    expect(report).toContain('## 局限与不确定性')
    expect(report).toContain('[1]')
    expect(report).toContain('[1]: #citation-1 "Fake local source"')
    expect(report).not.toContain('<sup')

    expect(completed.run.verification?.llmJudge?.source).toBe('llm_judge')
    expect(completed.run.verification?.scores.requirementsAlignment).toBe(0.92)

    const runJson = JSON.parse(await readFile(completed.run.artifacts.runJsonPath, 'utf-8')) as {
      status: string
      hypotheses?: unknown[]
      hypothesisTests?: unknown[]
      hypothesisEvidenceBindings?: unknown[]
      hypothesisUpdates?: unknown[]
      convergenceVerdicts?: unknown[]
      verification?: { llmJudge?: { source: string } }
    }
    expect(runJson.status).toBe('done')
    expect(runJson.hypotheses?.length).toBeGreaterThan(1)
    expect(runJson.hypothesisTests?.length).toBeGreaterThan(1)
    expect(runJson.hypothesisEvidenceBindings?.length).toBeGreaterThanOrEqual(1)
    expect(runJson.hypothesisUpdates?.length).toBeGreaterThanOrEqual(1)
    expect(runJson.convergenceVerdicts?.length).toBeGreaterThanOrEqual(1)
    expect(runJson.verification?.llmJudge?.source).toBe('llm_judge')

    const evidenceEntries = await repository.readJsonl(completed.run.artifacts.evidenceJsonlPath)
    const claims = await repository.readJsonl(completed.run.artifacts.claimsJsonlPath)
    const citations = await repository.readJsonl<CitationBinding>(completed.run.artifacts.citationsJsonlPath)
    const events = await repository.readJsonl<ResearchEvent>(completed.run.artifacts.eventsJsonlPath)

    expect(evidenceEntries).toHaveLength(3)
    expect(claims).toHaveLength(1)
    expect(citations).toHaveLength(completed.resolvedReport.bindings.length)
    expect(events.map((event) => event.type)).toEqual([
      'RUN_CREATED',
      'SCOPE_ASSESSED',
      'SCOPE_CONFIRMED',
      'BRIEF_PROPOSED',
      'BRIEF_APPROVED',
      'HYPOTHESES_PROPOSED',
      'HYPOTHESIS_TESTS_DESIGNED',
      'PLAN_CREATED',
      'TASK_STARTED',
      'SOURCE_ADDED',
      'NOTE_ADDED',
      'TASK_COMPLETED',
      'WORKER_RESULT_RECORDED',
      'RESEARCH_COMPLETED',
      'HYPOTHESIS_BINDINGS_CREATED',
      'HYPOTHESIS_ASSESSED',
      'GAP_CHECK_COMPLETED',
      'CONVERGENCE_ANALYZED',
      'REPORT_DRAFTED',
      'CITATIONS_RESOLVED',
      'VERIFICATION_COMPLETED',
      'REPORT_WRITTEN'
    ])
  })

  it('rejects worker outputs that try to write report prose', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new BadResearchTaskWorker(),
      idGenerator: sequenceIds('rr_bad_worker'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({ scope: makeScope(), brief: makeBrief(), frame: makeFrame(), budget: { maxWorkers: 1, maxSources: 1 } })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/final report prose field/i)
    expect(runtime.getRun(run.id)?.status).toBe('failed')
  })

  it('stops standard research before brief approval when no verifiable source capability exists', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new NoCapabilityResearchTaskWorker(),
      idGenerator: sequenceIds('rr_no_capability'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: {
        ...makeBrief(),
        sourcePolicy: {
          allowedSourceTypes: ['web', 'local_file'],
          minSourceCount: 2,
          maxSourceCount: 4,
          requireCitations: true
        }
      },
      frame: makeFrame(),
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })

    const unavailable = await runtime.confirmScope(run.id, {
      confirmedByUser: true,
      source: 'api'
    })

    expect(unavailable.status).toBe('research_unavailable')
    await expect(runtime.approveBrief(run.id, {
      approvedByUser: true,
      briefHash: unavailable.briefHash,
      source: 'api'
    })).rejects.toThrow(/awaiting confirmation|research_unavailable/i)
  })

  it('records model usage and cache telemetry in research events', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const runtime = new ResearchRuntime({
      repository,
      worker: new UsageResearchTaskWorker(),
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_usage'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { preset: 'quick', reasoningEffort: 'low', maxWorkers: 1, maxRounds: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    const events = await repository.readJsonl<ResearchEvent>(completed.run.artifacts.eventsJsonlPath)
    const usageEvent = events.find((event) => event.type === 'MODEL_USAGE_RECORDED')

    expect(usageEvent).toBeTruthy()
    if (usageEvent?.type === 'MODEL_USAGE_RECORDED') {
      expect(usageEvent.record.stage).toBe('worker')
      expect(usageEvent.record.usage.promptTokens).toBe(120)
      expect(usageEvent.record.usage.completionTokens).toBe(30)
      expect(usageEvent.record.usage.cacheHitTokens).toBe(80)
      expect(usageEvent.record.usage.cacheMissTokens).toBe(40)
      expect(usageEvent.record.usage.cacheHitRate).toBeCloseTo(80 / 120)
    }
  })

  it('interrupts an active worker when the user cancels the run', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new BlockingResearchTaskWorker()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      idGenerator: sequenceIds('rr_cancel_active'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, timeoutMs: 5_000 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completion = runtime.runConfirmedResearch(run.id)
    const rejected = expect(completion).rejects.toThrow(/用户主动取消/)
    await worker.started
    await runtime.cancelRun(run.id, '用户主动取消')
    await rejected

    expect(runtime.getRun(run.id)?.status).toBe('cancelled')
    expect(worker.abortCount).toBe(1)

    const retried = await runtime.retryFailedRun(run.id)
    expect(retried.status).toBe('planning')
    expect(retried.terminalReason).toBeUndefined()
  })

  it('enforces the total run timeout while a worker is active', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new BlockingResearchTaskWorker()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      idGenerator: sequenceIds('rr_timeout'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, timeoutMs: 20 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/research_timeout/)
    expect(runtime.getRun(run.id)?.status).toBe('failed')
    expect(worker.abortCount).toBe(1)
  })

  it('stops before a worker exceeds the model-call budget', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new ModelCallBudgetResearchTaskWorker(),
      idGenerator: sequenceIds('rr_model_call_budget'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, maxModelCalls: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/research_model_call_budget_exhausted/)
    expect(runtime.getRun(run.id)?.modelBudgetUsage.modelCalls).toBe(1)
  })

  it('keeps a separate completion allowance after discovery reaches its safety cap', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      idGenerator: sequenceIds('rr_completion_allowance'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxModelCalls: 128, maxTotalTokens: 4_000_000 }
    })
    run.reportContract = {
      createdAt: '2026-07-19T00:00:00.000Z',
      requiredSections: Array.from({ length: 9 }, (_, index) => ({
        id: `section_${index + 1}`,
        title: `Section ${index + 1}`,
        required: true,
        questionIds: [`q${index + 1}`],
        limitationFallback: 'Evidence boundary.'
      }))
    }
    run.modelBudgetUsage.modelCalls = 121
    const controller = new ResearchExecutionController()
    const execution = controller.start(run, async () => undefined, 30_000)

    expect(execution.remainingModelCalls()).toBe(7)
    expect(execution.remainingModelCalls('writer')).toBe(19)
    const reservations = Array.from({ length: 10 }, () => execution.reserveModelCall('writer', 1))
    expect(run.modelBudgetUsage.modelCalls).toBe(131)

    await Promise.all(reservations.map((reservation) => execution.releaseModelCall?.(reservation)))
    controller.stop(run.id)
  })

  it('stops after recorded usage exceeds the total-token budget', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new UsageResearchTaskWorker(),
      idGenerator: sequenceIds('rr_token_budget'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { preset: 'quick', reasoningEffort: 'low', maxWorkers: 1, maxSources: 1, maxTotalTokens: 100 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/research_token_budget_exhausted/)
    expect(runtime.getRun(run.id)?.modelBudgetUsage.totalTokens).toBe(150)
  })

  it('treats maxWorkers as a concurrency limit instead of truncating planned tasks', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new RecordingResearchTaskWorker()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_parallel'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: {
        ...makeBrief(),
        sourcePolicy: {
          ...makeBrief().sourcePolicy,
          maxSourceCount: 4
        }
      },
      frame: makeMultiQuestionFrame(),
      budget: {
        maxWorkers: 2,
        minSources: 3,
        targetSources: 3,
        maxRounds: 1,
        maxSources: 4,
        timeoutMs: 30_000
      }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(worker.taskIds).toEqual(['task_1', 'task_2', 'task_3'])
    expect(completed.run.plan?.tasks.every((task) => task.status === 'done')).toBe(true)
    expect(completed.run.gapVerdicts?.map((verdict) => verdict.status)).toEqual(['sufficient'])
    expect(completed.run.verification?.pass).toBe(true)
  })

  it('reclaims unused planned source budget when deciding follow-up research', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const frame = makeMultiQuestionFrame()
    const budget = resolveResearchBudget({
      preset: 'deep',
      reasoningEffort: 'max',
      maxSources: 100,
      minSources: 35,
      targetSources: 70,
      maxResearchRounds: 4,
      maxSubagents: 8
    })
    const verdict = await evaluator.evaluate({
      runId: 'rr_budget_reclaim',
      brief: makeBrief(),
      frame,
      plan: {
        id: 'plan_budget_reclaim',
        runId: 'rr_budget_reclaim',
        rationale: 'Initial plan reserved more source capacity than workers actually returned.',
        supervisor: {
          preset: 'deep',
          reasoningEffort: 'max',
          complexity: 'complex',
          parallelism: 5,
          maxResearchRounds: 4,
          targetSourceCount: 70,
          rationale: 'Budget reclaim regression test.'
        },
        tasks: Array.from({ length: 8 }, (_, index) => ({
          id: `task_${index + 1}`,
          questionIds: [frame.coreQuestions[index % frame.coreQuestions.length]?.id ?? 'q1'],
          objective: `Task ${index + 1}`,
          expectedEvidence: ['Evidence.'],
          sourceTypes: ['local_file'],
          searchHints: ['query'],
          maxSources: 12,
          priority: 'high',
          status: 'done'
        })),
        createdAt: '2026-06-29T00:00:00.000Z'
      },
      budget,
      roundIndex: 2,
      sources: Array.from({ length: 8 }, (_, index) => makeSourceRecord(`source_${index + 1}`)),
      evidenceSpans: [],
      claims: [],
      notes: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks.length).toBeGreaterThan(0)
    expect(verdict.stopReason).toContain('仍可继续发现新来源')
  })

  it('does not keep researching only to satisfy a configured global source total', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const frame = makeMultiQuestionFrame()
    const budget = resolveResearchBudget({
      preset: 'deep',
      reasoningEffort: 'max',
      maxSources: 100,
      minSources: 35,
      maxResearchRounds: 4,
      maxSubagents: 8
    })
    const sources = Array.from({ length: 10 }, (_, index) => makeSourceRecord(`covered_source_${index + 1}`))
    const evidenceSpans: EvidenceSpan[] = sources.map((source, index) => ({
      id: `covered_span_${index + 1}`,
      sourceId: source.id,
      text: `Covered evidence ${index + 1}: this deterministic local-file fixture provides enough structured evidence text for the coverage matrix to treat the related claim as usable.`,
      textHash: hashText(`covered_span_${index + 1}`),
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:02.000Z',
      extractorRunId: 'rr_global_source_deficit'
    }))
    const claims: AtomicClaim[] = evidenceSpans.map((span, index) => ({
      id: `covered_claim_${index + 1}`,
      text: `Covered claim ${index + 1}.`,
      entities: [],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const notes: ResearchNote[] = [
      makeResearchNoteForQuestion('q1', claims.slice(0, 3)),
      makeResearchNoteForQuestion('q2', claims.slice(3, 6)),
      makeResearchNoteForQuestion('q3', claims.slice(6, 9)),
      makeResearchNoteForQuestion('q4', claims.slice(9, 10))
    ]

    const verdict = await evaluator.evaluate({
      runId: 'rr_global_source_deficit',
      brief: makeBrief(),
      frame,
      plan: {
        id: 'plan_global_source_deficit',
        runId: 'rr_global_source_deficit',
        rationale: 'All questions are covered but the configured global source floor is still unmet.',
        tasks: [],
        createdAt: '2026-06-29T00:00:00.000Z'
      },
      budget,
      roundIndex: 2,
      sources,
      evidenceSpans,
      claims,
      notes,
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.status).toBe('sufficient')
    expect(verdict.followUpTasks).toEqual([])
    expect(verdict.missingEvidence).not.toContain('唯一来源总数 10 低于最低要求 35。')
    expect(verdict.coverageMatrix.totalSourceCount).toBe(10)
    expect(verdict.coverageMatrix.coveredRequiredQuestionCount).toBe(3)
  })

  it('tracks one unique source once instead of multiplying it across mapped questions', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const frame = makeMultiQuestionFrame()
    const source = makeSourceRecord('single_source')
    const span: EvidenceSpan = {
      id: 'single_span',
      sourceId: source.id,
      text: 'This structured source contains enough relevant evidence for every fixture question, but it is still only one unique source.',
      textHash: hashText('single_span'),
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:02.000Z',
      extractorRunId: 'rr_unique_source_floor'
    }
    const claim: AtomicClaim = {
      id: 'single_claim',
      text: 'One source can contain several relevant claims without becoming multiple independent sources.',
      entities: [],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const notes = frame.coreQuestions.map((question) => makeResearchNoteForQuestion(question.id, [claim]))

    const verdict = await evaluator.evaluate({
      runId: 'rr_unique_source_floor',
      brief: {
        ...makeBrief(),
        sourcePolicy: {
          ...makeBrief().sourcePolicy,
          minSourceCount: 2,
          maxSourceCount: 4
        }
      },
      frame,
      plan: {
        id: 'plan_unique_source_floor',
        runId: 'rr_unique_source_floor',
        rationale: 'One source is mapped to every question.',
        tasks: [],
        createdAt: '2026-06-29T00:00:00.000Z'
      },
      budget: resolveResearchBudget({ reasoningEffort: 'high', minSources: 2, maxSources: 4, maxResearchRounds: 2 }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes,
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.coverageMatrix.totalSourceCount).toBe(1)
    expect(verdict.coverageByQuestion.every((coverage) => coverage.sourceCount === 1)).toBe(true)
    expect(verdict.missingEvidence).not.toContain('唯一来源总数 1 低于最低要求 2。')
  })

  it('enforces source policy in the runtime instead of trusting worker output', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new DisallowedSourceResearchTaskWorker(),
      idGenerator: sequenceIds('rr_bad_source'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({ scope: makeScope(), brief: makeBrief(), frame: makeFrame(), budget: { maxWorkers: 1, maxSources: 1 } })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/disallowed source type/i)
    expect(runtime.getRun(run.id)?.status).toBe('failed')
  })

  it('retries empty extraction and stops only after the research loop is proven stagnant', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new EmptyResearchTaskWorker(),
      idGenerator: sequenceIds('rr_zero_sources'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: {
        maxWorkers: 1,
        maxSources: 4,
        minSources: 2,
        targetSources: 4,
        maxResearchRounds: 2,
        maxSynthesisRetries: 1
      }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/Research evidence collection failed/i)
    const failed = runtime.getRun(run.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.plan?.tasks.some((task) => task.status === 'done' && task.maxSources > 0)).toBe(true)
    expect(failed?.verification?.pass).toBe(false)
    expect(failed?.gapVerdicts?.length).toBeGreaterThanOrEqual(2)
    expect(failed?.gapVerdicts?.at(-1)?.status).toBe('unanswerable')
    expect(failed?.gapVerdicts?.at(-1)?.stopReason).toMatch(/检索死循环|检索停滞/u)
    await expectNoFile(failed?.artifacts.reportPath ?? '')
    expect(failed?.draftReportAvailable).not.toBe(true)
  })

  it('lets WritableGate write with limitations when citable evidence is weak but section coverage is complete', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_budget_gate'),
      nowIso: sequenceTimes()
    })
    const brief = makeBrief()
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: {
        ...brief,
        sourcePolicy: {
          ...brief.sourcePolicy,
          minSourceCount: 2,
          maxSourceCount: 2
        }
      },
      frame: makeFrame(),
      budget: {
        preset: 'standard',
        maxWorkers: 1,
        maxSources: 2,
        minSources: 2,
        targetSources: 2,
        maxResearchRounds: 1,
        maxSynthesisRetries: 1
      }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(completed.run.gapVerdicts?.at(-1)?.status).toBe('ready_with_limitations')
    expect(completed.run.gapVerdicts?.at(-1)?.stopReason).toContain('降置信')
    await expectFile(completed.run.artifacts.reportPath)
    expect(completed.run.draftReportAvailable).toBe(true)
  })

  it('blocks a report when judge requirement alignment and core-answer scores are catastrophically low', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new FailingQualityJudge(),
      idGenerator: sequenceIds('rr_bad_judge'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({ scope: makeScope(), brief: makeBrief(), frame: makeFrame(), budget: { maxWorkers: 1, maxSources: 1 } })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/报告没有按已确认需求输出/u)
    const failed = runtime.getRun(run.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.verification?.pass).toBe(false)
    expect(failed?.verification?.llmJudge?.pass).toBe(false)
    expect(failed?.verification?.scores.requirementsAlignment).toBe(0.2)
    expect(failed?.verification?.blockingIssues.join('\n')).toContain('报告没有按已确认需求输出')
  })

  it('retries a failed synthesis with persisted evidence instead of rerunning research tasks', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new FailOnceTerminalSynthesisWriter()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_retry_synthesis'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/simulated terminal writer failure/i)
    const evidenceBeforeRetry = await readFile(run.artifacts.evidenceJsonlPath, 'utf8')
    expect(runtime.getRun(run.id)?.status).toBe('failed')

    const retried = await runtime.retryFailedRun(run.id)
    expect(retried.status).toBe('planning')
    expect(retried.terminalReason).toBeUndefined()
    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(2)
    expect(await readFile(run.artifacts.evidenceJsonlPath, 'utf8')).toBe(evidenceBeforeRetry)
    await expectFile(completed.run.artifacts.reportPath)
  })

  it('keeps cumulative usage accounting while refreshing the safety budget on explicit retry', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: new FailOnceTerminalSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_retry_budget'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(), brief: makeBrief(), frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, maxModelCalls: 8, maxTotalTokens: 10_000 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })
    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/simulated terminal writer failure/i)

    run.modelBudgetUsage = { modelCalls: 8, totalTokens: 10_000, costUsd: 1, costCny: 7 }
    const retried = await runtime.retryFailedRun(run.id)

    expect(retried.modelBudgetUsage).toEqual({ modelCalls: 8, totalTokens: 10_000, costUsd: 1, costCny: 7 })
    expect(retried.attemptBudgetBaseline).toEqual({ modelCalls: 8, totalTokens: 10_000 })
  })

  it('drops unfinished verification repairs on retry and keeps completed evidence work', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_retry_writing'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(), brief: makeBrief(), frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 4 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })
    run.status = 'cancelled'
    run.plan = {
      id: 'plan_retry_writing', runId: run.id, rationale: '测试重试清理。', createdAt: run.createdAt,
      tasks: [{
        id: 'task_done', questionIds: ['q1'], objective: '已完成研究。', expectedEvidence: ['证据'],
        sourceTypes: ['local_file'], searchHints: [], maxSources: 1, priority: 'high', status: 'done'
      }, {
        id: 'verification_repair_1_1_1', questionIds: ['q1'], objective: '错误补研。', expectedEvidence: ['证据'],
        sourceTypes: ['web'], searchHints: [], maxSources: 1, priority: 'high', status: 'running'
      }, {
        id: 'verification_repair_1_1_2', questionIds: ['q1'], objective: '错误补研。', expectedEvidence: ['证据'],
        sourceTypes: ['web'], searchHints: [], maxSources: 1, priority: 'high', status: 'pending'
      }, {
        id: 'gap_3_coverage_1', questionIds: ['q1'], objective: '中断前的旧 Gap 补研。', expectedEvidence: ['证据'],
        sourceTypes: ['web'], searchHints: [], maxSources: 1, priority: 'high', status: 'running'
      }]
    }
    const retried = await runtime.retryFailedRun(run.id)

    expect(retried.plan?.tasks.map((task) => task.id)).toEqual(['task_done'])
    expect(retried.status).toBe('planning')
  })

  it('restores exhausted evidence questions from the persisted report blueprint', () => {
    const run = {
      reportBlueprint: {
        sections: [{ id: 'answered', questionIds: ['q_answered'], evidenceMode: 'direct' }, {
          id: 'gap', questionIds: ['q_gap', 'q_shared'], evidenceMode: 'evidence_gap'
        }, {
          id: 'conditional', questionIds: ['q_shared'], evidenceMode: 'conditional_application'
        }]
      }
    } as never

    expect([...persistedEvidenceGapQuestionIds(run)].sort()).toEqual(['q_gap', 'q_shared'])
  })

  it('restores evidence-gap authorization from stalled gap tasks without a prior blueprint', () => {
    const run = {
      gapVerdicts: [{
        status: 'unanswerable',
        exhaustedQuestionIds: ['q_repeated'],
        coverageByQuestion: [{ questionId: 'q_missing', required: true, priority: 'high', covered: false }]
      }]
    } as never

    expect([...persistedEvidenceGapQuestionIds(run)].sort()).toEqual(['q_missing', 'q_repeated'])
  })

  it('does not rewrite the report when the judge is unavailable', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new CountingSynthesisWriter()
    const judge = new UnavailableQualityJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_judge_unavailable'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, maxSynthesisRetries: 2 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
    expect(completed.run.verification?.llmJudge?.failureKind).toBe('judge_unavailable')
    expect(completed.run.verification?.warnings.join('\n')).toContain('LLM Judge')
  })

  it('treats judge wording as a writing issue unless deterministic issue codes require more evidence', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new CountingResearchTaskWorker()
    const writer = new CountingSynthesisWriter()
    const judge = new WordingOnlyFailingJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_judge_wording'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, minSources: 1, targetSources: 1, maxSources: 1, maxResearchRounds: 1, maxSynthesisRetries: 2 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(worker.calls).toBe(1)
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
    expect(completed.run.verification?.warnings.join('\n')).toContain('core question 与 trade-off')
  })

  it('does not start a rewrite loop when the judge changes subjective wording', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new CountingSynthesisWriter()
    const judge = new ShiftingWordingQualityJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_judge_state_loop'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
  })

  it('does not rewrite a changed draft for a subjective judge failure', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new ChangingSynthesisWriter()
    const judge = new TwoWordingFailuresThenPassingJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_judge_changed_draft'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
  })

  it('keeps improving judge scores advisory when local verification already passes', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new ChangingSynthesisWriter()
    const judge = new ImprovingWordingFailuresThenPassingJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_judge_improving_draft'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
  })

  it('keeps local draft validation retries independent from the single judge call', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new LocallyFailingThenPassingWriter()
    const judge = new WordingThenPassingJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_local_draft_retry'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, maxSynthesisRetries: 2 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(writer.calls).toBe(2)
    expect(writer.verificationAttempts).toEqual([undefined, undefined])
    expect(writer.previousDrafts).toEqual([undefined, undefined])
    expect(judge.calls).toBe(1)
  })

  it('does not replay a consumed model writer wave after its local repairs fail', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new ModelCallConsumingFailingWriter()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_consumed_draft_failure'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1, maxSynthesisRetries: 2 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/consumed draft wave failed/)
    expect(writer.calls).toBe(1)
  })

  it('does not replay the entire writer wave after an inner writer dead loop', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const writer = new TerminalDeadLoopWriter()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      synthesisWriter: writer,
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_terminal_writer_dead_loop'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { maxWorkers: 1, maxSources: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/section writer entered a repeated depth-repair dead loop/)
    expect(writer.calls).toBe(1)
  })

  it('does not trigger evidence repair from a subjective judge source request', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new CountingResearchTaskWorker()
    const writer = new CountingSynthesisWriter()
    const judge = new EvidenceRepairThenPassJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_refresh_after_repair'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: {
        preset: 'standard',
        minSources: 1,
        targetSources: 1,
        maxSources: 1,
        maxWorkers: 1,
        maxSubagents: 1,
        maxResearchRounds: 1,
        maxSynthesisRetries: 2
      }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(worker.calls).toBe(1)
    expect(judge.calls).toBe(1)
    expect(writer.calls).toBe(1)
    expect(completed.run.verification?.warnings.join('\n')).toContain('补充一个独立来源')
  })

  it('does not repeat search for a judge-only evidence gap', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new CountingResearchTaskWorker()
    const writer = new CountingSynthesisWriter()
    const judge = new RepeatedEvidenceGapJudge()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
      synthesisWriter: writer,
      qualityJudge: judge,
      idGenerator: sequenceIds('rr_evidence_quality_loop'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: {
        preset: 'standard',
        minSources: 1,
        targetSources: 1,
        maxSources: 1,
        maxWorkers: 1,
        maxSubagents: 1,
        maxResearchRounds: 1,
        maxSynthesisRetries: 2
      }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)
    expect(completed.run.status).toBe('done')
    expect(completed.run.verification?.warnings.join('\n')).toContain('真正独立且能改变分析的来源')
    expect(worker.calls).toBe(1)
    expect(writer.calls).toBe(1)
    expect(judge.calls).toBe(1)
  })

  it('QualityVerifier catches broken citations and missing evidence spans', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    const frame = makeFrame()
    const claim: AtomicClaim = {
      id: 'claim_missing_span',
      text: 'A critical claim needs support.',
      entities: [],
      claimType: 'fact',
      supportSpanIds: ['span_missing'],
      confidence: 'high',
      critical: true
    }
    const verdict = verifier.verify({
      brief,
      frame,
      plan: {
        id: 'plan_1',
        runId: 'run_1',
        rationale: 'test',
        createdAt: '2026-06-29T00:00:00.000Z',
        tasks: [{
          id: 'task_1',
          questionIds: ['q1'],
          objective: 'test',
          expectedEvidence: ['evidence'],
          sourceTypes: ['local_file'],
          searchHints: ['test'],
          maxSources: 1,
          priority: 'high',
          status: 'done'
        }]
      },
      budget: resolveResearchBudget({ maxWorkers: 1, maxRounds: 1, maxSources: 1, timeoutMs: 1_000 }),
      reportMarkdown: '# Broken\n\n## Executive Summary\n\nBroken claim [^missing]\n\n## Findings\n\nNo support.\n',
      notes: [],
      claims: [claim],
      evidenceSpans: [],
      citations: [{
        id: 'cit_1',
        reportPath: 'report.md',
        reportAnchor: 'claim:claim_missing_span:1',
        reportClaimText: claim.text,
        claimId: claim.id,
        evidenceSpanIds: ['span_missing'],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('不存在的引用绑定 missing')
    expect(verdict.blockingIssues.join('\n')).toContain('缺失的证据片段 span_missing')
    expect(verdict.blockingIssues.join('\n')).toContain('必要问题没有被调研笔记覆盖')
    expect(verdict.blockingIssues.join('\n')).toContain('关键论断缺少支持证据')
  })

  it('does not let an unused exploratory claim poison the published report', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    brief.sourcePolicy.requireCitations = false
    const frame = makeFrame()
    const claim: AtomicClaim = {
      id: 'claim_unused_exploratory',
      text: '搜索摘要生成但未进入报告的候选论断。',
      entities: [],
      claimType: 'fact',
      supportSpanIds: ['span_rejected'],
      confidence: 'low',
      critical: true
    }
    const verdict = verifier.verify({
      brief,
      frame,
      plan: { id: 'plan_1', runId: 'run_1', rationale: 'test', createdAt: '2026-07-11T00:00:00.000Z', tasks: [] },
      budget: resolveResearchBudget({ preset: 'quick', maxSources: 1 }),
      reportMarkdown: [
        '# Report',
        '## 摘要',
        frame.coreResearchThread,
        '## 调研范围与方法',
        '只验证最终报告与探索证据的边界。',
        '## 主要发现',
        '最终报告没有采用被淘汰的候选论断。',
        '## 结论',
        '发布校验只检查实际发布的论断。',
        '## 局限与不确定性',
        '当前测试不评价外部证据。'
      ].join('\n'),
      notes: [],
      claims: [claim],
      evidenceSpans: [],
      citations: [],
      unresolvedCitationIds: [],
      nowIso: '2026-07-11T00:00:00.000Z'
    })

    expect(verdict.issues.some((issue) => issue.code === 'critical_unsupported_claim')).toBe(false)
  })

  it('QualityVerifier accepts umbrella-question coverage already proven by the Gap matrix', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    brief.sourcePolicy.requireCitations = false
    const frame = makeFrame()
    const verdict = verifier.verify({
      brief,
      frame,
      plan: { id: 'plan_1', runId: 'run_1', rationale: 'test', createdAt: '2026-07-11T00:00:00.000Z', tasks: [] },
      budget: resolveResearchBudget({ preset: 'quick', maxSources: 1 }),
      reportMarkdown: [
        '# Report',
        '## 摘要',
        frame.coreResearchThread,
        '## 调研范围与方法',
        '仅验证覆盖矩阵复用。',
        '## 主要发现',
        '维度证据已经覆盖总问题。',
        '## 结论',
        '总问题由各维度共同回答。',
        '## 局限与不确定性',
        '当前测试只验证覆盖状态。'
      ].join('\n'),
      notes: [],
      claims: [],
      evidenceSpans: [],
      citations: [],
      gapVerdicts: [{
        status: 'sufficient',
        coverageByQuestion: [{ questionId: 'q1', covered: true }]
      } as never],
      unresolvedCitationIds: [],
      nowIso: '2026-07-11T00:00:00.000Z'
    })

    expect(verdict.issues.some((issue) => issue.code === 'required_question_uncovered')).toBe(false)
    expect(verdict.scores.answersCoreQuestions).toBe(1)
  })

  it('QualityVerifier treats an unmapped central question as synthesis over required sections', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    brief.sourcePolicy.requireCitations = false
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '两个对象的整体差异是什么？',
      coreResearchThread: '通过逐项比较形成整体判断。',
      coreQuestions: [{
        id: 'q_overall',
        text: '两个对象的整体差异是什么？',
        priority: 'high',
        required: true
      }, {
        id: 'q_detail',
        text: '在「运行机制」维度上，关键差异是什么？',
        priority: 'high',
        required: true
      }]
    }
    const reportContract = {
      requiredSections: [{
        id: 'detail',
        title: '运行机制',
        required: true,
        questionIds: ['q_detail'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-20T00:00:00.000Z'
    }
    const verdict = verifier.verify({
      brief,
      frame,
      reportContract,
      plan: { id: 'plan_synthesis_question', runId: 'run_synthesis_question', rationale: 'test', createdAt: '2026-07-20T00:00:00.000Z', tasks: [] },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 2 }),
      reportMarkdown: [
        '# Report',
        '## 摘要',
        '两个对象在运行机制上存在可验证差异，整体判断以该必答章节为基础。',
        '## 调研范围与方法',
        '逐项核验用户明确要求的比较维度。',
        '## 主要发现',
        '### 运行机制',
        '现有材料直接回答了运行机制差异。',
        '## 结论',
        '整体差异由运行机制章节的证据综合得出。',
        '## 局限与不确定性',
        '当前只覆盖运行机制，未覆盖其他未请求维度。'
      ].join('\n'),
      notes: [{
        id: 'note_detail',
        taskId: 'task_detail',
        questionIds: ['q_detail'],
        claimIds: [],
        summary: '运行机制已经调研。',
        implicationForBrief: '用于整体综合。',
        confidence: 'medium',
        limitations: []
      }],
      claims: [],
      evidenceSpans: [],
      citations: [],
      unresolvedCitationIds: [],
      nowIso: '2026-07-20T00:00:00.000Z'
    })

    expect(verdict.issues.filter((issue) => issue.code === 'required_question_uncovered')).toEqual([])
    expect(verdict.scores.answersCoreQuestions).toBe(1)
  })

  it('QualityVerifier accepts citable weak coverage explicitly admitted with limitations by Gap', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    brief.sourcePolicy.requireCitations = false
    const frame = makeFrame()
    const verdict = verifier.verify({
      brief,
      frame,
      plan: { id: 'plan_weak', runId: 'run_weak', rationale: 'test', createdAt: '2026-07-12T00:00:00.000Z', tasks: [] },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 4 }),
      reportMarkdown: [
        '# Report',
        '## 摘要',
        frame.coreResearchThread,
        '## 调研范围与方法',
        '当前章节使用可引用但质量较弱的网页证据，并明确保留结论边界。',
        '## 主要发现',
        '弱证据章节只能给出谨慎判断，不能外推到当前来源未覆盖的对象。',
        '## 结论',
        '现有证据允许形成带限制的局部结论，但不足以支持绝对判断。',
        '## 局限与不确定性',
        '现有证据缺少高可靠网页来源，后续需要继续交叉核验。'
      ].join('\n'),
      notes: [],
      claims: [],
      evidenceSpans: [],
      citations: [],
      gapVerdicts: [{
        status: 'ready_with_limitations',
        coverageByQuestion: [{
          questionId: 'q1',
          covered: false,
          noteCount: 1,
          claimCount: 2,
          requiredClaimCount: 2,
          sourceCount: 1,
          strongWebSourceCount: 0,
          requiredStrongWebSourceCount: 1
        }]
      } as never],
      unresolvedCitationIds: [],
      nowIso: '2026-07-12T00:00:00.000Z'
    })

    expect(verdict.issues.some((issue) => issue.code === 'required_question_uncovered')).toBe(false)
    expect(verdict.scores.answersCoreQuestions).toBe(1)
  })

  it('QualityVerifier rejects model fallback citations as research evidence', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    const frame = makeFrame()
    const source: SourceRecord = {
      id: 'source_model_fallback',
      sourceType: 'local_file',
      title: '模型资料卡',
      path: 'synthetic://deep-research/model-worker/rr_1/task_1/1',
      accessedAt: '2026-06-29T00:00:00.000Z',
      importedAt: '2026-06-29T00:00:00.000Z',
      reliability: 'low',
      reliabilityReason: '模型生成，待外部来源复核。',
      sourcePolicyTags: ['model_generated', 'requires_external_verification'],
      fingerprint: 'model_fallback',
      status: 'fetched',
      kind: 'model_fallback'
    }
    const span: EvidenceSpan = {
      id: 'span_model_fallback',
      sourceId: source.id,
      text: '模型根据内置知识生成的资料卡。',
      textHash: 'hash_model_fallback',
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: 'rr_1'
    }
    const claim: AtomicClaim = {
      id: 'claim_model_fallback',
      text: '模型资料卡不能作为 DeepResearch 的可核验引用。',
      entities: ['DeepResearch'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'low',
      critical: true
    }

    const verdict = verifier.verify({
      brief,
      frame,
      plan: {
        id: 'plan_1',
        runId: 'run_1',
        rationale: 'test',
        createdAt: '2026-06-29T00:00:00.000Z',
        tasks: [{
          id: 'task_1',
          questionIds: ['q1'],
          objective: 'test',
          expectedEvidence: ['evidence'],
          sourceTypes: ['local_file'],
          searchHints: ['test'],
          maxSources: 1,
          priority: 'high',
          status: 'done'
        }]
      },
      budget: resolveResearchBudget({ maxWorkers: 1, maxRounds: 1, maxSources: 1, timeoutMs: 1_000 }),
      reportMarkdown: [
        '# Model fallback',
        '',
        `## 摘要\n${frame.coreResearchThread}。`,
        '',
        '## 调研范围与方法\n验证模型资料卡不能替代真实证据。',
        '',
        `## 主要发现\n${'模型资料卡只能帮助组织草稿，不能满足研究引用要求。'.repeat(80)} <sup data-citation-id="cit_1">[1]</sup>`,
        '',
        '## 结论\n必须补充真实来源。',
        '',
        '## 局限与不确定性\n当前只有模型资料卡。'
      ].join('\n'),
      notes: [{
        id: 'note_1',
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: [claim.id],
        summary: 'Model fallback is not evidence.',
        implicationForBrief: 'Runtime must block fallback citations.',
        confidence: 'low',
        limitations: ['缺少真实来源。']
      }],
      sources: [source],
      claims: [claim],
      evidenceSpans: [span],
      citations: [{
        id: 'cit_1',
        reportPath: 'report.md',
        reportAnchor: 'claim:claim_model_fallback:1',
        reportClaimText: claim.text,
        claimId: claim.id,
        evidenceSpanIds: [span.id],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('模型生成资料卡')
    expect(verdict.blockingIssues.join('\n')).toContain('报告缺少引用绑定')
    expect(verdict.scores.citationAccuracy).toBe(0)
  })

  it('detects unfinished conclusions, vague caveats, and uncited recommendations', () => {
    const issues = reportProseQualityIssues([
      '# Report',
      '## 结论',
      '核心判断仍需明确；',
      '## 局限与不确定性',
      '1. 这并不影响核心结论。',
      '2. 建议参考其他外部规范。'
    ].join('\n'))

    expect(issues).toHaveLength(3)
    expect(reportProseQualityIssues([
      '# Report',
      '## 结论',
      '核心判断已经完整收束。',
      '## 局限与不确定性',
      '当前证据只覆盖一个官方来源，因此跨实现差异尚未验证。'
    ].join('\n'))).toEqual([])
  })

  it('detects broken conclusion connectives', () => {
    const issues = reportProseQualityIssues([
      '# 缓存报告',
      '## 结论',
      '综合来看，而 this paragraph pastes a long foreign evidence excerpt directly into the Chinese report without synthesis and keeps adding enough English words to cross the quality threshold for a deterministic regression check.',
      '## 局限与不确定性',
      '当前证据仅覆盖官方文档。'
    ].join('\n'))

    expect(issues.join('\n')).toContain('转折连接')
  })

  it('detects dangling synthesis and repeated paragraphs inside one core section', () => {
    const issues = reportProseQualityIssues([
      '# 对比报告',
      '',
      '## 主要发现',
      '',
      '### 监管差异',
      '',
      '区别在于，第一种机制强调主动审核 [1]',
      '',
      '现有证据仅覆盖两种机制的明示要求，不能据此外推。',
      '',
      '现有证据仅覆盖两种机制的明示要求，不能据此外推。',
      '',
      '## 结论',
      '',
      '当前结论只覆盖已引用机制。',
      '',
      '## 局限与不确定性',
      '',
      '现有材料未覆盖执行效果。'
    ].join('\n'))

    expect(issues.join('\n')).toContain('悬空句')
    expect(issues.join('\n')).toContain('重复发布')
  })

  it('requires a multi-section report conclusion to synthesize at least three evidence sections', () => {
    const sentenceA = '第一章确认了结构差异。'
    const sentenceB = '第二章确认了制度差异。'
    const sentenceC = '第三章确认了参与者差异。'
    const bindings = [sentenceA, sentenceB, sentenceC].map((reportClaimText, index): CitationBinding => ({
      id: `cit_${index + 1}`,
      displayId: String(index + 1),
      reportPath: 'report.md',
      reportAnchor: `claim:claim_${index + 1}:1`,
      reportClaimText,
      claimId: `claim_${index + 1}`,
      evidenceSpanIds: [`span_${index + 1}`],
      status: 'verified',
      verifiedAt: '2026-07-19T00:00:00.000Z'
    }))
    const blueprint = {
      reportType: 'comparison' as const,
      title: '通用对比',
      directAnswer: '需要跨章节综合。',
      thesis: '单章事实不能替代整体答案。',
      sections: Array.from({ length: 4 }, (_, index) => ({
        id: `section_${index + 1}`,
        title: `维度${index + 1}`,
        purpose: '回答对应维度。',
        questionIds: [`q${index + 1}`],
        claimIds: [`claim_${index + 1}`],
        sourceIds: [`source_${index + 1}`],
        evidenceMode: 'direct' as const,
        argument: {
          conclusion: '形成局部结论。',
          claimIds: [`claim_${index + 1}`],
          inference: '解释局部事实。',
          conditions: [],
          counterClaimIds: []
        },
        limitations: []
      })),
      createdAt: '2026-07-19T00:00:00.000Z'
    }
    const base = {
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 8 }),
      reportBlueprint: blueprint,
      citations: bindings
    }

    expect(conclusionSectionCoverageIssue({
      ...base,
      reportMarkdown: `## 结论\n\n${sentenceA} [1]\n\n${sentenceB} [2]\n\n现有证据未覆盖其他情形。`
    })).toContain('只综合了 2 个')
    expect(conclusionSectionCoverageIssue({
      ...base,
      reportMarkdown: `## 结论\n\n${sentenceA} [1]\n\n${sentenceB} [2]\n\n${sentenceC} [3]\n\n现有证据未覆盖其他情形。`
    })).toBeUndefined()
  })

  it('QualityVerifier blocks an empty limitations section and extracted page metadata', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    brief.sourcePolicy.requireCitations = false
    const frame = makeFrame()
    const verdict = verifier.verify({
      brief,
      frame,
      plan: { id: 'plan_1', runId: 'run_1', rationale: 'test', createdAt: '2026-07-11T00:00:00.000Z', tasks: [] },
      budget: resolveResearchBudget({ preset: 'quick', maxSources: 1 }),
      reportMarkdown: [
        '# Report', '## 摘要', frame.coreResearchThread, '## 调研范围与方法', '检查报告。',
        '## 主要发现', 'Header type Response header Forbidden request header No Syntax http ETag。',
        '## 结论', '直接结论。', '## 局限与不确定性'
      ].join('\n'),
      notes: [{ id: 'note_1', taskId: 'task_1', questionIds: ['q1'], claimIds: [], summary: 'covered', implicationForBrief: 'covered', confidence: 'high', limitations: [] }],
      claims: [],
      evidenceSpans: [],
      citations: [],
      unresolvedCitationIds: [],
      nowIso: '2026-07-11T00:00:00.000Z'
    })
    expect(verdict.issues.some((issue) => issue.code === 'report_contains_extraction_boilerplate')).toBe(true)
    expect(verdict.issues.some((issue) => issue.code === 'empty_limitations')).toBe(true)
  })

  it('QualityVerifier requires evidence in final conclusions even when findings have citations', () => {
    const verifier = new QualityVerifier()
    const brief = makeBrief()
    const frame = makeFrame()
    const source: SourceRecord = {
      id: 'source_1',
      sourceType: 'local_file',
      title: 'Runtime verification notes',
      path: '/fake/runtime-verification.md',
      accessedAt: '2026-06-29T00:00:00.000Z',
      importedAt: '2026-06-29T00:00:00.000Z',
      reliability: 'high',
      reliabilityReason: 'Synthetic test source.',
      sourcePolicyTags: ['fake-corpus'],
      fingerprint: 'source_1',
      status: 'fetched'
    }
    const span: EvidenceSpan = {
      id: 'span_1',
      sourceId: source.id,
      text: 'Kun DeepResearch uses approval, evidence binding, citation resolution and verification before it writes a final report package.',
      textHash: 'span_1',
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: 'run_1'
    }
    const claim: AtomicClaim = {
      id: 'claim_1',
      text: 'Kun DeepResearch enforces approval, evidence binding and verification before report completion.',
      entities: ['Kun DeepResearch'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const reportMarkdown = [
      '# DeepResearch P0',
      '',
      `## 摘要\n${frame.coreResearchThread}。`,
      '',
      '## 调研范围与方法\n验证运行时是否用证据和校验约束报告生成。',
      '',
      `## 主要发现\n${frame.coreResearchThread}。${'运行时先确认 brief，再收集结构化证据，随后解析引用并执行质量校验；这些步骤共同防止报告绕过证据链直接完成。'.repeat(35)} <sup data-citation-id="cit_1">[1]</sup>`,
      '',
      '## 结论\n继续观察。',
      '',
      '## 局限与不确定性\n仍需在真实模型和真实来源下复核。'
    ].join('\n')

    const verdict = verifier.verify({
      brief,
      frame,
      plan: {
        id: 'plan_1',
        runId: 'run_1',
        rationale: 'test',
        createdAt: '2026-06-29T00:00:00.000Z',
        tasks: [{
          id: 'task_1',
          questionIds: ['q1'],
          objective: 'test',
          expectedEvidence: ['evidence'],
          sourceTypes: ['local_file'],
          searchHints: ['test'],
          maxSources: 1,
          priority: 'high',
          status: 'done'
        }]
      },
      budget: resolveResearchBudget({ reasoningEffort: 'high', maxWorkers: 1, maxRounds: 1, maxSources: 1, timeoutMs: 1_000 }),
      reportMarkdown,
      notes: [{
        id: 'note_1',
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: [claim.id],
        summary: 'Runtime verification is covered.',
        implicationForBrief: 'The report must explain the runtime completion gate.',
        confidence: 'high',
        limitations: ['Synthetic test source.']
      }],
      sources: [source],
      claims: [claim],
      evidenceSpans: [span],
      citations: [{
        id: 'cit_1',
        reportPath: 'report.md',
        reportAnchor: 'claim:claim_1:1',
        reportClaimText: claim.text,
        claimId: claim.id,
        evidenceSpanIds: [span.id],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('报告结论与建议没有引用任何已解析证据')
    expect(verdict.issues.some((issue) => issue.code === 'report_too_short')).toBe(false)
  })

  it('keeps the central question attached when one explicit detail section carries the whole answer', () => {
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '两个指令的具体含义、差异及其对存储、验证和复用的影响是什么？',
      coreResearchThread: '解释两个指令如何分别约束存储、验证和复用。',
      coreQuestions: [
        {
          id: 'q1',
          text: '两个指令的具体含义、差异及其对存储、验证和复用的影响是什么？',
          priority: 'high',
          required: true
        },
        {
          id: 'q2',
          text: '在「指令 A 与指令 B」维度上，关键事实、作用机制、风险和适用边界是什么？',
          priority: 'high',
          required: true
        }
      ]
    }

    const contract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-14T00:00:00.000Z'
    })

    expect(contract.requiredSections).toHaveLength(1)
    expect(contract.requiredSections[0]?.title).toBe('指令 A 与指令 B')
    expect(contract.requiredSections[0]?.questionIds).toEqual(['q1', 'q2'])
  })

  it('does not discard the first required dimension when the umbrella question is not a core question', () => {
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '这些维度共同支持什么总体判断？',
      coreResearchThread: '分别回答每个明确维度，再形成总体判断。',
      coreQuestions: [
        { id: 'q_history', text: '在「历史变化」维度上，事实和边界是什么？', priority: 'high', required: true },
        { id: 'q_driver', text: '在「影响因素」维度上，哪些因素直接影响结果？', priority: 'high', required: true },
        { id: 'q_risk', text: '在「主要风险」维度上，风险和不确定性是什么？', priority: 'high', required: true },
        { id: 'q_outlook', text: '在「未来趋势」维度上，证据支持什么条件判断？', priority: 'high', required: true }
      ]
    }

    const contract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-18T00:00:00.000Z'
    })

    expect(contract.requiredSections.map((section) => section.title)).toEqual([
      '历史变化',
      '影响因素',
      '主要风险',
      '未来趋势'
    ])
    expect(contract.requiredSections[0]?.questionIds).toEqual(['q_history'])
  })

  it('WritableGate keeps both explicit facets when one section carries the central answer', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: 'no-cache 与 no-store 在存储、验证和复用上有什么区别？',
      coreResearchThread: '解释 no-cache 与 no-store 对缓存生命周期的不同约束。',
      coreQuestions: [{
        id: 'q1',
        text: 'no-cache 与 no-store 在存储、验证和复用上有什么区别？',
        priority: 'high',
        required: true
      }, {
        id: 'q2',
        text: '在「no-cache 与 no-store」维度上，关键事实、作用机制和适用边界是什么？',
        priority: 'high',
        required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_single_section_facets'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 8 }
    })
    run.reportContract = buildReportContract({ brief: run.brief, frame, nowIso: '2026-07-14T00:00:00.000Z' })
    const sources = [makeSourceRecord('source_no_cache'), makeSourceRecord('source_no_store')]
    const facts = [
      ['no_cache_store', 0, 'no-cache allows a cache to store a response but requires validation before reuse.'],
      ['no_cache_validate', 0, 'A stored no-cache response must be validated with the origin before each reuse.'],
      ['no_cache_history', 0, 'The no-cache directive does not cover every browser history navigation behavior.'],
      ['no_store_store', 1, 'no-store instructs the cache not to store the response for later reuse.']
    ] as const
    const spans: EvidenceSpan[] = facts.map(([id, sourceIndex, text], index) => ({
      id: `span_${id}`,
      sourceId: sources[sourceIndex]!.id,
      text,
      textHash: `hash_${id}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-07-14T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = facts.map(([id, , text]) => ({
      id: `claim_${id}`,
      text,
      entities: id.startsWith('no_store') ? ['no-store'] : ['no-cache'],
      claimType: 'fact',
      supportSpanIds: [`span_${id}`],
      confidence: 'high',
      critical: true
    }))

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes: [{
        id: 'note_cache_directives',
        taskId: 'task_cache_directives',
        questionIds: ['q1', 'q2'],
        claimIds: claims.map((claim) => claim.id),
        summary: 'Both directives have directly supported facts.',
        implicationForBrief: 'The report must distinguish storage from validation before reuse.',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-07-14T00:00:00.000Z'
    })

    expect(gate.ok).toBe(true)
    expect(gate.sectionEvidenceMap).toHaveLength(1)
    expect(gate.sectionEvidenceMap[0]?.questionIds).toEqual(['q1', 'q2'])
    expect(gate.sectionEvidenceMap[0]?.claimIds).toContain('claim_no_cache_store')
    expect(gate.sectionEvidenceMap[0]?.claimIds).toContain('claim_no_store_store')
    expect(gate.sectionEvidenceMap[0]?.sourceIds).toEqual(expect.arrayContaining(sources.map((source) => source.id)))
  })

  it('WritableGate preserves partial direct evidence for a compound section as a limited answer', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '准入与退出机制目前能确认什么？',
      coreResearchThread: '分别核验准入和退出机制。',
      coreQuestions: [{
        id: 'q_compound',
        text: '在「准入与退出机制」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_partial_compound'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'compound',
        title: '准入与退出机制',
        required: true,
        questionIds: ['q_compound'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-20T00:00:00.000Z'
    }
    run.coverageContract = buildCoverageContract({
      brief: run.brief,
      frame,
      reportContract: run.reportContract,
      nowIso: '2026-07-20T00:00:00.000Z'
    })
    const source = makeSourceRecord('source_entry')
    const span: EvidenceSpan = {
      id: 'span_entry',
      sourceId: source.id,
      text: '准入规则要求申请者提交完整记录，并由独立机构完成资格审核。',
      textHash: 'span-entry',
      location: { paragraphIndex: 1 },
      extractedAt: '2026-07-20T00:00:00.000Z',
      extractorRunId: run.id
    }
    const claim: AtomicClaim = {
      id: 'claim_entry',
      text: span.text,
      entities: ['准入规则'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [{
        id: 'note_entry',
        taskId: 'task_entry',
        questionIds: ['q_compound'],
        claimIds: [claim.id],
        summary: claim.text,
        implicationForBrief: '只覆盖准入分面。',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-07-20T00:00:00.000Z',
      coverageContract: run.coverageContract,
      allowEvidenceGapQuestionIds: new Set(['q_compound'])
    })

    expect(gate.ok).toBe(true)
    expect(gate.status).toBe('ready_with_limitations')
    expect(gate.sectionEvidenceMap[0]).toMatchObject({ status: 'weak', evidenceMode: 'direct' })
    expect(gate.sectionEvidenceMap[0]?.claimIds).toContain(claim.id)
    expect(gate.sectionEvidenceMap[0]?.limitations.join('\n')).toContain('未独立覆盖全部分面')
    expect(gate.sectionEvidenceMap[0]?.limitations.join('\n')).not.toContain('不足以形成可靠结论')
  })

  it('WritableGate does not remap an explicitly assigned claim into a sibling question', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '分别核验收入表现与产品风险。',
      coreResearchThread: '收入和风险必须使用各自的直接证据。',
      coreQuestions: [{
        id: 'q_income', text: '在「收入表现」维度上，关键事实是什么？', priority: 'high', required: true
      }, {
        id: 'q_risk', text: '在「产品风险」维度上，主要风险是什么？', priority: 'high', required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_explicit_assignment'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(), brief: makeBrief(), frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = buildReportContract({ brief: run.brief, frame, nowIso: '2026-07-20T00:00:00.000Z' })
    const source = makeSourceRecord('source_income')
    const span: EvidenceSpan = {
      id: 'span_income', sourceId: source.id,
      text: '公司收入同比增长20%，但这条材料没有识别任何具体产品风险。',
      textHash: 'span-income', location: { paragraphIndex: 1 },
      extractedAt: '2026-07-20T00:00:00.000Z', extractorRunId: run.id
    }
    const claim: AtomicClaim = {
      id: 'claim_income', text: span.text, entities: ['公司收入'], claimType: 'fact',
      supportSpanIds: [span.id], confidence: 'high', critical: true
    }
    const note: ResearchNote = {
      id: 'note_income', taskId: 'task_income', questionIds: ['q_income', 'q_risk'],
      claimIds: [claim.id], summary: claim.text, implicationForBrief: '只回答收入。',
      confidence: 'high', limitations: [], evidenceAssignments: [{
        questionId: 'q_income', claimId: claim.id, role: 'supports', relevance: 1,
        explanation: '该数据直接回答收入表现。', source: 'model_validated'
      }]
    }

    const gate = evaluateWritableGate({
      run, reportContract: run.reportContract, sources: [source], evidenceSpans: [span],
      claims: [claim], notes: [note], nowIso: '2026-07-20T00:00:00.000Z'
    })

    expect(gate.sectionEvidenceMap.find((section) => section.questionIds.includes('q_income'))?.claimIds)
      .toContain(claim.id)
    expect(gate.sectionEvidenceMap.find((section) => section.questionIds.includes('q_risk'))?.claimIds)
      .not.toContain(claim.id)
  })

  it('WritableGate blocks required report sections without their own evidence', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame = makeMultiQuestionFrame()
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_writable_gate'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = buildReportContract({
      brief: run.brief,
      frame,
      nowIso: '2026-06-29T00:00:00.000Z'
    })
    const source = makeSourceRecord('source_q1')
    const span: EvidenceSpan = {
      id: 'span_q1',
      sourceId: source.id,
      text: 'The runtime can define the research scope before report synthesis.',
      textHash: 'span_q1',
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: run.id
    }
    const claim: AtomicClaim = {
      id: 'claim_q1',
      text: 'The runtime can define the research scope before synthesis.',
      entities: ['runtime'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [{
        id: 'note_q1',
        taskId: 'task_q1',
        questionIds: ['q1'],
        claimIds: [claim.id],
        summary: 'q1 covered.',
        implicationForBrief: 'Only q1 has evidence.',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(gate.ok).toBe(false)
    expect(gate.status).toBe('needs_research_repair')
    expect(gate.sectionEvidenceMap.some((section) => section.questionIds.includes('q2') && section.status === 'missing')).toBe(true)
    expect(gate.verdict?.blockingIssues.join('\n')).toContain('必填章节')

    const limitedGate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [{
        id: 'note_q1',
        taskId: 'task_q1',
        questionIds: ['q1'],
        claimIds: [claim.id],
        summary: 'q1 covered.',
        implicationForBrief: 'Only q1 has evidence.',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-06-29T00:00:00.000Z',
      allowEvidenceGapQuestionIds: new Set(['q2', 'q3'])
    })
    expect(limitedGate.ok).toBe(true)
    expect(limitedGate.status).toBe('ready_with_limitations')
    expect(limitedGate.sectionEvidenceMap
      .filter((section) => section.questionIds.some((questionId) => questionId === 'q2' || questionId === 'q3'))
      .every((section) => section.evidenceMode === 'evidence_gap' && section.claimIds.length === 0)).toBe(true)
  })

  it('WritableGate delivers an exhausted missing comparison side as an explicit section limitation', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      alternativesToCompare: ['Alpha', 'Beta'],
      centralQuestion: 'Alpha 与 Beta 的治理机制有何异同？',
      coreResearchThread: '比较两个对象的治理机制。',
      coreQuestions: [{
        id: 'q_governance',
        text: '在「治理机制」维度上，Alpha 与 Beta 有何异同？',
        priority: 'high',
        required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_partial_comparison_gap'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 8 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'governance',
        title: '治理机制',
        required: true,
        questionIds: ['q_governance'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-19T00:00:00.000Z'
    }
    run.coverageContract = buildCoverageContract({
      brief: run.brief,
      frame,
      reportContract: run.reportContract,
      nowIso: '2026-07-19T00:00:00.000Z'
    })
    const sources = [makeSourceRecord('source_alpha_1'), makeSourceRecord('source_alpha_2')]
    const spans: EvidenceSpan[] = sources.map((source, index) => ({
      id: `span_alpha_${index + 1}`,
      sourceId: source.id,
      text: `Alpha governance evidence ${index + 1} documents an independently verifiable decision process.`,
      textHash: `hash_alpha_${index + 1}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-07-19T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_alpha_${index + 1}`,
      text: span.text,
      entities: ['Alpha'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const notes: ResearchNote[] = claims.map((claim, index) => ({
      id: `note_alpha_${index + 1}`,
      taskId: `task_alpha_${index + 1}`,
      questionIds: ['q_governance'],
      claimIds: [claim.id],
      summary: claim.text,
      implicationForBrief: 'Direct Alpha evidence.',
      confidence: 'high',
      limitations: [],
      comparisonTargets: ['Alpha']
    }))
    const strictGate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      coverageContract: run.coverageContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes,
      nowIso: '2026-07-19T00:00:00.000Z'
    })
    expect(strictGate.ok).toBe(false)
    expect(strictGate.verdict?.blockingIssues.join('\n')).toContain('Beta')

    const limitedGate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      coverageContract: run.coverageContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes,
      nowIso: '2026-07-19T00:00:00.000Z',
      allowEvidenceGapQuestionIds: new Set(['q_governance'])
    })
    expect(limitedGate.ok).toBe(true)
    expect(limitedGate.status).toBe('ready_with_limitations')
    expect(limitedGate.sectionEvidenceMap[0]).toMatchObject({ status: 'weak', evidenceMode: 'direct' })
    expect(limitedGate.sectionEvidenceMap[0]?.limitations.join('\n')).toContain('关于「Beta」')
    expect(limitedGate.sectionEvidenceMap[0]?.limitations.join('\n')).toContain('不能替代')
  })

  it('WritableGate requires a direct answer and keeps counterevidence without letting background fill a required analytical section', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      coreResearchThread: 'Identify the service resilience risks and their evidence boundaries.',
      centralQuestion: 'What are the main operational risks?',
      coreQuestions: [{
        id: 'q_risk',
        text: '在「运行风险」维度上，主要风险和不确定性是什么？',
        priority: 'high',
        required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_role_gate'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: { ...makeBrief(), topic: 'Analyze service resilience.' },
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 6 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'q_risk',
        title: '运行风险',
        required: true,
        questionIds: ['q_risk'],
        limitationFallback: '运行风险证据不足。'
      }],
      createdAt: '2026-07-18T00:00:00.000Z'
    }
    const sources = ['denial', 'context', 'adverse'].map((suffix) => makeSourceRecord(`source_role_${suffix}`))
    const texts = [
      'The maintainers report that the service is not exposed to any significant availability risk.',
      'The maintainers released a new interface and updated the public documentation this month.',
      'The service depends on one external component, creating disruption risk when that component is unavailable.'
    ]
    const spans: EvidenceSpan[] = texts.map((text, index) => ({
      id: `span_role_${index}`,
      sourceId: sources[index]!.id,
      text,
      textHash: `hash_role_${index}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-07-18T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_role_${index}`,
      text: span.text,
      entities: ['service'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const evaluate = (claimCount: number) => evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: sources.slice(0, claimCount),
      evidenceSpans: spans.slice(0, claimCount),
      claims: claims.slice(0, claimCount),
      notes: [{
        id: `note_role_${claimCount}`,
        taskId: 'task_role',
        questionIds: ['q_risk'],
        claimIds: claims.slice(0, claimCount).map((claim) => claim.id),
        summary: 'Candidate evidence for the analytical section.',
        implicationForBrief: 'Only direct answers may satisfy the section.',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-07-18T00:00:00.000Z'
    })

    const complete = evaluate(3)
    expect(complete.ok).toBe(true)
    expect(complete.sectionEvidenceMap[0]?.claimIds).toEqual(expect.arrayContaining(['claim_role_0', 'claim_role_2']))
    expect(complete.sectionEvidenceMap[0]?.claimIds).not.toContain('claim_role_1')
    expect(complete.sectionEvidenceMap[0]?.evidenceAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimId: 'claim_role_0', role: 'contradicts' }),
      expect.objectContaining({ claimId: 'claim_role_2', role: 'supports' })
    ]))

    const incomplete = evaluate(2)
    expect(incomplete.ok).toBe(false)
    expect(incomplete.sectionEvidenceMap[0]?.status).toBe('missing')
    expect(incomplete.sectionEvidenceMap[0]?.claimIds).toEqual(['claim_role_0'])
  })

  it('WritableGate accepts direct causal evidence from a citable weak source with an explicit limitation', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '哪些投入直接影响运行成本？',
      coreResearchThread: '识别投入与成本之间的直接关系。',
      coreQuestions: [{
        id: 'q_driver',
        text: '在「成本影响因素」维度上，哪些投入直接影响运行成本？',
        priority: 'high',
        required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_weak_cause_gate'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: { ...makeBrief(), topic: '分析一个通用处理系统的运行成本。' },
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'q_driver',
        title: '成本影响因素',
        required: true,
        questionIds: ['q_driver'],
        limitationFallback: '当前只有弱来源。'
      }],
      createdAt: '2026-07-18T00:00:00.000Z'
    }
    const source: SourceRecord = {
      id: 'source_weak_driver',
      sourceType: 'web',
      kind: 'web_weak',
      title: 'Independent operating guide',
      canonicalUrl: 'https://example.com/operating-guide',
      accessedAt: '2026-07-18T00:00:00.000Z',
      importedAt: '2026-07-18T00:00:00.000Z',
      reliability: 'medium',
      reliabilityReason: 'Relevant and fetched, but not independently authoritative.',
      sourcePolicyTags: ['web_fetch'],
      fingerprint: hashText('source_weak_driver'),
      status: 'fetched'
    }
    const text = 'Input quality affects processing demand, while supplier prices increase operating costs.'
    const span: EvidenceSpan = {
      id: 'span_weak_driver',
      sourceId: source.id,
      text,
      textHash: hashText(text),
      location: { paragraphIndex: 1 },
      extractedAt: '2026-07-18T00:00:00.000Z',
      extractorRunId: run.id
    }
    const claim: AtomicClaim = {
      id: 'claim_weak_driver',
      text,
      entities: ['input quality', 'supplier prices'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'medium',
      critical: true
    }

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [{
        id: 'note_weak_driver',
        taskId: 'task_weak_driver',
        questionIds: ['q_driver'],
        claimIds: [claim.id],
        summary: text,
        implicationForBrief: 'The evidence directly identifies cost drivers.',
        confidence: 'medium',
        limitations: ['The source is relevant but not authoritative.']
      }],
      nowIso: '2026-07-18T00:00:00.000Z'
    })

    expect(gate.ok).toBe(true)
    expect(gate.status).toBe('ready_with_limitations')
    expect(gate.sectionEvidenceMap[0]).toMatchObject({
      status: 'weak',
      claimIds: ['claim_weak_driver'],
      sourceIds: ['source_weak_driver']
    })
  })

  it('WritableGate keeps concrete sections exclusive when lead and conclusion carry the umbrella answer', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const multiQuestionFrame = makeMultiQuestionFrame()
    const frame = {
      ...multiQuestionFrame,
      centralQuestion: '强弱 ETag、freshness 与 validation、no-cache 与 no-store 如何协同？',
      coreResearchThread: '解释强弱 ETag、freshness 与 validation、no-cache 与 no-store 的协同机制。',
      coreQuestions: multiQuestionFrame.coreQuestions.slice(0, 3).map((question, index) => index === 0
        ? { ...question, text: '强弱 ETag、freshness 与 validation、no-cache 与 no-store 如何协同？' }
        : question)
    }
    const runtime = new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_owned_claims'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = buildReportContract({ brief: run.brief, frame, nowIso: '2026-06-29T00:00:00.000Z' })
    const source = makeSourceRecord('source_owned_claims')
    const spans: EvidenceSpan[] = ['one', 'two'].map((suffix, index) => ({
      id: `span_${suffix}`,
      sourceId: source.id,
      text: `Independent evidence for required section ${index + 1}.`,
      textHash: `hash_${suffix}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_${index + 1}`,
      text: `Independent conclusion for required section ${index + 1}.`,
      entities: ['runtime'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const fallbackSource: SourceRecord = {
      ...source,
      id: 'source_fallback_claim',
      path: 'synthetic://deep-research/fallback',
      sourcePolicyTags: ['model_generated', 'requires_external_verification'],
      kind: 'model_fallback',
      reliability: 'low'
    }
    const fallbackSpan: EvidenceSpan = {
      ...spans[0]!,
      id: 'span_fallback_claim',
      sourceId: fallbackSource.id
    }
    const fallbackClaim: AtomicClaim = {
      ...claims[0]!,
      id: 'claim_fallback_unusable',
      supportSpanIds: [fallbackSpan.id]
    }

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [source, fallbackSource],
      evidenceSpans: [...spans, fallbackSpan],
      claims: [...claims, fallbackClaim],
      notes: [{
        id: 'note_shared',
        taskId: 'task_shared',
        questionIds: ['q1', 'q2', 'q3'],
        claimIds: [...claims.map((claim) => claim.id), fallbackClaim.id],
        summary: 'Both required questions have distinct evidence.',
        implicationForBrief: 'Each section can own a separate conclusion.',
        confidence: 'high',
        limitations: []
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    const concreteClaims = gate.sectionEvidenceMap.flatMap((section) => section.claimIds)
    expect(gate.ok).toBe(true)
    expect(gate.sectionEvidenceMap.every((section) => section.claimIds.length > 0)).toBe(true)
    expect(new Set(concreteClaims).size).toBe(concreteClaims.length)
    expect(gate.sectionEvidenceMap.some((section) => section.questionIds.includes('q1'))).toBe(false)
    expect(gate.sectionEvidenceMap.flatMap((section) => section.claimIds)).not.toContain(fallbackClaim.id)
  })

  it('WritableGate gives application sections bounded context claims without duplicating primary ownership', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const baseFrame = makeMultiQuestionFrame()
    const frame = {
      ...baseFrame,
      coreQuestions: baseFrame.coreQuestions.slice(0, 2)
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_context_claims'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 8 }
    })
    run.reportContract = {
      requiredSections: [
        { id: 'q1', title: '基础机制', required: true, questionIds: ['q1'], limitationFallback: '基础机制证据不足。' },
        { id: 'q2', title: '实际应用场景', required: true, questionIds: ['q2'], limitationFallback: '应用场景证据不足。' }
      ],
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    const sources = Array.from({ length: 5 }, (_, index) => makeSourceRecord(`source_context_${index + 1}`))
    const spans: EvidenceSpan[] = sources.map((source, index) => ({
      id: `span_context_${index + 1}`,
      sourceId: source.id,
      text: `Kun DeepResearch P0 runtime verified pipeline evidence ${index + 1} for the assigned research question.`,
      textHash: `hash_context_${index + 1}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_context_${index + 1}`,
      text: `Kun DeepResearch P0 runtime verified pipeline conclusion ${index + 1} for the assigned research question.`,
      entities: ['research'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes: [
        {
          id: 'note_context_foundation', taskId: 'task_context_foundation', questionIds: ['q1'],
          claimIds: claims.slice(0, 2).map((claim) => claim.id), summary: 'Foundation evidence.',
          implicationForBrief: 'Defines the foundation.', confidence: 'high', limitations: []
        },
        {
          id: 'note_context_application', taskId: 'task_context_application', questionIds: ['q2'],
          claimIds: claims.slice(2).map((claim) => claim.id), summary: 'Application evidence.',
          implicationForBrief: 'Explains the application.', confidence: 'high', limitations: []
        }
      ],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    const foundation = gate.sectionEvidenceMap.find((section) => section.sectionId === 'q1')!
    const application = gate.sectionEvidenceMap.find((section) => section.sectionId === 'q2')!
    const primaryClaimIds = gate.sectionEvidenceMap.flatMap((section) => section.claimIds)
    expect(gate.ok).toBe(true)
    expect(application.claimIds).toEqual(claims.slice(2).map((claim) => claim.id))
    expect(application.contextClaimIds?.length).toBeGreaterThan(0)
    expect(application.contextClaimIds?.every((claimId) => foundation.claimIds.includes(claimId))).toBe(true)
    expect(new Set(primaryClaimIds).size).toBe(primaryClaimIds.length)
  })

  it('WritableGate removes a note-mislabeled claim that does not match either required title facet', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      coreResearchThread: 'Compare strong ETag and weak ETag validators.',
      centralQuestion: 'How do strong ETag and weak ETag differ?',
      coreQuestions: [{ id: 'q_etag', text: 'How do strong ETag and weak ETag differ?', priority: 'high', required: true }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_gate_mislabeled'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: { ...makeBrief(), topic: 'Strong ETag and weak ETag comparison' },
      frame,
      budget: { preset: 'standard', maxWorkers: 1 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'q_etag', title: '强 ETag 与 弱 ETag', required: true,
        questionIds: ['q_etag'], limitationFallback: 'ETag 证据不足。'
      }],
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    const sources = ['weak', 'strong', 'unrelated'].map((suffix) => makeSourceRecord(`source_${suffix}`))
    const spanTexts = [
      'Weak ETags identify representations that can be semantically equivalent.',
      'Strong ETags support byte-for-byte comparisons between representations.',
      'The no-cache directive requires validation before reusing a stored response.'
    ]
    const spans: EvidenceSpan[] = spanTexts.map((text, index) => ({
      id: `span_gate_${index}`, sourceId: sources[index]!.id, text,
      textHash: `hash_gate_${index}`, location: { paragraphIndex: index + 1 },
      extractedAt: '2026-06-29T00:00:00.000Z', extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_gate_${index}`, text: span.text, entities: [], claimType: 'fact',
      supportSpanIds: [span.id], confidence: 'high', critical: true
    }))
    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes: [{
        id: 'note_gate_mislabeled', taskId: 'task_gate', questionIds: ['q_etag'],
        claimIds: claims.map((claim) => claim.id), summary: 'Model assigned all cards to one note.',
        implicationForBrief: 'Only ETag cards belong in this section.', confidence: 'high', limitations: []
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    const section = gate.sectionEvidenceMap[0]!
    expect(gate.ok).toBe(true)
    expect(section.claimIds).toEqual(expect.arrayContaining(['claim_gate_0', 'claim_gate_1']))
    expect(section.claimIds).not.toContain('claim_gate_2')
  })

  it('WritableGate accepts current-dimension evidence when the source title anchors its context', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeFrame(),
      coreResearchThread: 'Explain lifecycle rules for field resources.',
      centralQuestion: 'How should a field resource scenario be understood?',
      coreQuestions: [{ id: 'q_static', text: '在「field resource scenario」维度上，what facts and boundaries apply?', priority: 'high', required: true }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_gate_static'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: { ...makeBrief(), topic: 'Analyze the field resource scenario from its primary guide.' },
      frame,
      budget: { preset: 'standard', maxWorkers: 1 }
    })
    run.reportContract = {
      requiredSections: [{
        id: 'q_static', title: 'Field resource scenario', required: true,
        questionIds: ['q_static'], limitationFallback: 'Field resource evidence is insufficient.'
      }],
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    const sources = ['a', 'b'].map((suffix) => ({
      ...makeSourceRecord(`source_static_${suffix}`),
      title: 'Field resource lifecycle guide'
    }))
    const spanTexts = [
      'In the field resource scenario, resources that are never relocated do not need recalibration when an operator restarts the controller.',
      'The field resource scenario can use versioned configurations while older field resource configurations remain unchanged.',
      'When an operator restarts the controller in the field resource scenario, resources that are never relocated do not need recalibration.',
      'In the field resource scenario, a check begins. But those kinds of resources are not described independently.'
    ]
    const spans: EvidenceSpan[] = spanTexts.map((text, index) => ({
      id: `span_static_${index}`, sourceId: sources[index === 1 ? 1 : 0]!.id, text,
      textHash: `hash_static_${index}`, location: { paragraphIndex: index + 1 },
      extractedAt: '2026-06-29T00:00:00.000Z', extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_static_${index}`, text: span.text, entities: ['field resources'], claimType: 'fact',
      supportSpanIds: [span.id], confidence: 'high', critical: true
    }))
    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes: [{
        id: 'note_static', taskId: 'task_static', questionIds: ['q_static'],
        claimIds: claims.map((claim) => claim.id), summary: 'Field resource evidence.',
        implicationForBrief: 'Supports the scenario section.', confidence: 'high', limitations: []
      }],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(gate.ok).toBe(true)
    expect(gate.sectionEvidenceMap[0]?.claimIds).toContain('claim_static_1')
    expect(gate.sectionEvidenceMap[0]?.claimIds.filter((claimId) =>
      ['claim_static_0', 'claim_static_2'].includes(claimId)
    )).toHaveLength(1)
    expect(gate.sectionEvidenceMap[0]?.claimIds).not.toContain('claim_static_3')
    expect(gate.sectionEvidenceMap[0]?.evidenceMode).toBe('direct')
  })

  it('WritableGate marks sparse direct scene evidence plus a foundation premise as conditional application', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const frame: ResearchFrame = {
      ...makeMultiQuestionFrame(),
      coreResearchThread: 'Explain how integrity validation constrains batch transfer.',
      centralQuestion: 'How do integrity validation rules apply to a batch transfer scenario?',
      coreQuestions: [
        { id: 'q1', text: 'How does artifact integrity validation work?', priority: 'high', required: true },
        { id: 'q2', text: '在「batch transfer scenario」维度上，how does integrity validation apply?', priority: 'high', required: true }
      ]
    }
    const brief: ResearchBrief = {
      ...makeBrief(),
      topic: 'Artifact integrity validation and batch transfer',
      userIntent: 'Explain integrity validation first, then analyze the batch transfer scenario.'
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_context_source_depth'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief,
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 4 }
    })
    run.reportContract = {
      requiredSections: [
        { id: 'q1', title: 'Integrity validation', required: true, questionIds: ['q1'], limitationFallback: 'Validation evidence is insufficient.' },
        { id: 'q2', title: 'Batch transfer scenario', required: true, questionIds: ['q2'], limitationFallback: 'Scenario evidence is insufficient.' }
      ],
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    const foundationSource = makeSourceRecord('source_foundation')
    const applicationSource = makeSourceRecord('source_application')
    const spans: EvidenceSpan[] = [
      {
        id: 'span_foundation', sourceId: foundationSource.id,
        text: 'An artifact with uncertain integrity can be validated with a conditional checksum comparison.', textHash: 'hash_foundation',
        location: { paragraphIndex: 1 }, extractedAt: '2026-06-29T00:00:00.000Z', extractorRunId: run.id
      },
      {
        id: 'span_application_one', sourceId: applicationSource.id,
        text: 'In the batch transfer scenario, the mode makes a conditional integrity check when a matching artifact is uncertain.', textHash: 'hash_application_one',
        location: { paragraphIndex: 2 }, extractedAt: '2026-06-29T00:00:00.000Z', extractorRunId: run.id
      }
    ]
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_context_depth_${index + 1}`,
      text: span.text,
      entities: index === 0 ? ['integrity validation'] : ['batch transfer'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))

    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources: [foundationSource, applicationSource],
      evidenceSpans: spans,
      claims,
      notes: [
        {
          id: 'note_foundation_depth', taskId: 'task_foundation_depth', questionIds: ['q1'],
          claimIds: [claims[0]!.id], summary: 'Foundation evidence.',
          implicationForBrief: 'Defines integrity validation.', confidence: 'high', limitations: []
        },
        {
          id: 'note_application_depth', taskId: 'task_application_depth', questionIds: ['q2'],
          claimIds: [claims[1]!.id], summary: 'Application evidence.',
          implicationForBrief: 'Explains batch transfer behavior.', confidence: 'high', limitations: []
        }
      ],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    const application = gate.sectionEvidenceMap.find((section) => section.sectionId === 'q2')!
    expect(gate.ok).toBe(true)
    expect(application.claimIds).toEqual([claims[1]!.id])
    expect(application.contextClaimIds).toEqual([claims[0]!.id])
    expect(application.sourceIds).toEqual(expect.arrayContaining([foundationSource.id, applicationSource.id]))
    expect(application.status).toBe('weak')
    expect(application.evidenceMode).toBe('conditional_application')
  })

  it('WritableGate uses two distinct strong premises when a scenario has no scope-compatible direct evidence', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const baseFrame = makeMultiQuestionFrame()
    const frame: ResearchFrame = {
      ...baseFrame,
      centralQuestion: '基础规则如何约束批量传输场景？',
      coreResearchThread: '先解释输入资格与完整性验证，再作批量传输场景分析。',
      coreQuestions: [{
        id: 'q_storage', text: '输入资格规则如何工作？', priority: 'high', required: true
      }, {
        id: 'q_validation', text: '完整性验证机制如何工作？', priority: 'high', required: true
      }, {
        id: 'q_etag', text: '强标识符与弱标识符有何区别？', priority: 'high', required: true
      }, {
        id: 'q_api', text: '在「批量传输场景」维度上，关键事实和边界是什么？', priority: 'high', required: true
      }]
    }
    const run = await new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
      idGenerator: sequenceIds('rr_conditional_scene'),
      nowIso: sequenceTimes()
    }).createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame,
      budget: { preset: 'standard', maxWorkers: 1, maxSources: 8 }
    })
    run.reportContract = {
      requiredSections: [
        { id: 'q_storage', title: '输入资格', required: true, questionIds: ['q_storage'], limitationFallback: '输入资格证据不足。' },
        { id: 'q_validation', title: '完整性验证', required: true, questionIds: ['q_validation'], limitationFallback: '完整性证据不足。' },
        { id: 'q_etag', title: '强标识符与弱标识符', required: true, questionIds: ['q_etag'], limitationFallback: '标识符证据不足。' },
        { id: 'q_api', title: '批量传输场景', required: true, questionIds: ['q_api'], limitationFallback: '场景证据不足。' }
      ],
      createdAt: '2026-06-29T00:00:00.000Z'
    }
    const sources = ['no_store', 'no_cache', 'validation', 'etag', 'cache_api'].map((suffix) => makeSourceRecord(`source_${suffix}`))
    const texts = [
      'An input may be retained, but its eligibility must be checked before every batch transfer.',
      'Input eligibility uses a recorded checksum when a retained artifact enters batch transfer.',
      'Integrity validation can make an uncertain artifact eligible again after checking its recorded checksum.',
      'Strong and weak identifiers have different comparison semantics and generation costs.',
      'The monitoring dashboard displays summary records but does not execute artifact operations.'
    ]
    const spans: EvidenceSpan[] = texts.map((text, index) => ({
      id: `span_conditional_${index + 1}`,
      sourceId: sources[index]!.id,
      text,
      textHash: `hash_conditional_${index + 1}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: run.id
    }))
    const claims: AtomicClaim[] = spans.map((span, index) => ({
      id: `claim_conditional_${index + 1}`,
      text: span.text,
      entities: [
        ['input eligibility'],
        ['input eligibility'],
        ['integrity validation'],
        ['identifier semantics'],
        ['monitoring dashboard']
      ][index] ?? [],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }))
    const gate = evaluateWritableGate({
      run,
      reportContract: run.reportContract,
      sources,
      evidenceSpans: spans,
      claims,
      notes: frame.coreQuestions.map((question, index) => {
        const questionClaims = question.id === 'q_storage' ? claims.slice(0, 2) : [claims[index + 1]!]
        return {
        id: `note_conditional_${index + 1}`,
        taskId: `task_conditional_${index + 1}`,
        questionIds: [question.id],
        claimIds: questionClaims.map((claim) => claim.id),
        summary: questionClaims.map((claim) => claim.text).join(' '),
        implicationForBrief: 'Defines a documented mechanism or scope boundary.',
        confidence: 'high' as const,
        limitations: []
      }}),
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    const application = gate.sectionEvidenceMap.find((section) => section.sectionId === 'q_api')!
    expect(gate.ok).toBe(true)
    expect(application.claimIds).toEqual([])
    expect(application.contextClaimIds).toContain(claims[2]!.id)
    expect(application.contextClaimIds).toHaveLength(2)
    expect(application.contextClaimIds!.filter((claimId) => [claims[0]!.id, claims[1]!.id].includes(claimId))).toHaveLength(1)
    expect(application.contextClaimIds).not.toContain(claims[3]!.id)
    expect(application.contextClaimIds).not.toContain(claims[4]!.id)
    expect(application.evidenceMode).toBe('conditional_application')
    expect(application.status).toBe('weak')
  })

  it('EvidenceStore canonicalizes duplicate source excerpts and remaps later claims', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const layout = await repository.createRunLayout({
      runId: 'rr_duplicate_span',
      title: 'Duplicate span hashes',
      createdAt: '2026-06-29T00:00:00.000Z'
    })
    const store = new EvidenceStore(repository, layout)
    const source = makeSourceRecord('source_duplicate')
    const duplicateHash = hashText('same excerpt')
    const spanA: EvidenceSpan = {
      id: 'span_a',
      sourceId: source.id,
      text: 'same excerpt',
      textHash: duplicateHash,
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:03.000Z',
      extractorRunId: 'rr_duplicate_span'
    }
    const spanB: EvidenceSpan = {
      ...spanA,
      id: 'span_b'
    }
    const claimB: AtomicClaim = {
      id: 'claim_b',
      text: 'same excerpt',
      entities: [],
      claimType: 'fact',
      supportSpanIds: [spanB.id],
      confidence: 'medium'
    }

    const firstResult = workerResultForSource('task_a', source, spanA.id, 'claim_a')
    firstResult.evidenceSpans[0] = spanA
    firstResult.claims[0] = { ...firstResult.claims[0]!, supportSpanIds: [spanA.id] }
    await store.recordWorkerResult(firstResult)
    const duplicateResult = workerResultForSource('task_b', source, spanB.id, claimB.id)
    duplicateResult.evidenceSpans[0] = spanB
    duplicateResult.claims[0] = claimB
    const canonical = store.canonicalizeWorkerResult(duplicateResult)
    await store.recordWorkerResult(duplicateResult)

    expect(canonical.evidenceSpans).toEqual([])
    expect(canonical.claims[0]?.supportSpanIds).toEqual([spanA.id])
    expect(canonical.notes[0]?.claimIds).toEqual([claimB.id])
    expect(store.listEvidenceSpans()).toHaveLength(1)
    expect(store.getClaim(claimB.id)?.supportSpanIds).toEqual([spanA.id])
  })

  it('EvidenceStore merges duplicate source fingerprints and remaps later spans', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const layout = await repository.createRunLayout({
      runId: 'rr_duplicate_source',
      title: 'Duplicate source fingerprints',
      createdAt: '2026-06-29T00:00:00.000Z'
    })
    const store = new EvidenceStore(repository, layout)
    const sourceA = { ...makeSourceRecord('source_a'), fingerprint: 'same-page' }
    const sourceB = { ...makeSourceRecord('source_b'), fingerprint: 'same-page' }
    const first = workerResultForSource('task_a', sourceA, 'span_a', 'claim_a')
    const second = workerResultForSource('task_b', sourceB, 'span_b', 'claim_b')

    await store.recordWorkerResult(first)
    const canonicalSecond = store.canonicalizeWorkerResult(second)
    await store.recordWorkerResult(second)

    expect(canonicalSecond.sources).toEqual([])
    expect(canonicalSecond.evidenceSpans).toEqual([])
    expect(canonicalSecond.claims).toEqual([])
    expect(canonicalSecond.notes[0]?.claimIds).toEqual(['claim_a'])
    expect(store.listSources()).toHaveLength(1)
    expect(store.listEvidenceSpans()).toHaveLength(1)
    expect(store.getClaim('claim_b')).toBeUndefined()
    expect(store.listClaims()).toHaveLength(1)
  })

  it('keeps successful parallel worker results when a sibling task fails', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const events: ResearchEvent[] = []
    repository.appendEvent = async (layout, event) => {
      events.push(event)
      await ResearchRunRepository.prototype.appendEvent.call(repository, layout, event)
    }
    const runtime = new ResearchRuntime({
      repository,
      planAgent: {
        async createPlan(input) {
          return {
            id: 'plan_partial_failure',
            runId: input.runId,
            rationale: 'Run independent tasks in parallel.',
            createdAt: input.nowIso,
            tasks: [
              { id: 'task_ok', questionIds: ['q1'], objective: 'collect evidence', expectedEvidence: ['evidence'], sourceTypes: ['local_file'], searchHints: ['evidence'], maxSources: 1, priority: 'high', status: 'pending' },
              { id: 'task_fail', questionIds: ['q1'], objective: 'secondary evidence', expectedEvidence: ['evidence'], sourceTypes: ['local_file'], searchHints: ['evidence'], maxSources: 1, priority: 'medium', status: 'pending' }
            ]
          }
        }
      },
      worker: new PartialFailureResearchTaskWorker(),
      synthesisWriter: new PassingSynthesisWriter(),
      qualityJudge: new PassingQualityJudge(),
      idGenerator: sequenceIds('rr_partial'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({
      scope: makeScope(),
      brief: makeBrief(),
      frame: makeFrame(),
      budget: { reasoningEffort: 'medium', maxWorkers: 2, maxSources: 2, maxRounds: 1 }
    })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    const completed = await runtime.runConfirmedResearch(run.id)

    expect(completed.run.status).toBe('done')
    expect(completed.run.plan?.tasks.find((task) => task.id === 'task_fail')?.status).toBe('failed')
    expect(events.some((event) => event.type === 'TASK_FAILED' && event.taskId === 'task_fail')).toBe(true)
    expect(events.some((event) => event.type === 'TASK_COMPLETED' && event.taskId === 'task_ok')).toBe(true)
  })

  it('QualityVerifier blocks numbers that are absent from the cited claim and span', () => {
    const verifier = new QualityVerifier()
    const source = makeSourceRecord('source_numeric')
    const span: EvidenceSpan = {
      id: 'span_numeric',
      sourceId: source.id,
      text: 'The plan costs $60 and includes $70 of usage.',
      textHash: hashText('numeric evidence'),
      location: { lineStart: 1, lineEnd: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: 'rr_numeric'
    }
    const claim: AtomicClaim = {
      id: 'claim_numeric',
      text: 'The plan costs $60 and includes $70 of usage.',
      entities: ['plan'],
      claimType: 'metric',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const unrelatedSameSourceSpan: EvidenceSpan = {
      ...span,
      id: 'span_numeric_unrelated',
      text: 'A separate paragraph on the same page mentions 14% for an unrelated metric.',
      textHash: hashText('unrelated numeric evidence')
    }
    const longFinding = '结构化证据必须在报告落盘前经过引用解析和确定性校验，避免把没有来源支持的推断写成事实。'.repeat(50)
    const reportMarkdown = [
      '# Numeric support',
      '',
      `## 摘要\n${makeFrame().coreResearchThread}。`,
      '',
      '## 调研范围与方法\n验证数字证据一致性。',
      '',
      `## 主要发现\n${longFinding} 折算后成本降低 14%。<sup data-citation-id="cit_1">[1]</sup>`,
      '',
      `## 结论与建议\n${longFinding} <sup data-citation-id="cit_1">[1]</sup>`,
      '',
      '## 局限与不确定性\n仍需补充真实外部证据。'
    ].join('\n')
    const verdict = verifier.verify({
      brief: makeBrief(),
      frame: makeFrame(),
      plan: { id: 'plan_numeric', runId: 'rr_numeric', rationale: 'test', createdAt: '2026-06-29T00:00:00.000Z', tasks: [{ id: 'task_numeric', questionIds: ['q1'], objective: 'test', expectedEvidence: ['evidence'], sourceTypes: ['local_file'], searchHints: ['test'], maxSources: 1, priority: 'high', status: 'done' }] },
      budget: resolveResearchBudget({ reasoningEffort: 'medium', maxSources: 1 }),
      reportMarkdown,
      notes: [{ id: 'note_numeric', taskId: 'task_numeric', questionIds: ['q1'], claimIds: [claim.id], summary: 'covered', implicationForBrief: 'covered', confidence: 'high', limitations: [] }],
      sources: [source],
      claims: [claim],
      evidenceSpans: [span, unrelatedSameSourceSpan],
      citations: [{ id: 'cit_1', reportPath: 'report.md', reportAnchor: 'claim:claim_numeric:1', reportClaimText: '折算后成本降低 14%。', claimId: claim.id, evidenceSpanIds: [span.id], status: 'verified' }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.issues.some((issue) => issue.code === 'unsupported_citation_number')).toBe(true)
    expect(verdict.blockingIssues.join('\n')).toContain('14%')
  })

  it('allows an exact user quantity scope only in an evidence-insufficiency boundary', () => {
    const verifier = new QualityVerifier()
    const source = makeSourceRecord('source_scope_numeric')
    const span: EvidenceSpan = {
      id: 'span_scope_numeric', sourceId: source.id,
      text: 'The available record describes a general historical direction without a bounded-period estimate.',
      textHash: hashText('scope numeric evidence'), location: { lineStart: 1, lineEnd: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z', extractorRunId: 'rr_scope_numeric'
    }
    const claim: AtomicClaim = {
      id: 'claim_scope_numeric', text: span.text, entities: ['historical direction'], claimType: 'fact',
      supportSpanIds: [span.id], confidence: 'high', critical: true
    }
    const brief: ResearchBrief = {
      ...makeBrief(),
      topic: '分析过去五年的变化，并在缺少分期数据时明确说明证据边界。',
      userIntent: '获得过去五年的变化判断。'
    }
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '过去五年的变化能否由公开证据量化？',
      coreResearchThread: '区分过去五年的量化结论和长期背景。',
      coreQuestions: makeFrame().coreQuestions.map((question) => ({
        ...question,
        text: '过去五年的变化能否由公开证据量化？'
      }))
    }
    const reportFor = (sentence: string) => [
      '# Scope numeric support',
      '',
      `## 摘要\n${frame.coreResearchThread}。`,
      '',
      '## 调研范围与方法\n核对用户时间范围与证据时间范围。',
      '',
      `## 主要发现\n${sentence}<sup data-citation-id="cit_1">[1]</sup>`,
      '',
      `## 结论与建议\n${sentence}<sup data-citation-id="cit_1">[1]</sup>`,
      '',
      '## 局限与不确定性\n仍需补充分期数据。'
    ].join('\n')
    const verify = (sentence: string) => verifier.verify({
      brief,
      frame,
      plan: { id: 'plan_scope_numeric', runId: 'rr_scope_numeric', rationale: 'test', createdAt: '2026-06-29T00:00:00.000Z', tasks: [{ id: 'task_scope_numeric', questionIds: ['q1'], objective: 'test', expectedEvidence: ['evidence'], sourceTypes: ['local_file'], searchHints: ['test'], maxSources: 1, priority: 'high', status: 'done' }] },
      budget: resolveResearchBudget({ reasoningEffort: 'medium', maxSources: 1 }),
      reportMarkdown: reportFor(sentence),
      notes: [{ id: 'note_scope_numeric', taskId: 'task_scope_numeric', questionIds: ['q1'], claimIds: [claim.id], summary: 'covered', implicationForBrief: 'covered', confidence: 'high', limitations: [] }],
      sources: [source], claims: [claim], evidenceSpans: [span],
      citations: [{ id: 'cit_1', reportPath: 'report.md', reportAnchor: 'claim:claim_scope_numeric:1', reportClaimText: sentence, claimId: claim.id, evidenceSpanIds: [span.id], status: 'verified' }],
      unresolvedCitationIds: [], nowIso: '2026-06-29T00:00:00.000Z'
    })

    const bounded = verify('过去五年的变化无法由当前证据量化。')
    const positive = verify('过去五年的成本已经下降。')

    expect(bounded.issues.some((issue) => issue.code === 'unsupported_citation_number')).toBe(false)
    expect(positive.issues.some((issue) => issue.code === 'unsupported_citation_number')).toBe(true)
  })

  it('does not compare raw clarification prose after requirements are mapped into the frame', () => {
    const verifier = new QualityVerifier()
    const brief: ResearchBrief = {
      ...makeBrief(),
      userClarifications: ['回答：经济与贸易；科技与创新'],
      sourcePolicy: {
        ...makeBrief().sourcePolicy,
        requireCitations: true
      }
    }
    const frame = makeFrame()
    const claim: AtomicClaim = {
      id: 'claim_1',
      text: 'The runtime can preserve user requirements.',
      entities: [],
      claimType: 'fact',
      supportSpanIds: ['span_1'],
      confidence: 'high',
      critical: true
    }
    const longReport = [
      '# Report',
      '',
      `## 摘要\n${frame.coreResearchThread}。${'本段用于提供足够长度但刻意不覆盖用户补充选项。'.repeat(30)}`,
      '',
      '## 主要发现\n报告讨论 runtime 验证链路，但没有覆盖用户补充。',
      '',
      '## 证据\n已有证据支持 runtime 可以保留需求。[claim:claim_1]',
      '',
      '## 结论\n需要继续改进。',
      '',
      '## 局限与不确定性\n仍需真实数据。'
    ].join('\n')

    const verdict = verifier.verify({
      brief,
      frame,
      plan: {
        id: 'plan_1',
        runId: 'run_1',
        rationale: 'test',
        createdAt: '2026-06-29T00:00:00.000Z',
        tasks: [{
          id: 'task_1',
          questionIds: ['q1'],
          objective: 'test',
          expectedEvidence: ['evidence'],
          sourceTypes: ['local_file'],
          searchHints: ['test'],
          maxSources: 1,
          priority: 'high',
          status: 'done'
        }]
      },
      budget: resolveResearchBudget({ maxWorkers: 1, maxRounds: 1, maxSources: 1, timeoutMs: 1_000 }),
      reportMarkdown: longReport,
      notes: [{
        id: 'note_1',
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: ['claim_1'],
        summary: 'Runtime preserves requirements.',
        implicationForBrief: 'Requirements should reach the final report.',
        confidence: 'high',
        limitations: []
      }],
      claims: [claim],
      evidenceSpans: [{
        id: 'span_1',
        sourceId: 'source_1',
        text: 'The runtime persists user requirements into the research brief.',
        textHash: 'hash_1',
        location: { paragraphIndex: 1 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'run_1'
      }],
      citations: [{
        id: 'cit_1',
        reportPath: 'report.md',
        reportAnchor: 'claim:claim_1:1',
        reportClaimText: claim.text,
        claimId: claim.id,
        evidenceSpanIds: ['span_1'],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).not.toContain('报告没有覆盖用户补充要求')
  })

  it('QualityVerifier blocks budget-exhausted coverage matrix failures', () => {
    const verifier = new QualityVerifier()
    const brief: ResearchBrief = {
      ...makeBrief(),
      sourcePolicy: {
        allowedSourceTypes: ['web', 'local_file'],
        minSourceCount: 3,
        maxSourceCount: 6,
        requireCitations: true
      }
    }
    const frame = makeFrame()
    const claim: AtomicClaim = {
      id: 'claim_1',
      text: 'DeepResearch needs runtime evidence gates to keep model generated source cards from replacing fetched web evidence.',
      entities: ['DeepResearch'],
      claimType: 'fact',
      supportSpanIds: ['span_1'],
      confidence: 'high',
      critical: true
    }
    const source: SourceRecord = {
      id: 'source_model_card',
      sourceType: 'web',
      title: 'Model generated source card',
      canonicalUrl: 'synthetic://model-card',
      path: 'synthetic://model-card',
      accessedAt: '2026-06-29T00:00:00.000Z',
      importedAt: '2026-06-29T00:00:00.000Z',
      reliability: 'low',
      reliabilityReason: 'Synthetic model card should not satisfy strong web evidence gates.',
      sourcePolicyTags: ['model_generated'],
      fingerprint: 'model_card',
      status: 'fetched'
    }
    const reportMarkdown = [
      '# DeepResearch evidence gate',
      '',
      `## 摘要\n${frame.coreResearchThread}。本报告摘要很短，只说明结论方向。`,
      '',
      '## 调研范围与方法\n本次只验证 strong web evidence gate，不展开内部证据链。',
      '',
      `## 主要发现\n${frame.coreResearchThread}。${'强联网证据门槛要求来源必须来自真实网页抓取、结构化抽取和引用绑定，模型生成的来源卡片只能作为兜底背景，不能替代可访问网页。'.repeat(90)} [claim:claim_1]`,
      '',
      '## 结论\nstandard 档如果允许 web 来源，就应该要求真实抓取网页支撑关键判断。',
      '',
      '## 局限与不确定性\n本测试使用合成输入，只验证校验规则。'
    ].join('\n')

    const verdict = verifier.verify({
      brief,
      frame,
      plan: {
        id: 'plan_1',
        runId: 'run_1',
        rationale: 'test',
        createdAt: '2026-06-29T00:00:00.000Z',
        tasks: [{
          id: 'task_1',
          questionIds: ['q1'],
          objective: 'test',
          expectedEvidence: ['evidence'],
          sourceTypes: ['web', 'local_file'],
          searchHints: ['test'],
          maxSources: 3,
          priority: 'high',
          status: 'done'
        }]
      },
      budget: resolveResearchBudget({ reasoningEffort: 'high', maxSources: 6, minSources: 3, targetSources: 5, timeoutMs: 1_000 }),
      reportMarkdown,
      notes: [{
        id: 'note_1',
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: ['claim_1'],
        summary: 'Evidence gate is covered.',
        implicationForBrief: 'The report should distinguish model cards from fetched web evidence.',
        confidence: 'high',
        limitations: []
      }],
      sources: [source],
      claims: [claim],
      evidenceSpans: [{
        id: 'span_1',
        sourceId: source.id,
        text: 'Synthetic source card claims strong evidence should come from fetched web pages.',
        textHash: 'hash_1',
        location: { paragraphIndex: 1 },
        extractedAt: '2026-06-29T00:00:00.000Z',
        extractorRunId: 'run_1'
      }],
      gapVerdicts: [{
        id: 'gap_run_1_1',
        roundIndex: 1,
        status: 'budget_exhausted',
        confidence: 'low',
        stopReason: '仍缺少真实网页证据：问题「Can the runtime produce a verified report from structured notes?」真实网页来源数 0 低于要求 1。',
        coverageByQuestion: [{
          questionId: 'q1',
          question: 'Can the runtime produce a verified report from structured notes?',
          required: true,
          priority: 'high',
          covered: false,
          requiredSourceCount: 1,
          requiredStrongWebSourceCount: 1,
          sourceCount: 1,
          strongWebSourceCount: 0,
          requiredClaimCount: 1,
          claimCount: 1,
          criticalClaimCount: 1,
          noteCount: 1,
          missingEvidence: ['问题「Can the runtime produce a verified report from structured notes?」真实网页来源数 0 低于要求 1。']
        }],
        coverageMatrix: {
          totalSourceCount: 1,
          strongWebSourceCount: 0,
          requiredQuestionCount: 1,
          coveredRequiredQuestionCount: 0,
          disconfirmingEvidenceCovered: true,
          comparisonTargets: []
        },
        missingEvidence: ['问题「Can the runtime produce a verified report from structured notes?」真实网页来源数 0 低于要求 1。'],
        followUpTasks: [],
        createdAt: '2026-06-29T00:00:00.000Z'
      }],
      citations: [{
        id: 'cit_1',
        reportPath: 'report.md',
        reportAnchor: 'claim:claim_1:1',
        reportClaimText: claim.text,
        claimId: claim.id,
        evidenceSpanIds: ['span_1'],
        status: 'verified',
        verifiedAt: '2026-06-29T00:00:00.000Z'
      }],
      unresolvedCitationIds: [],
      nowIso: '2026-06-29T00:00:00.000Z'
    })

    expect(verdict.pass).toBe(false)
    expect(verdict.blockingIssues.join('\n')).toContain('证据收集未达到 standard preset')
    expect(verdict.blockingIssues.join('\n')).toContain('真实网页来源数 0 低于要求 1')
  })
})

class PassingSynthesisWriter implements SynthesisWriter {
  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    const fallbackClaim = input.claims.find((candidate) => candidate.critical) ?? input.claims[0]
    const sectionClaims = (input.reportContract?.requiredSections ?? []).map((section) => {
      const claimIds = new Set(input.notes
        .filter((note) => note.questionIds.some((questionId) => section.questionIds.includes(questionId)))
        .flatMap((note) => note.claimIds))
      return input.claims.find((claim) => claimIds.has(claim.id)) ?? fallbackClaim
    })
    const usedClaimIds = [...new Set(sectionClaims.map((claim) => claim?.id).filter((id): id is string => Boolean(id)))]
    const sectionLines = (input.reportContract?.requiredSections ?? [])
      .map((section, index) => {
        const claimId = sectionClaims[index]?.id ?? fallbackClaim?.id ?? 'claim_1'
        return [
          `### ${section.title}`,
          '',
          `${section.title} 的局部判断必须回到研究主线：${input.frame.coreResearchThread} [claim:${claimId}]。结构化证据表明，这一问题需要在写作前完成 brief approval、证据绑定、引用解析和质量校验 [claim:${claimId}]。`,
          '',
          `对 ${section.title} 而言，报告完成不能只看任务是否执行 [claim:${claimId}]。原因是未经验证的材料即使数量充足，也不能直接支撑这一问题的用户可见结论 [claim:${claimId}]。`,
          '',
          '因此，本节只在当前证据同时支持任务执行与材料验证时成立，不能用前者替代后者。',
          '',
          `${section.title} 的判断只覆盖当前测试中的结构化证据 [claim:${claimId}]。真实研究仍要检查来源质量和反面证据，因此这一结论必须保留适用边界 [claim:${claimId}]。`
        ].join('\n')
      })
    const conclusionClaims = sectionClaims
      .filter((claim): claim is AtomicClaim => Boolean(claim))
      .map((claim) => `${claim.text} [claim:${claim.id}]`)
      .join('。')
    const body = [
      `# ${input.brief.topic}`,
      '',
      '## 主要发现',
      '',
      ...sectionLines,
      '',
      '## 结论与建议',
      '',
      `${input.frame.coreResearchThread} ${conclusionClaims}。这意味着运行完成要同时满足需求确认、证据绑定和质量验收，不能把其中任一步骤替代成最终结论。因此，当前证据支持的是一条受约束的完整交付链，而不是仅凭任务状态宣告研究成功。`,
      '',
      '## 局限与不确定性',
      '',
      '当前测试使用合成证据，只验证 runtime gate，不能外推到真实网页来源的内容质量。真实研究还需要外部来源和真实 LLM Judge 共同验证，当前测试没有覆盖这两个边界。',
      '',
      '## 后续研究建议',
      '',
      '补充真实来源并运行端到端 judge。'
    ].join('\n')
    return {
      markdown: body,
      claimIds: usedClaimIds,
      generatedAt: input.nowIso
    }
  }
}

class CountingSynthesisWriter extends PassingSynthesisWriter {
  calls = 0

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.calls += 1
    return super.writeDraft(input)
  }
}

class FailOnceTerminalSynthesisWriter extends PassingSynthesisWriter {
  calls = 0

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.calls += 1
    if (this.calls === 1) throw new SynthesisWriterFailed('simulated terminal writer failure')
    return super.writeDraft(input)
  }
}

class ChangingSynthesisWriter extends PassingSynthesisWriter {
  calls = 0

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.calls += 1
    const draft = await super.writeDraft(input)
    const variant = this.calls === 1
      ? '当前测试使用合成证据'
      : this.calls === 2
        ? '本次测试使用合成证据'
        : '此项测试使用合成证据'
    return {
      ...draft,
      markdown: draft.markdown.replace(
        '## 后续研究建议',
        `${variant}只验证当前运行链路，现有材料没有覆盖网页抽取失败时的恢复路径，也未验证不同网页实现的差异。\n\n## 后续研究建议`
      )
    }
  }
}

class LocallyFailingThenPassingWriter extends PassingSynthesisWriter {
  calls = 0
  readonly verificationAttempts: Array<number | undefined> = []
  readonly previousDrafts: Array<string | undefined> = []

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.calls += 1
    this.verificationAttempts.push(input.revision?.attempt)
    this.previousDrafts.push(input.revision?.previousDraftMarkdown)
    if (this.calls <= 1) throw new Error(`local draft validation failed ${this.calls}`)
    return super.writeDraft(input)
  }
}

class ModelCallConsumingFailingWriter extends PassingSynthesisWriter {
  calls = 0

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.calls += 1
    input.execution?.reserveModelCall('writer', 1)
    throw new SynthesisWriterFailed('consumed draft wave failed')
  }
}

class TerminalDeadLoopWriter extends PassingSynthesisWriter {
  calls = 0

  override async writeDraft(): Promise<DraftReport> {
    this.calls += 1
    throw new Error('section writer entered a repeated depth-repair dead loop: translated facet prose')
  }
}

class EvidenceRefreshTrackingWriter extends PassingSynthesisWriter {
  readonly claimIdsByAttempt: string[][] = []

  override async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    this.claimIdsByAttempt.push(input.claims.map((claim) => claim.id))
    return super.writeDraft(input)
  }
}

class PassingQualityJudge implements QualityJudge {
  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: true,
      scores: {
        requirementsAlignment: 0.92,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.91,
        reportCompleteness: 0.9,
        evidenceUse: 0.88,
        citationFaithfulness: 0.95,
        uncertaintyCalibration: 0.9,
        writingQuality: 0.92,
        overall: 0.91
      },
      rationale: `Report follows ${input.frame.coreResearchThread}`,
      blockingIssues: [],
      warnings: [],
      recommendedFixes: [],
      judgedAt: input.nowIso
    }
  }
}

class FailingQualityJudge implements QualityJudge {
  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: false,
      scores: {
        requirementsAlignment: 0.2,
        answersConfirmedScope: 0.3,
        followsResearchFrame: 0.2,
        reportCompleteness: 0.5,
        evidenceUse: 0.5,
        citationFaithfulness: 0.5,
        uncertaintyCalibration: 0.4,
        writingQuality: 0.5,
        overall: 0.31
      },
      rationale: `Report ignored ${input.scope.summary}`,
      blockingIssues: ['报告没有按已确认需求输出。'],
      warnings: [],
      recommendedFixes: ['重写报告，使其回应 scope、brief 和 frame。'],
      judgedAt: input.nowIso
    }
  }
}

class UnavailableQualityJudge implements QualityJudge {
  calls = 0

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    return {
      source: 'heuristic_fallback',
      pass: false,
      failureKind: 'judge_unavailable',
      scores: {
        requirementsAlignment: 0,
        answersConfirmedScope: 0,
        followsResearchFrame: 0,
        reportCompleteness: 0,
        evidenceUse: 0,
        citationFaithfulness: 0,
        uncertaintyCalibration: 0,
        writingQuality: 0,
        overall: 0
      },
      rationale: 'Judge infrastructure unavailable.',
      blockingIssues: ['LLM Judge 两次均未返回可用结果。'],
      warnings: [],
      recommendedFixes: ['检查 Judge 模型连接。'],
      judgedAt: input.nowIso
    }
  }
}

class WordingOnlyFailingJudge implements QualityJudge {
  calls = 0

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: false,
      failureKind: 'report_quality',
      scores: {
        requirementsAlignment: 0.6,
        answersConfirmedScope: 0.6,
        followsResearchFrame: 0.6,
        reportCompleteness: 0.6,
        evidenceUse: 0.8,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.6,
        writingQuality: 0.4,
        overall: 0.6
      },
      rationale: 'Evidence exists, but the prose is not decisive.',
      blockingIssues: ['报告没有清楚回答 core question 与 trade-off。'],
      warnings: [],
      recommendedFixes: ['重写结论表达，不要重新检索。'],
      judgedAt: input.nowIso
    }
  }
}

class ShiftingWordingQualityJudge implements QualityJudge {
  calls = 0

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    const first = this.calls === 1
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: false,
      failureKind: 'report_quality',
      scores: {
        requirementsAlignment: 0.6,
        answersConfirmedScope: 0.5,
        followsResearchFrame: 0.5,
        reportCompleteness: 0.4,
        evidenceUse: 0.5,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.6,
        writingQuality: 0.4,
        overall: 0.5
      },
      rationale: 'The report remains in the same incomplete writing state.',
      issues: [{
        code: first ? 'incomplete_report' : 'missing_core_analysis',
        category: 'coverage',
        message: first ? '核心章节不完整。' : '核心章节缺少必要分析。',
        severity: 'blocking'
      }],
      blockingIssues: [first ? '核心章节不完整。' : '核心章节缺少必要分析。'],
      warnings: [],
      recommendedFixes: ['补齐核心章节。'],
      judgedAt: input.nowIso
    }
  }
}

class WordingThenPassingJudge extends PassingQualityJudge {
  calls = 0

  override async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    if (this.calls > 1) return super.judge(input)
    return new WordingOnlyFailingJudge().judge(input)
  }
}

class TwoWordingFailuresThenPassingJudge extends PassingQualityJudge {
  calls = 0

  override async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    if (this.calls > 2) return super.judge(input)
    return new WordingOnlyFailingJudge().judge(input)
  }
}

class ImprovingWordingFailuresThenPassingJudge extends PassingQualityJudge {
  calls = 0

  override async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    if (this.calls > 2) return super.judge(input)
    const failed = await new WordingOnlyFailingJudge().judge(input)
    if (this.calls === 1) return failed
    return {
      ...failed,
      scores: {
        ...failed.scores,
        answersConfirmedScope: 0.7,
        followsResearchFrame: 0.7,
        reportCompleteness: 0.7,
        writingQuality: 0.5,
        overall: 0.65
      }
    }
  }
}

class EvidenceRepairThenPassJudge extends PassingQualityJudge {
  calls = 0

  override async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    if (this.calls > 1) return super.judge(input)
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: false,
      failureKind: 'report_quality',
      scores: {
        requirementsAlignment: 0.9,
        answersConfirmedScope: 0.9,
        followsResearchFrame: 0.9,
        reportCompleteness: 0.9,
        evidenceUse: 0.4,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.8,
        writingQuality: 0.9,
        overall: 0.6
      },
      rationale: 'One more independent source is required.',
      issues: [{ code: 'independent_source_missing', category: 'evidence', message: '核心问题需要补充一个独立来源。', severity: 'blocking' }],
      blockingIssues: ['核心问题需要补充一个独立来源。'],
      warnings: [],
      recommendedFixes: ['补充独立来源后重写。'],
      judgedAt: input.nowIso
    }
  }
}

class RepeatedEvidenceGapJudge implements QualityJudge {
  calls = 0

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    this.calls += 1
    const improved = this.calls > 1
    return {
      source: 'llm_judge',
      model: 'fake-judge',
      pass: false,
      failureKind: 'report_quality',
      scores: {
        requirementsAlignment: improved ? 0.75 : 0.65,
        answersConfirmedScope: improved ? 0.75 : 0.65,
        followsResearchFrame: improved ? 0.75 : 0.65,
        reportCompleteness: improved ? 0.7 : 0.6,
        evidenceUse: improved ? 0.7 : 0.55,
        citationFaithfulness: 0.9,
        uncertaintyCalibration: 0.75,
        writingQuality: improved ? 0.65 : 0.6,
        overall: improved ? 0.7 : 0.6
      },
      rationale: 'The evidence ledger grew, but the report still lacks the same independent support.',
      issues: [{
        code: 'independent_source_missing',
        category: 'evidence',
        message: '核心判断仍缺少一个真正独立且能改变分析的来源。',
        severity: 'blocking'
      }],
      blockingIssues: ['核心判断仍缺少一个真正独立且能改变分析的来源。'],
      warnings: [],
      recommendedFixes: ['补充能改变分析结论的独立来源。'],
      judgedAt: input.nowIso
    }
  }
}

class FakeResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    const source: SourceRecord = {
      id: 'source_1',
      sourceType: 'local_file',
      title: 'Fake local source',
      path: '/fake/source.md',
      accessedAt: '2026-06-29T00:00:02.000Z',
      importedAt: '2026-06-29T00:00:02.000Z',
      reliability: 'high',
      reliabilityReason: 'Controlled fake source for deterministic test.',
      sourcePolicyTags: ['fake-corpus'],
      fingerprint: hashText('fake-local-source'),
      status: 'fetched'
    }
    const span: EvidenceSpan = {
      id: 'span_1',
      sourceId: source.id,
      text: 'DeepResearch P0 reduces report risk by enforcing brief approval, evidence spans, and deterministic verifier checks.',
      textHash: hashText('DeepResearch P0 reduces report risk by enforcing brief approval, evidence spans, and deterministic verifier checks.'),
      location: {
        lineStart: 1,
        lineEnd: 1
      },
      extractedAt: '2026-06-29T00:00:03.000Z',
      extractorRunId: 'rr_test_1'
    }
    const claim: AtomicClaim = {
      id: 'claim_1',
      text: 'DeepResearch P0 reduces report risk by enforcing brief approval, evidence spans, and deterministic verifier checks.',
      entities: ['DeepResearch P0'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_1',
      taskId: input.task.id,
      questionIds: input.task.reportQuestionIds ?? input.task.questionIds,
      claimIds: [claim.id],
      summary: 'The fake source supports the P0 architecture with explicit approval, evidence, citation, and verifier controls.',
      implicationForBrief: 'The core path should prioritize runtime-controlled approval, evidence capture, citation binding, and verifier gates.',
      confidence: 'high',
      limitations: ['This is a fake corpus record for runtime testing.']
    }
    return {
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      unresolvedQuestions: [],
      conflicts: [],
      suggestedNextQueries: []
    }
  }
}

class RepairingResearchTaskWorker implements ResearchTaskWorker {
  calls = 0

  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    this.calls += 1
    if (this.calls === 1) {
      const initial = mergeWorkerResults(input.task.id, [
        workerResultForSource(input.task.id, makeSourceRecord('source_initial_1'), 'span_initial_1', 'claim_initial_1'),
        workerResultForSource(input.task.id, makeSourceRecord('source_initial_2'), 'span_initial_2', 'claim_initial_2')
      ])
      initial.notes = initial.notes.map((note) => ({
        ...note,
        limitations: ['反例边界：多个独立来源仍可能共享相同盲点，不能保证结论完整。']
      }))
      return initial
    }
    return workerResultForSource(input.task.id, makeSourceRecord('source_repair'), 'span_repair', 'claim_repair')
  }
}

class RepeatedRepairingResearchTaskWorker implements ResearchTaskWorker {
  calls = 0

  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    this.calls += 1
    const suffix = String(this.calls)
    const result = workerResultForSource(
      input.task.id,
      makeSourceRecord(`source_quality_loop_${suffix}`),
      `span_quality_loop_${suffix}`,
      `claim_quality_loop_${suffix}`
    )
    result.notes = result.notes.map((note) => ({
      ...note,
      limitations: ['反例边界：新增来源不等于分析质量已经改善。']
    }))
    return result
  }
}

class CountingResearchTaskWorker extends FakeResearchTaskWorker {
  calls = 0

  override async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    this.calls += 1
    return super.runTask(input)
  }
}

class UsageResearchTaskWorker extends FakeResearchTaskWorker {
  override async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    return {
      ...(await super.runTask(input)),
      modelUsage: [{
        stage: 'worker',
        model: 'fake-research-model',
        turnId: 'research_worker_usage',
        taskId: 'task_1',
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150,
          cachedTokens: 80,
          cacheHitTokens: 80,
          cacheMissTokens: 40,
          cacheHitRate: 80 / 120,
          turns: 1
        }
      }]
    }
  }
}

class ModelCallBudgetResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    input.execution?.reserveModelCall('worker')
    input.execution?.reserveModelCall('worker')
    return new FakeResearchTaskWorker().runTask(input)
  }
}

class BlockingResearchTaskWorker implements ResearchTaskWorker {
  readonly started: Promise<void>
  abortCount = 0
  private markStarted!: () => void

  constructor() {
    this.started = new Promise((resolve) => {
      this.markStarted = resolve
    })
  }

  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    this.markStarted()
    const signal = input.execution?.signal
    if (!signal) throw new Error('test worker requires execution signal')
    return new Promise<WorkerResult>((_resolve, reject) => {
      const rejectForAbort = () => {
        this.abortCount += 1
        reject(signal.reason instanceof Error ? signal.reason : new Error('research run aborted'))
      }
      if (signal.aborted) {
        rejectForAbort()
        return
      }
      signal.addEventListener('abort', rejectForAbort, { once: true })
    })
  }
}

class RecordingResearchTaskWorker implements ResearchTaskWorker {
  readonly taskIds: string[] = []

  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    this.taskIds.push(input.task.id)
    const suffix = input.task.id.replace(/\W+/g, '_')
    const source: SourceRecord = {
      id: `source_${suffix}`,
      sourceType: 'local_file',
      title: `Source for ${input.task.id}`,
      path: `/fake/${input.task.id}.md`,
      accessedAt: '2026-06-29T00:00:02.000Z',
      importedAt: '2026-06-29T00:00:02.000Z',
      reliability: 'high',
      reliabilityReason: 'Controlled fake source for deterministic test.',
      sourcePolicyTags: ['fake-corpus'],
      fingerprint: hashText(`source_${suffix}`),
      status: 'fetched'
    }
    const span: EvidenceSpan = {
      id: `span_${suffix}`,
      sourceId: source.id,
      text: `Evidence for ${input.task.objective} shows the task was executed and produced structured material.`,
      textHash: hashText(`span_${suffix}`),
      location: { paragraphIndex: 1 },
      extractedAt: '2026-06-29T00:00:02.000Z',
      extractorRunId: input.runId
    }
    const claim: AtomicClaim = {
      id: `claim_${suffix}`,
      text: `${input.task.objective} has enough fake evidence for runtime verification.`,
      entities: [],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: input.task.priority === 'high'
    }
    const note: ResearchNote = {
      id: `note_${suffix}`,
      taskId: input.task.id,
      questionIds: input.task.reportQuestionIds ?? input.task.questionIds,
      claimIds: [claim.id],
      summary: `Completed ${input.task.id}.`,
      implicationForBrief: `${input.task.objective} 已被结构化证据覆盖。`,
      confidence: 'high',
      limitations: input.task.questionIds.includes('q4')
        ? ['包含局限、反例或边界条件，用于验证 coverage matrix 的退出条件。']
        : []
    }
    return {
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      unresolvedQuestions: [],
      conflicts: [],
      suggestedNextQueries: []
    }
  }
}

class PartialFailureResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    if (input.task.id === 'task_fail') throw new Error('simulated worker timeout')
    const source = makeSourceRecord(`source_${input.task.id}`)
    return workerResultForSource(input.task.id, source, `span_${input.task.id}`, `claim_${input.task.id}`)
  }
}

class BadResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    return {
      ...(await new FakeResearchTaskWorker().runTask(input)),
      markdown: '## This worker should not write report prose'
    } as WorkerResult
  }
}

class DisallowedSourceResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    const result = await new FakeResearchTaskWorker().runTask(input)
    return {
      ...result,
      sources: result.sources.map((source) => ({ ...source, sourceType: 'web' }))
    }
  }
}

class EmptyResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(input: Parameters<ResearchTaskWorker['runTask']>[0]): Promise<WorkerResult> {
    const note: ResearchNote = {
      id: `note_${input.task.id}`,
      taskId: input.task.id,
      questionIds: input.task.reportQuestionIds ?? input.task.questionIds,
      claimIds: [],
      summary: 'Worker completed but did not find any usable source.',
      implicationForBrief: 'This task still needs more external evidence before synthesis.',
      confidence: 'low',
      limitations: ['No sources were returned.']
    }
    return {
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      sources: [],
      evidenceSpans: [],
      claims: [],
      notes: [note],
      unresolvedQuestions: input.task.questionIds,
      conflicts: [],
      suggestedNextQueries: input.task.searchHints
    }
  }
}

class NoCapabilityResearchTaskWorker implements ResearchTaskWorker {
  async runTask(): Promise<WorkerResult> {
    throw new Error('NoCapabilityResearchTaskWorker should be blocked before research starts')
  }
}

function makeBrief(): ResearchBrief {
  return {
    id: 'brief_1',
    version: 1,
    topic: 'DeepResearch P0',
    userIntent: 'Validate the minimum non-UI DeepResearch pipeline.',
    outputFormat: 'Markdown report',
    sourcePolicy: {
      allowedSourceTypes: ['local_file'],
      minSourceCount: 1,
      maxSourceCount: 1,
      requireCitations: true
    },
    successCriteria: ['The run produces a cited report package.'],
    constraints: ['Use fake data only.'],
    createdAt: '2026-06-29T00:00:00.000Z'
  }
}

function makeFrame(): ResearchFrame {
  return {
    coreResearchThread: 'Can Kun DeepResearch enforce a runtime-controlled report pipeline before UI work starts?',
    centralQuestion: 'Does the P0 pipeline create a verified, cited report package from structured evidence?',
    coreQuestions: [{
      id: 'q1',
      text: 'Can the runtime produce a verified report from structured notes?',
      priority: 'high',
      required: true
    }],
    investigationPath: ['Confirm brief', 'Create task', 'Collect evidence', 'Write report', 'Verify and persist'],
    evidenceNeeded: ['At least one evidence span that supports one atomic claim.'],
    disconfirmingEvidenceNeeded: ['A broken citation should fail verification.'],
    nonGoals: ['Do not test UI rendering.']
  }
}

function makeMultiQuestionFrame(): ResearchFrame {
  return {
    ...makeFrame(),
    coreQuestions: [
      { id: 'q1', text: 'Can the runtime define the research scope?', priority: 'high', required: true },
      { id: 'q2', text: 'Can the runtime collect evidence for facts?', priority: 'high', required: true },
      { id: 'q3', text: 'Can the runtime cover mechanism questions?', priority: 'high', required: true },
      { id: 'q4', text: 'Can the runtime cover limitations and next steps?', priority: 'medium', required: false }
    ],
    evidenceNeeded: [
      'Scope evidence.',
      'Fact evidence.',
      'Mechanism evidence.',
      'Limitation evidence.'
    ]
  }
}

function makeScope(): ResearchScopeAssessment {
  return {
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    summary: 'The user wants to validate the DeepResearch P0 runtime pipeline.',
    mainContradiction: 'The core tension is whether the runtime enforces approval, evidence, and verification before writing.',
    assumptions: ['Use deterministic fake evidence.', 'Keep the report cited.'],
    clarificationQuestions: [],
    confirmationChecklist: [
      '需求理解：验证 DeepResearch P0 runtime pipeline。',
      '核心问题：是否能强制 brief approval、证据绑定和校验。'
    ],
    createdAt: '2026-06-29T00:00:00.000Z'
  }
}

function makeSourceRecord(id: string): SourceRecord {
  return {
    id,
    sourceType: 'local_file',
    title: `Synthetic source ${id}`,
    path: `/fake/${id}.md`,
    accessedAt: '2026-06-29T00:00:02.000Z',
    importedAt: '2026-06-29T00:00:02.000Z',
    reliability: 'medium',
    reliabilityReason: 'Synthetic source for budget accounting regression test.',
    sourcePolicyTags: ['fake-corpus'],
    fingerprint: hashText(id),
    status: 'fetched'
  }
}

function workerResultForSource(
  taskId: string,
  source: SourceRecord,
  spanId: string,
  claimId: string
): WorkerResult {
  const text = 'The research runtime uses structured evidence and deterministic verification before completing a report.'
  return {
    taskId,
    questionIds: ['q1'],
    sources: [source],
    evidenceSpans: [{
      id: spanId,
      sourceId: source.id,
      text,
      textHash: hashText(`${spanId}:${text}`),
      location: { lineStart: 1, lineEnd: 1 },
      extractedAt: '2026-06-29T00:00:00.000Z',
      extractorRunId: 'rr_test'
    }],
    claims: [{
      id: claimId,
      text,
      entities: ['research runtime'],
      claimType: 'fact',
      supportSpanIds: [spanId],
      confidence: 'high',
      critical: true
    }],
    notes: [{
      id: `note_${taskId}_${claimId}`,
      taskId,
      questionIds: ['q1'],
      claimIds: [claimId],
      summary: 'Structured evidence was collected.',
      implicationForBrief: 'The required question has direct evidence.',
      confidence: 'high',
      limitations: []
    }],
    unresolvedQuestions: [],
    conflicts: [],
    suggestedNextQueries: []
  }
}

function mergeWorkerResults(taskId: string, results: WorkerResult[]): WorkerResult {
  return {
    taskId,
    questionIds: [...new Set(results.flatMap((result) => result.questionIds))],
    sources: results.flatMap((result) => result.sources),
    evidenceSpans: results.flatMap((result) => result.evidenceSpans),
    claims: results.flatMap((result) => result.claims),
    notes: results.flatMap((result) => result.notes),
    unresolvedQuestions: results.flatMap((result) => result.unresolvedQuestions),
    conflicts: results.flatMap((result) => result.conflicts),
    suggestedNextQueries: results.flatMap((result) => result.suggestedNextQueries)
  }
}

function makeResearchNoteForQuestion(questionId: string, claims: AtomicClaim[]): ResearchNote {
  return {
    id: `note_${questionId}`,
    taskId: `task_${questionId}`,
    questionIds: [questionId],
    claimIds: claims.map((claim) => claim.id),
    summary: `Question ${questionId} has enough per-question evidence.`,
    implicationForBrief: `Question ${questionId} is covered by the coverage matrix.`,
    confidence: 'high',
    limitations: questionId === 'q4' ? ['包含局限和边界条件，用于满足 deep preset 的反证覆盖要求。'] : []
  }
}

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-research-'))
  await mkdir(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

async function expectFile(path: string): Promise<void> {
  await expect(stat(path)).resolves.toMatchObject({ isFile: expect.any(Function) })
}

async function expectNoFile(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
}

function sectionText(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false
  for (const line of lines) {
    if (line.trim() === `## ${title}`) {
      collecting = true
      continue
    }
    if (collecting && /^##\s+/.test(line.trim())) break
    if (collecting) collected.push(line)
  }
  return collected.join('\n').trim()
}

function sequenceIds(prefix: string): () => string {
  let index = 0
  return () => `${prefix}_${++index}`
}

function sequenceTimes(): () => string {
  let index = 0
  return () => new Date(Date.UTC(2026, 5, 29, 0, 0, index++)).toISOString()
}
