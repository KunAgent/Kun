/**
 * [INPUT]: 依赖 agents、携带模型选择的 core 状态机、EvidenceStore、WritableGate、RuntimeExecution/Policy/SynthesisPipeline 和 ResearchRunRepository
 * [OUTPUT]: 对外提供 ResearchRuntime 与 persistedEvidenceGapQuestionIds，持久化 DeepResearch run 的模型/Provider、状态、累计成本和单次尝试预算起点、失败或取消后证据复用重试并丢弃上次 Gap/验证状态派生的未完成补研队列、从已持久化蓝图和 Gap 死循环记录恢复补研穷尽问题、hypothesis/VOI/convergence loop、补研无语义进展后的 evidence_gap 受限交付、写作前闸门、编辑流水线、落盘和报告校验
 * [POS]: research/runtime 的编排核心，连接 scope、章节 supervisor、workers、进展驱动 gap、WritableGate、主编、作者、编辑、citations 和 verifier
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { randomUUID } from 'node:crypto'
import { BasicCoverageEvaluator } from '../agents/GapAnalyzer.js'
import {
  BasicConvergenceAnalyzer,
  BasicEvidenceBinder,
  BasicFrameRevisionGate,
  BasicHypothesisAssessor,
  BasicHypothesisProposer,
  BasicTestDesigner,
  selectTasksByValueOfInformation
} from '../agents/HypothesisAgent.js'
import { BasicPlanAgent } from '../agents/PlanAgent.js'
import { BasicReportArchitect } from '../agents/ReportArchitect.js'
import { PassThroughResearchEditor } from '../agents/ResearchEditor.js'
import { BasicResearchSupervisor } from '../agents/SupervisorAgent.js'
import { BasicSynthesisWriter } from '../agents/SynthesisWriter.js'
import type {
  CitationResolution,
  ConvergenceAnalyzer,
  CoverageEvaluator,
  EvidenceBinder,
  FrameRevisionGate,
  HypothesisAssessor,
  HypothesisProposer,
  PlanAgent,
  ReportArchitect,
  ResearchEditor,
  ResearchSupervisor,
  ResearchTaskWorker,
  SynthesisWriter,
  TestDesigner
} from '../agents/types.js'
import { hashJson } from '../core/hash.js'
import type { ResearchEvent, ResearchEventInput } from '../core/events.js'
import { resolveResearchBudget } from '../core/presets.js'
import { assertCanStartResearch, transitionResearchStatus } from '../core/state-machine.js'
import { throwIfResearchAborted } from '../core/abort.js'
import type {
  BriefApproval,
  QualityVerdict,
  ResearchBrief,
  ResearchBudget,
  ResearchConvergenceVerdict,
  ResearchFrame,
  ResearchGapVerdict,
  HypothesisTest,
  ResearchModelUsageRecord,
  ResearchExecutionControl,
  ResearchPlan,
  ResearchRun,
  ResearchScopeAssessment,
  ResearchScopeClarification,
  ResearchTask,
  ScopeConfirmation,
  SectionEvidenceMapEntry
} from '../core/types.js'
import {
  validateResearchBrief,
  validateResearchFrame,
  validateResearchPlan,
  validateResearchScopeAssessment
} from '../core/validation.js'
import { CitationResolver } from '../evidence/CitationResolver.js'
import { EvidenceStore } from '../evidence/EvidenceStore.js'
import { eligibleEvidenceSourceCount } from '../evidence/EvidenceEligibility.js'
import type { EvidenceSpan, SourceRecord } from '../evidence/types.js'
import {
  evidenceVerdictBeforeSynthesis,
  normalizeGapVerdict,
  PlanAgentSupervisor,
  shouldRunDeepVoiFollowUp,
  tasksFromHighValueTests
} from './ResearchRuntimePolicy.js'
import { applyResearchProgressGuard } from './ResearchProgressGuard.js'
import {
  recordResearchModelUsage,
  ResearchExecutionController,
  runResearchTaskBatch
} from './ResearchRuntimeExecution.js'
import { runResearchSynthesisPipeline } from './ResearchSynthesisPipeline.js'
import { renderBriefMarkdown } from '../markdown/BriefRenderer.js'
import { renderFinalReportMarkdown } from '../markdown/ReportRenderer.js'
import { renderNotesMarkdown } from '../markdown/NotesRenderer.js'
import { renderPlanMarkdown } from '../markdown/PlanRenderer.js'
import { renderSourcesMarkdown } from '../markdown/SourcesRenderer.js'
import { preflightResearchRun } from './ResearchPreflightGate.js'
import { evaluateWritableGate } from './ResearchWritableGate.js'
import {
  loadPersistedResearchRuns,
  prepareInterruptedResearchRunForResume,
  prepareRecoveredResearchRound
} from './ResearchRuntimeRecovery.js'
import {
  runVerificationEvidenceRepair,
  type VerificationEvidenceRepairResult
} from './ResearchVerificationRepair.js'
import type { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { HeuristicQualityJudge, mergeQualityVerdictWithJudge, type QualityJudge } from '../verification/QualityJudge.js'
import { QualityVerifier } from '../verification/QualityVerifier.js'
import type {
  AnswerScopeInput,
  ApproveBriefInput,
  CompletedResearchRun,
  ConfirmScopeInput,
  CreateResearchRunInput,
  ResearchRuntimeOptions
} from './ResearchRuntimeTypes.js'

export type {
  AnswerScopeInput,
  ApproveBriefInput,
  CompletedResearchRun,
  ConfirmScopeInput,
  CreateResearchRunInput,
  ResearchRuntimeOptions
} from './ResearchRuntimeTypes.js'

export class ResearchRuntime {
  private readonly runs = new Map<string, ResearchRun>()
  private readonly executionController = new ResearchExecutionController()
  private readonly planAgent: PlanAgent
  private readonly supervisor: ResearchSupervisor
  private readonly hypothesisProposer: HypothesisProposer
  private readonly testDesigner: TestDesigner
  private readonly evidenceBinder: EvidenceBinder
  private readonly hypothesisAssessor: HypothesisAssessor
  private readonly frameRevisionGate: FrameRevisionGate
  private readonly convergenceAnalyzer: ConvergenceAnalyzer
  private readonly coverageEvaluator: CoverageEvaluator
  private readonly worker: ResearchTaskWorker
  private readonly reportArchitect: ReportArchitect
  private readonly synthesisWriter: SynthesisWriter
  private readonly researchEditor: ResearchEditor
  private readonly citationResolver: CitationResolver
  private readonly qualityVerifier: QualityVerifier
  private readonly qualityJudge: QualityJudge
  private readonly idGenerator: () => string
  private readonly nowIso: () => string

  constructor(private readonly options: ResearchRuntimeOptions) {
    this.planAgent = options.planAgent ?? new BasicPlanAgent()
    this.supervisor = options.supervisor ?? (options.planAgent ? new PlanAgentSupervisor(this.planAgent) : new BasicResearchSupervisor())
    this.hypothesisProposer = options.hypothesisProposer ?? new BasicHypothesisProposer()
    this.testDesigner = options.testDesigner ?? new BasicTestDesigner()
    this.evidenceBinder = options.evidenceBinder ?? new BasicEvidenceBinder()
    this.hypothesisAssessor = options.hypothesisAssessor ?? new BasicHypothesisAssessor()
    this.frameRevisionGate = options.frameRevisionGate ?? new BasicFrameRevisionGate()
    this.convergenceAnalyzer = options.convergenceAnalyzer ?? new BasicConvergenceAnalyzer()
    this.coverageEvaluator = options.coverageEvaluator ?? new BasicCoverageEvaluator()
    this.worker = options.worker
    this.reportArchitect = options.reportArchitect ?? new BasicReportArchitect()
    this.synthesisWriter = options.synthesisWriter ?? new BasicSynthesisWriter()
    this.researchEditor = options.researchEditor ?? new PassThroughResearchEditor()
    this.citationResolver = options.citationResolver ?? new CitationResolver()
    this.qualityVerifier = options.qualityVerifier ?? new QualityVerifier()
    this.qualityJudge = options.qualityJudge ?? new HeuristicQualityJudge()
    this.idGenerator = options.idGenerator ?? randomUUID
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async createRun(input: CreateResearchRunInput): Promise<ResearchRun> {
    validateResearchScopeAssessment(input.scope)
    validateResearchBrief(input.brief)
    validateResearchFrame(input.frame)

    const runId = this.idGenerator()
    const createdAt = this.nowIso()
    const title = input.title ?? input.brief.topic
    const briefHash = hashJson(input.brief)
    const layout = await this.options.repository.createRunLayout({ runId, title, createdAt })
    const run: ResearchRun = {
      id: runId,
      title,
      slug: title,
      status: 'scoping',
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      ...(input.providerId?.trim() ? { providerId: input.providerId.trim() } : {}),
      scope: input.scope,
      scopeClarifications: [],
      brief: input.brief,
      frame: input.frame,
      briefHash,
      budget: resolveResearchBudget({
        ...input.budget,
        isComparisonTopic: (input.frame.alternativesToCompare?.length ?? 0) >= 2
      }),
      modelBudgetUsage: {
        modelCalls: scopeModelCallCount(input.scope),
        totalTokens: 0,
        costUsd: 0,
        costCny: 0
      },
      hypotheses: [],
      hypothesisTests: [],
      hypothesisEvidenceBindings: [],
      hypothesisUpdates: [],
      frameRevisions: [],
      convergenceVerdicts: [],
      artifacts: layout,
      createdAt,
      updatedAt: createdAt
    }
    this.runs.set(runId, run)

    await this.record(run, { type: 'RUN_CREATED', topic: run.brief.topic, status: 'scoping' })
    await this.record(run, { type: 'SCOPE_ASSESSED', scope: input.scope })
    await recordResearchModelUsage({
      run,
      records: input.scope.modelUsage,
      record: (event) => this.record(run, event)
    })
    if (input.proposeBrief === true) {
      await this.record(run, { type: 'BRIEF_PROPOSED', briefHash, briefVersion: input.brief.version })
    }
    await this.options.repository.writeRun(run)
    return run
  }

  async answerScope(runId: string, input: AnswerScopeInput): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
    if (run.status !== 'scoping') {
      throw new Error(`Scope can only be clarified while scoping; current status is ${run.status}`)
    }
    const message = input.message.trim()
    if (!message) throw new Error('Scope clarification message is required')
    validateResearchScopeAssessment(input.scope)
    validateResearchBrief(input.brief)
    validateResearchFrame(input.frame)

    const clarification: ResearchScopeClarification = {
      id: this.idGenerator(),
      message,
      createdAt: this.nowIso()
    }
    run.scopeClarifications = [...run.scopeClarifications, clarification]
    run.title = input.brief.topic
    run.slug = input.brief.topic
    run.scope = input.scope
    run.brief = input.brief
    run.frame = input.frame
    run.briefHash = hashJson(input.brief)
    run.hypotheses = []
    run.hypothesisTests = []
    run.hypothesisEvidenceBindings = []
    run.hypothesisUpdates = []
    run.frameRevisions = []
    run.convergenceVerdicts = []
    run.artifacts = {
      ...run.artifacts,
      reportPath: this.options.repository.reportPathForTitle(run.artifacts, input.brief.topic)
    }
    await this.record(run, { type: 'SCOPE_CLARIFICATION_ADDED', clarification })
    await this.record(run, { type: 'SCOPE_ASSESSED', scope: input.scope })
    run.modelBudgetUsage.modelCalls += scopeModelCallCount(input.scope)
    await recordResearchModelUsage({
      run,
      records: input.scope.modelUsage,
      record: (event) => this.record(run, event)
    })
    await this.options.repository.writeRun(run)
    return run
  }

  async confirmScope(runId: string, input: ConfirmScopeInput): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
    if (run.status !== 'scoping') {
      throw new Error(`Scope can only be confirmed while scoping; current status is ${run.status}`)
    }
    if (!input.confirmedByUser) {
      throw new Error('Scope confirmation must come from the user; model-generated confirmation is not accepted')
    }
    if (!run.scope.readyForBrief) {
      throw new Error('Scope requires clarification before a research brief can be proposed')
    }

    const searchEnabled = this.worker.hasSearchCapability?.() ?? false
    const localEvidenceEnabled = this.worker.hasLocalEvidenceCapability?.() ?? false
    const allowedSourceTypes = run.brief.sourcePolicy.allowedSourceTypes
    const preset = run.budget.preset

    const webSearchEnabled = searchEnabled && allowedSourceTypes.includes('web')
    const userFilesAvailable = localEvidenceEnabled && allowedSourceTypes.some((t) => t !== 'web')

    if (!webSearchEnabled && !userFilesAvailable) {
      if (preset === 'standard' || preset === 'deep') {
        const confirmation: ScopeConfirmation = {
          confirmedByUser: true,
          confirmedAt: this.nowIso(),
          confirmationMessageId: input.confirmationMessageId,
          source: input.source
        }
        run.scopeConfirmation = confirmation
        await this.record(run, { type: 'SCOPE_CONFIRMED', confirmation })
        await this.record(run, {
          type: 'RESEARCH_UNAVAILABLE',
          reason: `evidence_blocking: 缺乏可验证的真实证据（Web搜索已禁用，且无本地文件支撑），Preset为 ${preset} 无法继续运行。`
        })
        await this.options.repository.writeRun(run)
        return run
      } else if (preset === 'quick') {
        run.brief.sourcePolicy = {
          ...run.brief.sourcePolicy,
          requireCitations: false
        }
        run.brief.constraints = [
          ...(run.brief.constraints ?? []),
          `由于系统网络检索功能未开启，且没有本地用户上传文件支撑，当前分析完全基于模型离线内置知识生成，未经任何真实外部来源交叉核验，不可作为决策凭证，报告中已去除所有伪造的文献上标引用。`
        ]
        run.briefHash = hashJson(run.brief)
      }
    }

    const confirmation: ScopeConfirmation = {
      confirmedByUser: true,
      confirmedAt: this.nowIso(),
      confirmationMessageId: input.confirmationMessageId,
      source: input.source
    }
    run.scopeConfirmation = confirmation
    await this.record(run, { type: 'SCOPE_CONFIRMED', confirmation })
    await this.record(run, { type: 'BRIEF_PROPOSED', briefHash: run.briefHash, briefVersion: run.brief.version })
    await this.options.repository.writeRun(run)
    return run
  }

  async approveBrief(runId: string, input: ApproveBriefInput): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
    if (run.status !== 'awaiting_brief_confirm') {
      throw new Error(`Brief can only be approved while awaiting confirmation; current status is ${run.status}`)
    }
    if (!input.approvedByUser) {
      throw new Error('Brief approval must come from the user; model-generated approval is not accepted')
    }
    if (input.briefHash !== run.briefHash) {
      throw new Error('Brief approval hash is stale')
    }
    const approval: BriefApproval = {
      briefVersion: run.brief.version,
      approvedByUser: true,
      approvedAt: this.nowIso(),
      approvalMessageId: input.approvalMessageId,
      briefHash: input.briefHash,
      source: input.source
    }
    run.approval = approval
    await this.record(run, {
      type: 'BRIEF_APPROVED',
      version: approval.briefVersion,
      briefHash: approval.briefHash,
      approval
    })
    await this.options.repository.writeRun(run)
    return run
  }

  async runConfirmedResearch(runId: string): Promise<CompletedResearchRun> {
    const run = this.mustGetRun(runId)
    assertCanStartResearch(run.status)
    if (run.approval?.approvedByUser !== true) {
      throw new Error('Research cannot start without user-approved brief')
    }

    const executionStartedAt = this.nowIso()
    run.executionDeadlineAt ??= new Date(Date.parse(executionStartedAt) + run.budget.timeoutMs).toISOString()
    const remainingTimeoutMs = Date.parse(run.executionDeadlineAt) - Date.parse(executionStartedAt)
    await this.options.repository.writeRun(run)
    const execution = this.executionController.start(
      run,
      (event) => this.record(run, event),
      remainingTimeoutMs
    )
    const evidenceStore = new EvidenceStore(this.options.repository, run.artifacts)
    await evidenceStore.hydrate()

    try {
      throwIfResearchAborted(execution.signal)
      const allowedSourceTypes = run.brief.sourcePolicy.allowedSourceTypes
      const preflight = preflightResearchRun({
        run,
        capabilities: {
          webSearchEnabled: (this.worker.hasSearchCapability?.() ?? false) && allowedSourceTypes.includes('web'),
          userFilesAvailable: (this.worker.hasLocalEvidenceCapability?.() ?? false) && allowedSourceTypes.some((type) => type !== 'web')
        },
        nowIso: this.nowIso()
      })
      if (preflight.frameRepaired) {
        run.frame = preflight.frame
        validateResearchFrame(run.frame)
      }
      run.reportContract = preflight.reportContract
      run.coverageContract = preflight.coverageContract
      await this.options.repository.writeRun(run)
      if (preflight.unavailableReason) {
        await this.record(run, { type: 'RESEARCH_UNAVAILABLE', reason: preflight.unavailableReason })
        await this.options.repository.writeRun(run)
        throw new Error(preflight.unavailableReason)
      }

      const hypotheses = run.hypotheses && run.hypotheses.length > 0
        ? run.hypotheses
        : await this.hypothesisProposer.propose({
            runId: run.id,
            brief: run.brief,
            frame: run.frame,
            budget: run.budget,
            nowIso: this.nowIso()
          })
      run.hypotheses = hypotheses
      if (!run.plan) await this.record(run, { type: 'HYPOTHESES_PROPOSED', hypotheses })

      const tests = run.hypothesisTests && run.hypothesisTests.length > 0
        ? run.hypothesisTests
        : await this.testDesigner.design({
            runId: run.id,
            brief: run.brief,
            frame: run.frame,
            budget: run.budget,
            hypotheses,
            nowIso: this.nowIso()
          })
      run.hypothesisTests = tests
      if (!run.plan) await this.record(run, { type: 'HYPOTHESIS_TESTS_DESIGNED', tests })

      const plan = run.plan ?? await this.supervisor.createInitialPlan({
        runId: run.id,
        brief: run.brief,
        frame: run.frame,
        budget: run.budget,
        reportContract: run.reportContract,
        nowIso: this.nowIso()
      })
      if (!run.plan) {
        plan.tasks = selectTasksByValueOfInformation(plan.tasks, tests, {
          preset: run.budget.preset,
          maxSources: run.budget.maxSources
        })
      }
      validateResearchPlan(plan, run.frame, run.budget.maxSources)
      run.plan = plan
      run.gapVerdicts ??= []
      await this.record(run, { type: 'PLAN_CREATED', planId: plan.id, taskCount: plan.tasks.length, plan })

      const recoveredRound = await prepareRecoveredResearchRound({
        run,
        plan,
        evidenceStore,
        coverageEvaluator: this.coverageEvaluator,
        roundIndex: Math.max(1, (run.gapVerdicts?.length ?? 0) + 1),
        nowIso: () => this.nowIso(),
        record: (event) => this.record(run, event)
      })
      let { roundIndex, tasksForRound } = recoveredRound
      while (tasksForRound.length > 0) {
        throwIfResearchAborted(execution.signal)
        await this.runResearchTasks(run, tasksForRound, evidenceStore, execution)
        await this.record(run, { type: 'RESEARCH_COMPLETED', taskCount: tasksForRound.length, roundIndex })
        const bindings = await this.evidenceBinder.bind({
          runId: run.id,
          hypotheses: run.hypotheses ?? [],
          claims: evidenceStore.listClaims(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          notes: evidenceStore.listNotes(),
          nowIso: this.nowIso()
        })
        run.hypothesisEvidenceBindings = bindings
        await this.record(run, { type: 'HYPOTHESIS_BINDINGS_CREATED', bindingCount: bindings.length, roundIndex })

        const assessment = await this.hypothesisAssessor.assess({
          runId: run.id,
          hypotheses: run.hypotheses ?? [],
          bindings,
          claims: evidenceStore.listClaims(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          nowIso: this.nowIso()
        })
        run.hypotheses = assessment.hypotheses
        run.hypothesisUpdates = [...(run.hypothesisUpdates ?? []), ...assessment.updates]
        await this.record(run, { type: 'HYPOTHESIS_ASSESSED', updates: assessment.updates, roundIndex })

        const frameRevision = await this.frameRevisionGate.revise({
          runId: run.id,
          brief: run.brief,
          frame: run.frame,
          hypotheses: run.hypotheses ?? [],
          updates: assessment.updates,
          bindings,
          nowIso: this.nowIso()
        })
        if (frameRevision.revision) {
          run.frame = frameRevision.frame
          run.frameRevisions = [...(run.frameRevisions ?? []), frameRevision.revision]
          validateResearchFrame(run.frame)
        }

        let gapVerdict = normalizeGapVerdict(await this.coverageEvaluator.evaluate({
          runId: run.id,
          brief: run.brief,
          frame: run.frame,
          plan,
          budget: run.budget,
          coverageContract: run.coverageContract,
          roundIndex,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          nowIso: this.nowIso()
        }))
        if (gapVerdict.status === 'need_more' || gapVerdict.status === 'needs_research_repair') {
          gapVerdict = {
            ...gapVerdict,
            followUpTasks: selectTasksByValueOfInformation(gapVerdict.followUpTasks, run.hypothesisTests ?? [], {
              preset: run.budget.preset,
              maxSources: Math.max(1, run.budget.maxSources - eligibleEvidenceSourceCount(evidenceStore.listSources(), evidenceStore.listEvidenceSpans()))
            })
          }
        }
        gapVerdict = applyResearchProgressGuard(run.gapVerdicts ?? [], gapVerdict).verdict
        run.gapVerdicts = [...(run.gapVerdicts ?? []), gapVerdict]
        await this.record(run, {
          type: 'GAP_CHECK_COMPLETED',
          verdict: gapVerdict,
          roundIndex,
          followUpTaskCount: gapVerdict.followUpTasks.length
        })
        await this.options.repository.writeRun(run)

        const convergence = await this.convergenceAnalyzer.analyze({
          runId: run.id,
          brief: run.brief,
          frame: run.frame,
          plan,
          budget: run.budget,
          roundIndex,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          nowIso: this.nowIso(),
          hypotheses: run.hypotheses ?? [],
          tests: run.hypothesisTests ?? [],
          bindings: run.hypothesisEvidenceBindings ?? [],
          updates: run.hypothesisUpdates ?? [],
          gapVerdict
        })
        run.convergenceVerdicts = [...(run.convergenceVerdicts ?? []), convergence]
        await this.record(run, { type: 'CONVERGENCE_ANALYZED', verdict: convergence, roundIndex })
        await this.options.repository.writeRun(run)

        if (gapVerdict.status !== 'need_more' && gapVerdict.status !== 'needs_research_repair') {
          const eligibleSourceCount = eligibleEvidenceSourceCount(evidenceStore.listSources(), evidenceStore.listEvidenceSpans())
          if (gapVerdict.status !== 'unanswerable' && shouldRunDeepVoiFollowUp(run, convergence, eligibleSourceCount, roundIndex)) {
            const followUpFromTests = tasksFromHighValueTests({
              tests: run.hypothesisTests ?? [],
              convergence,
              run,
              roundIndex,
              remainingSources: Math.max(0, run.budget.maxSources - eligibleSourceCount)
            })
            if (followUpFromTests.length > 0) {
              for (const task of followUpFromTests) {
                plan.tasks.push(task)
                await this.record(run, { type: 'FOLLOW_UP_TASK_CREATED', task, roundIndex: roundIndex + 1 })
              }
              validateResearchPlan(plan, run.frame, run.budget.maxSources)
              tasksForRound = followUpFromTests
              roundIndex += 1
              continue
            }
          }
          break
        }
        for (const task of gapVerdict.followUpTasks) {
          plan.tasks.push(task)
          await this.record(run, { type: 'FOLLOW_UP_TASK_CREATED', task, roundIndex: roundIndex + 1 })
        }
        validateResearchPlan(plan, run.frame, run.budget.maxSources)
        tasksForRound = gapVerdict.followUpTasks
        roundIndex += 1
      }

      const preSynthesisEvidenceVerdict = evidenceVerdictBeforeSynthesis(
        run,
        run.gapVerdicts?.at(-1),
        evidenceStore.listSources(),
        evidenceStore.listEvidenceSpans(),
        this.worker.hasSearchCapability?.() ?? false,
        this.nowIso()
      )
      if (preSynthesisEvidenceVerdict) {
        run.verification = preSynthesisEvidenceVerdict
        await this.options.repository.writeRun(run)
        throw new Error(`Research evidence collection failed: ${preSynthesisEvidenceVerdict.blockingIssues.join('; ')}`)
      }

      let sectionEvidenceMap: SectionEvidenceMapEntry[] = []
      if (run.budget.preset !== 'quick') {
        const exhaustedQuestionIds = persistedEvidenceGapQuestionIds(run)
        let writableGate = evaluateWritableGate({
          run,
          reportContract: run.reportContract,
          coverageContract: run.coverageContract,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          nowIso: this.nowIso(),
          allowEvidenceGapQuestionIds: exhaustedQuestionIds
        })
        while (!writableGate.ok && writableGate.verdict) {
          run.verification = writableGate.verdict
          await this.options.repository.writeRun(run)
          const repair = await this.runVerificationEvidenceRepair(run, plan, evidenceStore, writableGate.verdict, 0, execution)
          repair.exhaustedQuestionIds.forEach((questionId) => exhaustedQuestionIds.add(questionId))
          writableGate = evaluateWritableGate({
            run,
            reportContract: run.reportContract,
            coverageContract: run.coverageContract,
            sources: evidenceStore.listSources(),
            evidenceSpans: evidenceStore.listEvidenceSpans(),
            claims: evidenceStore.listClaims(),
            notes: evidenceStore.listNotes(),
            nowIso: this.nowIso(),
            allowEvidenceGapQuestionIds: exhaustedQuestionIds
          })
          if (!repair.progress) break
        }
        if (!writableGate.ok && writableGate.verdict) {
          run.verification = writableGate.verdict
          await this.options.repository.writeRun(run)
          throw new Error(`Research writable gate failed: ${writableGate.verdict.blockingIssues.join('; ')}`)
        }
        sectionEvidenceMap = writableGate.sectionEvidenceMap
      }

      const { resolvedReport, finalReportMarkdown } = await runResearchSynthesisPipeline({
        run,
        plan,
        evidenceStore,
        sectionEvidenceMap,
        execution,
        reportArchitect: this.reportArchitect,
        synthesisWriter: this.synthesisWriter,
        researchEditor: this.researchEditor,
        citationResolver: this.citationResolver,
        qualityVerifier: this.qualityVerifier,
        qualityJudge: this.qualityJudge,
        repository: this.options.repository,
        nowIso: this.nowIso,
        record: (event) => this.record(run, event),
        recordModelUsage: (records) => this.recordModelUsage(run, records, execution),
        repairEvidence: (verdict, attempt) => this.runVerificationEvidenceRepair(
          run,
          plan,
          evidenceStore,
          verdict,
          attempt,
          execution
        )
      })

      for (const binding of resolvedReport.bindings) {
        await evidenceStore.addCitation(binding)
      }

      await this.options.repository.writeMarkdownArtifacts(run.artifacts, {
        reportMarkdown: finalReportMarkdown,
        briefMarkdown: renderBriefMarkdown(run, run.brief, run.frame),
        planMarkdown: renderPlanMarkdown(plan),
        sourcesMarkdown: renderSourcesMarkdown(evidenceStore.listSources(), evidenceStore.listEvidenceSpans()),
        notesMarkdown: renderNotesMarkdown(evidenceStore.listNotes(), evidenceStore.listClaims())
      })
      await this.record(run, {
        type: 'REPORT_WRITTEN',
        reportPath: run.artifacts.reportPath,
        artifactPaths: [
          run.artifacts.reportPath,
          run.artifacts.briefPath,
          run.artifacts.planPath,
          run.artifacts.sourcesPath,
          run.artifacts.notesPath,
          run.artifacts.runJsonPath,
          run.artifacts.evidenceJsonlPath,
          run.artifacts.claimsJsonlPath,
          run.artifacts.citationsJsonlPath,
          run.artifacts.eventsJsonlPath
        ]
      })
      await this.options.repository.writeRun(run)
      return { run, resolvedReport }
    } catch (error) {
      this.executionController.cancel(run.id, error instanceof Error ? error.message : String(error))
      if (run.status !== 'failed' && run.status !== 'cancelled') {
        await this.record(run, { type: 'RUN_FAILED', reason: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
        await this.options.repository.writeRun(run).catch(() => undefined)
      }
      throw error
    } finally {
      this.executionController.stop(run.id)
    }
  }

  getRun(runId: string): ResearchRun | undefined {
    return this.runs.get(runId)
  }

  async restorePersistedRuns(): Promise<ResearchRun[]> {
    const runs = await loadPersistedResearchRuns(this.options.repository)
    for (const run of runs) this.runs.set(run.id, run)
    return runs
  }

  async prepareInterruptedRunForResume(runId: string): Promise<boolean> {
    const run = this.mustGetRun(runId)
    return prepareInterruptedResearchRunForResume(run, this.options.repository)
  }

  async retryFailedRun(runId: string): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      throw new Error(`Only a failed or cancelled research run can be retried; current status is ${run.status}`)
    }
    if (run.approval?.approvedByUser !== true) {
      throw new Error('Research cannot be retried without a user-approved brief')
    }
    const previousReason = run.terminalReason
    const retryStartedAt = this.nowIso()
    run.executionDeadlineAt = new Date(Date.parse(retryStartedAt) + run.budget.timeoutMs).toISOString()
    run.attemptBudgetBaseline = {
      modelCalls: run.modelBudgetUsage.modelCalls,
      totalTokens: run.modelBudgetUsage.totalTokens
    }
    if (run.plan) {
      run.plan.tasks = run.plan.tasks.filter((task) =>
        task.status === 'done' || !isDerivedResearchRepairTask(task.id)
      )
    }
    delete run.verification
    await this.record(run, { type: 'RUN_RETRIED', ...(previousReason ? { previousReason } : {}) })
    await this.options.repository.writeRun(run)
    return run
  }

  async cancelRun(runId: string, reason?: string): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
    this.executionController.cancel(runId, reason)
    await this.record(run, { type: 'RUN_CANCELLED', reason })
    await this.options.repository.writeRun(run)
    return run
  }

  private async record(run: ResearchRun, event: ResearchEventInput): Promise<void> {
    const completeEvent = {
      ...event,
      id: this.idGenerator(),
      runId: run.id,
      timestamp: this.nowIso()
    } as ResearchEvent
    run.status = transitionResearchStatus(run.status, completeEvent)
    if (completeEvent.type === 'RUN_FAILED' || completeEvent.type === 'RESEARCH_UNAVAILABLE') {
      run.terminalReason = completeEvent.reason
    } else if (completeEvent.type === 'RUN_RETRIED') {
      delete run.terminalReason
    } else if (completeEvent.type === 'VERIFICATION_COMPLETED' && run.status === 'failed') {
      run.terminalReason = completeEvent.verdict.blockingIssues[0]
        ?? completeEvent.verdict.llmJudge?.rationale
        ?? '报告质量校验未通过。'
    } else if (completeEvent.type === 'RUN_CANCELLED') {
      run.terminalReason = completeEvent.reason?.trim() || '研究任务已取消。'
    } else if (completeEvent.type === 'REPORT_WRITTEN') {
      delete run.terminalReason
    }
    run.updatedAt = completeEvent.timestamp
    await this.options.repository.appendEvent(run.artifacts, completeEvent)
  }

  private async recordModelUsage(
    run: ResearchRun,
    records: ResearchModelUsageRecord[] | undefined,
    execution?: ResearchExecutionControl
  ): Promise<void> {
    if (execution) {
      for (const record of records ?? []) await execution.recordModelUsage(record)
      return
    }
    await recordResearchModelUsage({
      run,
      records,
      record: (event) => this.record(run, event)
    })
  }

  private mustGetRun(runId: string): ResearchRun {
    const run = this.runs.get(runId)
    if (!run) {
      throw new Error(`Unknown research run ${runId}`)
    }
    return run
  }

  private async runResearchTasks(
    run: ResearchRun,
    tasks: ResearchTask[],
    evidenceStore: EvidenceStore,
    execution: ResearchExecutionControl
  ): Promise<void> {
    await runResearchTaskBatch({
      run,
      tasks,
      evidenceStore,
      execution,
      worker: this.worker,
      record: (event) => this.record(run, event),
      recordModelUsage: (records) => this.recordModelUsage(run, records, execution)
    })
  }

  private async runVerificationEvidenceRepair(
    run: ResearchRun,
    plan: ResearchPlan,
    evidenceStore: EvidenceStore,
    verdict: QualityVerdict,
    attempt: number,
    execution: ResearchExecutionControl
  ): Promise<VerificationEvidenceRepairResult> {
    return runVerificationEvidenceRepair({
      run,
      plan,
      evidenceStore,
      verdict,
      attempt,
      worker: this.worker,
      coverageEvaluator: this.coverageEvaluator,
      nowIso: () => this.nowIso(),
      runTasks: (tasks) => this.runResearchTasks(run, tasks, evidenceStore, execution),
      record: (event) => this.record(run, event),
      writeRun: () => this.options.repository.writeRun(run)
    })
  }

}

function isDerivedResearchRepairTask(taskId: string): boolean {
  return taskId.startsWith('verification_repair_') || taskId.startsWith('gap_')
}

function scopeModelCallCount(scope: ResearchScopeAssessment): number {
  if (scope.assessmentModel) return 1
  return Math.min(1, scope.modelUsage?.length ?? 0)
}

export function persistedEvidenceGapQuestionIds(run: ResearchRun): Set<string> {
  const questionIds = new Set((run.reportBlueprint?.sections ?? [])
    .filter((section) => section.evidenceMode === 'evidence_gap')
    .flatMap((section) => section.questionIds))
  for (const verdict of run.gapVerdicts ?? []) {
    for (const questionId of verdict.exhaustedQuestionIds ?? []) questionIds.add(questionId)
  }
  const latestGap = run.gapVerdicts?.at(-1)
  if (latestGap?.status === 'unanswerable') {
    for (const coverage of latestGap.coverageByQuestion) {
      if ((coverage.required || coverage.priority === 'high') && !coverage.covered) {
        questionIds.add(coverage.questionId)
      }
    }
  }
  return questionIds
}
