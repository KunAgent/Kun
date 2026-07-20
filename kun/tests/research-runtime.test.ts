import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  BasicCoverageEvaluator,
  EvidenceStore,
  hashText,
  QualityVerifier,
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
  type SourceRecord,
  type WorkerResult
} from '../src/research/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ResearchRuntime P0 flow', () => {
  it('requires user brief approval before researching and writes the full artifact package', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const repository = new ResearchRunRepository({ workspaceRoot })
    const runtime = new ResearchRuntime({
      repository,
      worker: new FakeResearchTaskWorker(),
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
    expect(report).toContain('data-citation-id="cit_1"')
    expect(report).toContain('<sup data-citation-id="cit_1"')
    expect(report).not.toContain('[^cit_1]:')

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

  it('treats maxWorkers as a concurrency limit instead of truncating planned tasks', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const worker = new RecordingResearchTaskWorker()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker,
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
    expect(verdict.stopReason).toContain('剩余 92 个来源预算')
  })

  it('does not chase global source totals once coverage matrix is satisfied', async () => {
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
      text: `Covered evidence ${index + 1}.`,
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
        rationale: 'All questions are covered even though the global source total is below the old deep floor.',
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
    expect(verdict.followUpTasks).toHaveLength(0)
    expect(verdict.missingEvidence).toEqual([])
    expect(verdict.coverageMatrix.totalSourceCount).toBe(10)
    expect(verdict.coverageMatrix.coveredRequiredQuestionCount).toBe(3)
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

  it('keeps gap loop validation stable when a completed task returns zero sources', async () => {
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
    expect(failed?.plan?.tasks.some((task) => task.status === 'done' && task.maxSources === 0)).toBe(true)
    expect(failed?.verification?.blockingIssues.join('\n')).not.toContain('maxSources')
    expect(failed?.gapVerdicts?.map((verdict) => verdict.status)).toEqual(['need_more', 'budget_exhausted'])
    await expectNoFile(failed?.artifacts.reportPath ?? '')
    expect(failed?.draftReportAvailable).not.toBe(true)
    expect(failed?.verification?.warnings.join('\n')).toContain('未调用 Synthesis Writer 或 LLM Judge')
  })

  it('blocks standard reports when required question coverage is still below the preset', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
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

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/证据收集未达到 standard preset/)
    const failed = runtime.getRun(run.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.gapVerdicts?.at(-1)?.status).toBe('budget_exhausted')
    expect(failed?.verification?.blockingIssues.join('\n')).toContain('证据收集未达到 standard preset')
    await expectNoFile(failed?.artifacts.reportPath ?? '')
    expect(failed?.draftReportAvailable).not.toBe(true)
  })

  it('blocks completion when the quality judge rejects requirement alignment', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const runtime = new ResearchRuntime({
      repository: new ResearchRunRepository({ workspaceRoot }),
      worker: new FakeResearchTaskWorker(),
      qualityJudge: new FailingQualityJudge(),
      idGenerator: sequenceIds('rr_bad_judge'),
      nowIso: sequenceTimes()
    })
    const run = await runtime.createRun({ scope: makeScope(), brief: makeBrief(), frame: makeFrame(), budget: { maxWorkers: 1, maxSources: 1 } })
    await runtime.confirmScope(run.id, { confirmedByUser: true, source: 'api' })
    await runtime.approveBrief(run.id, { approvedByUser: true, briefHash: run.briefHash, source: 'api' })

    await expect(runtime.runConfirmedResearch(run.id)).rejects.toThrow(/报告没有按已确认需求输出/i)
    const failed = runtime.getRun(run.id)
    expect(failed?.status).toBe('failed')
    expect(failed?.verification?.llmJudge?.pass).toBe(false)
    expect(failed?.verification?.scores.requirementsAlignment).toBe(0.2)
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

  it('EvidenceStore keeps duplicate span hashes addressable by id', async () => {
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
      text: 'The second claim must be able to reference the second span id.',
      entities: [],
      claimType: 'fact',
      supportSpanIds: [spanB.id],
      confidence: 'medium'
    }

    await store.addSource(source)
    await store.addEvidenceSpan(spanA)
    await store.addEvidenceSpan(spanB)
    await expect(store.addClaim(claimB)).resolves.toMatchObject({ id: claimB.id })
    expect(store.getEvidenceSpan(spanB.id)?.id).toBe(spanB.id)
  })

  it('QualityVerifier blocks reports that ignore user clarifications', () => {
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
    expect(verdict.blockingIssues.join('\n')).toContain('报告没有覆盖用户补充要求')
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

class FakeResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(): Promise<WorkerResult> {
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
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: 'The fake source supports the P0 architecture with explicit approval, evidence, citation, and verifier controls.',
      implicationForBrief: 'The core path should prioritize runtime-controlled approval, evidence capture, citation binding, and verifier gates.',
      confidence: 'high',
      limitations: ['This is a fake corpus record for runtime testing.']
    }
    return {
      taskId: 'task_1',
      questionIds: ['q1'],
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
      questionIds: input.task.questionIds,
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

class BadResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(): Promise<WorkerResult> {
    return {
      ...(await new FakeResearchTaskWorker().runTask()),
      markdown: '## This worker should not write report prose'
    } as WorkerResult
  }
}

class DisallowedSourceResearchTaskWorker implements ResearchTaskWorker {
  hasLocalEvidenceCapability(): boolean {
    return true
  }

  async runTask(): Promise<WorkerResult> {
    const result = await new FakeResearchTaskWorker().runTask()
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
      questionIds: input.task.questionIds,
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
