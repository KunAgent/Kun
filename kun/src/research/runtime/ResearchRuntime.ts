/**
 * [INPUT]: 依赖 agents、core 状态机、EvidenceStore、CitationResolver、QualityVerifier 和 ResearchRunRepository
 * [OUTPUT]: 对外提供 ResearchRuntime，负责 DeepResearch run 的状态、预算、hypothesis/VOI/convergence loop、落盘和报告校验
 * [POS]: research/runtime 的编排核心，连接 scope/brief gate、supervisor、hypothesis agents、workers、writer、citations 和 verifier，并按实际来源消耗回收未用预算
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
import { BasicResearchSupervisor } from '../agents/SupervisorAgent.js'
import { validateWorkerResult } from '../agents/ResearchTaskWorker.js'
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
  ResearchSupervisor,
  ResearchTaskWorker,
  SynthesisWriter,
  TestDesigner,
  WorkerResult
} from '../agents/types.js'
import { hashJson } from '../core/hash.js'
import type { ResearchEvent, ResearchEventInput } from '../core/events.js'
import { resolveResearchBudget } from '../core/presets.js'
import { assertCanStartResearch, transitionResearchStatus } from '../core/state-machine.js'
import type {
  BriefApproval,
  QualityVerdict,
  ResearchBrief,
  ResearchBudget,
  ResearchConvergenceVerdict,
  ResearchFrame,
  ResearchGapVerdict,
  HypothesisTest,
  ResearchPlan,
  ResearchRun,
  ResearchScopeAssessment,
  ResearchScopeClarification,
  ResearchTask,
  ScopeConfirmation
} from '../core/types.js'
import {
  validateResearchBrief,
  validateResearchFrame,
  validateResearchPlan,
  validateResearchScopeAssessment
} from '../core/validation.js'
import { CitationResolver } from '../evidence/CitationResolver.js'
import { EvidenceStore } from '../evidence/EvidenceStore.js'
import { canCiteEvidenceSpan } from '../evidence/EvidenceEligibility.js'
import type { EvidenceSpan, SourceRecord } from '../evidence/types.js'
import { renderBriefMarkdown } from '../markdown/BriefRenderer.js'
import { renderFinalReportMarkdown } from '../markdown/ReportRenderer.js'
import { renderNotesMarkdown } from '../markdown/NotesRenderer.js'
import { renderPlanMarkdown } from '../markdown/PlanRenderer.js'
import { renderSourcesMarkdown } from '../markdown/SourcesRenderer.js'
import type { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { HeuristicQualityJudge, mergeQualityVerdictWithJudge, type QualityJudge } from '../verification/QualityJudge.js'
import { QualityVerifier } from '../verification/QualityVerifier.js'

export type CreateResearchRunInput = {
  title?: string
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
  budget?: Partial<ResearchBudget>
  proposeBrief?: boolean
}

export type ConfirmScopeInput = {
  confirmedByUser: boolean
  confirmationMessageId?: string
  source: ScopeConfirmation['source']
}

export type AnswerScopeInput = {
  message: string
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
}

export type ApproveBriefInput = {
  approvedByUser: boolean
  briefHash: string
  approvalMessageId?: string
  source: BriefApproval['source']
}

export type ResearchRuntimeOptions = {
  repository: ResearchRunRepository
  planAgent?: PlanAgent
  supervisor?: ResearchSupervisor
  hypothesisProposer?: HypothesisProposer
  testDesigner?: TestDesigner
  evidenceBinder?: EvidenceBinder
  hypothesisAssessor?: HypothesisAssessor
  frameRevisionGate?: FrameRevisionGate
  convergenceAnalyzer?: ConvergenceAnalyzer
  coverageEvaluator?: CoverageEvaluator
  worker: ResearchTaskWorker
  synthesisWriter?: SynthesisWriter
  citationResolver?: CitationResolver
  qualityVerifier?: QualityVerifier
  qualityJudge?: QualityJudge
  idGenerator?: () => string
  nowIso?: () => string
}

export type CompletedResearchRun = {
  run: ResearchRun
  resolvedReport: CitationResolution
}

export class ResearchRuntime {
  private readonly runs = new Map<string, ResearchRun>()
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
  private readonly synthesisWriter: SynthesisWriter
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
    this.synthesisWriter = options.synthesisWriter ?? new BasicSynthesisWriter()
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
      scope: input.scope,
      scopeClarifications: [],
      brief: input.brief,
      frame: input.frame,
      briefHash,
      budget: resolveResearchBudget(input.budget),
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

    const evidenceStore = new EvidenceStore(this.options.repository, run.artifacts)

    try {
      const hypotheses = await this.hypothesisProposer.propose({
        runId: run.id,
        brief: run.brief,
        frame: run.frame,
        budget: run.budget,
        nowIso: this.nowIso()
      })
      run.hypotheses = hypotheses
      await this.record(run, { type: 'HYPOTHESES_PROPOSED', hypotheses })

      const tests = await this.testDesigner.design({
        runId: run.id,
        brief: run.brief,
        frame: run.frame,
        budget: run.budget,
        hypotheses,
        nowIso: this.nowIso()
      })
      run.hypothesisTests = tests
      await this.record(run, { type: 'HYPOTHESIS_TESTS_DESIGNED', tests })

      const plan = await this.supervisor.createInitialPlan({
        runId: run.id,
        brief: run.brief,
        frame: run.frame,
        budget: run.budget,
        nowIso: this.nowIso()
      })
      plan.tasks = selectTasksByValueOfInformation(plan.tasks, tests, {
        preset: run.budget.preset,
        maxSources: run.budget.maxSources
      })
      validateResearchPlan(plan, run.frame, run.budget.maxSources)
      run.plan = plan
      run.gapVerdicts = []
      await this.record(run, { type: 'PLAN_CREATED', planId: plan.id, taskCount: plan.tasks.length, plan })

      let roundIndex = 1
      let tasksForRound = plan.tasks
      while (tasksForRound.length > 0) {
        await this.runResearchTasks(run, tasksForRound, evidenceStore)
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
          roundIndex,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          nowIso: this.nowIso()
        }))
        if (gapVerdict.status === 'need_more') {
          gapVerdict = {
            ...gapVerdict,
            followUpTasks: selectTasksByValueOfInformation(gapVerdict.followUpTasks, run.hypothesisTests ?? [], {
              preset: run.budget.preset,
              maxSources: Math.max(1, run.budget.maxSources - evidenceStore.listSources().length)
            })
          }
        }
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

        if (gapVerdict.status !== 'need_more') {
          if (shouldRunDeepVoiFollowUp(run, convergence, evidenceStore.listSources().length, roundIndex)) {
            const followUpFromTests = tasksFromHighValueTests({
              tests: run.hypothesisTests ?? [],
              convergence,
              run,
              roundIndex,
              remainingSources: Math.max(0, run.budget.maxSources - evidenceStore.listSources().length)
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

      const maxAttempts = Math.max(1, Math.floor(run.budget.maxSynthesisRetries || run.budget.maxRounds || 1))
      let resolvedReport: CitationResolution | undefined
      let finalReportMarkdown = ''
      let previousFailure: { verdict: QualityVerdict } | undefined

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const draft = await this.synthesisWriter.writeDraft({
          runId: run.id,
          brief: run.brief,
          frame: run.frame,
          plan,
          budget: run.budget,
          hypotheses: run.hypotheses ?? [],
          hypothesisTests: run.hypothesisTests ?? [],
          hypothesisEvidenceBindings: run.hypothesisEvidenceBindings ?? [],
          hypothesisUpdates: run.hypothesisUpdates ?? [],
          convergenceVerdicts: run.convergenceVerdicts ?? [],
          gapVerdicts: run.gapVerdicts ?? [],
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          ...(previousFailure ? {
            revision: {
              attempt,
              maxAttempts,
              previousVerdict: previousFailure.verdict
            }
          } : {}),
          nowIso: this.nowIso()
        })
        await this.record(run, {
          type: 'REPORT_DRAFTED',
          draftId: `draft_${run.id}_${attempt}`,
          claimCount: draft.claimIds.length,
          attempt,
          maxAttempts
        })

        resolvedReport = this.citationResolver.resolve({
          draft,
          reportPath: run.artifacts.reportPath,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          nowIso: this.nowIso()
        })
        await this.record(run, {
          type: 'CITATIONS_RESOLVED',
          citationCount: resolvedReport.bindings.length,
          unresolvedCitationIds: resolvedReport.unresolvedCitationIds,
          attempt,
          maxAttempts
        })

        finalReportMarkdown = renderFinalReportMarkdown(run, resolvedReport.markdown, {
          generatedAt: this.nowIso(),
          sourceCount: evidenceStore.listSources().length,
          claimCount: evidenceStore.listClaims().length
        })
        await this.options.repository.writeReportDraft(run.artifacts, finalReportMarkdown)
        run.draftReportAvailable = true

        const deterministicVerdict = this.qualityVerifier.verify({
          brief: run.brief,
          frame: run.frame,
          plan,
          budget: run.budget,
          reportMarkdown: finalReportMarkdown,
          notes: evidenceStore.listNotes(),
          sources: evidenceStore.listSources(),
          claims: evidenceStore.listClaims(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          citations: resolvedReport.bindings,
          gapVerdicts: run.gapVerdicts ?? [],
          unresolvedCitationIds: resolvedReport.unresolvedCitationIds,
          nowIso: this.nowIso()
        })
        const judgeVerdict = await this.qualityJudge.judge({
          scope: run.scope,
          brief: run.brief,
          frame: run.frame,
          plan,
          budget: run.budget,
          reportMarkdown: finalReportMarkdown,
          sources: evidenceStore.listSources(),
          notes: evidenceStore.listNotes(),
          claims: evidenceStore.listClaims(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          citations: resolvedReport.bindings,
          deterministicVerdict,
          nowIso: this.nowIso()
        })
        const verdict = mergeQualityVerdictWithJudge(deterministicVerdict, judgeVerdict)
        run.verification = verdict
        const finalAttempt = attempt >= maxAttempts
        await this.record(run, {
          type: 'VERIFICATION_COMPLETED',
          verdict,
          attempt,
          maxAttempts,
          finalAttempt
        })
        await this.options.repository.writeRun(run)
        if (verdict.pass) break

        const failureType = judgeFailureType(verdict)
        if (failureType === 'scope_frame_mapping_error') {
          throw new Error(`Research frame mapping failed: ${verdict.blockingIssues.join('; ')}`)
        }
        if (failureType === 'evidence_blocking' || failureType === 'missing_required_dimensions') {
          if (!finalAttempt && await this.runVerificationEvidenceRepair(run, plan, evidenceStore, verdict, attempt)) {
            previousFailure = undefined
            continue
          }
          throw new Error(`Research verification failed due to ${failureType}: ${verdict.blockingIssues.join('; ')}`)
        }
        if (failureType === 'citation_fixable') {
          throw new Error(`Research citation resolution failed: ${verdict.blockingIssues.join('; ')}`)
        }

        if (finalAttempt) {
          throw new Error(`Research verification failed after ${attempt} attempt(s): ${verdict.blockingIssues.join('; ')}`)
        }
        previousFailure = {
          verdict
        }
      }

      if (!resolvedReport || !finalReportMarkdown || run.verification?.pass !== true) {
        throw new Error('Research verification did not produce a passing report')
      }

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
      if (run.status !== 'failed') {
        await this.record(run, { type: 'RUN_FAILED', reason: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
        await this.options.repository.writeRun(run).catch(() => undefined)
      }
      throw error
    }
  }

  getRun(runId: string): ResearchRun | undefined {
    return this.runs.get(runId)
  }

  async cancelRun(runId: string, reason?: string): Promise<ResearchRun> {
    const run = this.mustGetRun(runId)
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
    run.updatedAt = completeEvent.timestamp
    await this.options.repository.appendEvent(run.artifacts, completeEvent)
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
    evidenceStore: EvidenceStore
  ): Promise<void> {
    const concurrency = Math.max(1, Math.floor(run.budget.maxWorkers || 1))
    for (let offset = 0; offset < tasks.length; offset += concurrency) {
      const batch = tasks.slice(offset, offset + concurrency)
      for (const task of batch) {
        task.status = 'running'
        await this.record(run, { type: 'TASK_STARTED', taskId: task.id })
      }

      const workerResults = await Promise.all(batch.map(async (task) => {
        const result = await this.options.worker.runTask({
          runId: run.id,
          task,
          brief: run.brief,
          frame: run.frame,
          budget: run.budget
        })
        return { task, result }
      }))

      for (const { task, result } of workerResults) {
        validateWorkerResult(result)
        this.validateWorkerResultPolicy(run, task, result, evidenceStore.listSources().length)
        await evidenceStore.recordWorkerResult(result)
        task.maxSources = result.sources.length
        task.status = 'done'
        for (const source of result.sources) {
          await this.record(run, { type: 'SOURCE_ADDED', sourceId: source.id })
        }
        for (const note of result.notes) {
          await this.record(run, { type: 'NOTE_ADDED', noteId: note.id })
        }
        await this.record(run, { type: 'TASK_COMPLETED', taskId: task.id })
        await this.record(run, {
          type: 'WORKER_RESULT_RECORDED',
          taskId: task.id,
          sourceCount: result.sources.length,
          evidenceSpanCount: result.evidenceSpans.length,
          claimCount: result.claims.length,
          noteCount: result.notes.length
        })
      }
    }
  }

  private async runVerificationEvidenceRepair(
    run: ResearchRun,
    plan: ResearchPlan,
    evidenceStore: EvidenceStore,
    verdict: QualityVerdict,
    attempt: number
  ): Promise<boolean> {
    let remainingSources = Math.max(0, run.budget.maxSources - evidenceStore.listSources().length)
    const sourceTypes = availableRepairSourceTypes(run, this.worker)
    if (remainingSources <= 0 || sourceTypes.length === 0) return false

    let roundIndex = (run.gapVerdicts?.length ?? 0) + 1
    let tasks = verificationEvidenceTasks({
      run,
      verdict,
      attempt,
      roundIndex,
      remainingSources,
      sourceTypes
    })
    while (tasks.length > 0 && roundIndex <= run.budget.maxResearchRounds && remainingSources > 0) {
      for (const task of tasks) {
        plan.tasks.push(task)
        await this.record(run, { type: 'FOLLOW_UP_TASK_CREATED', task, roundIndex })
      }
      validateResearchPlan(plan, run.frame, run.budget.maxSources)
      await this.runResearchTasks(run, tasks, evidenceStore)
      await this.record(run, { type: 'RESEARCH_COMPLETED', taskCount: tasks.length, roundIndex })

      let gapVerdict = normalizeGapVerdict(await this.coverageEvaluator.evaluate({
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
        nowIso: this.nowIso()
      }))
      remainingSources = Math.max(0, run.budget.maxSources - evidenceStore.listSources().length)
      if (gapVerdict.status === 'need_more') {
        gapVerdict = {
          ...gapVerdict,
          followUpTasks: selectTasksByValueOfInformation(gapVerdict.followUpTasks, run.hypothesisTests ?? [], {
            preset: run.budget.preset,
            maxSources: Math.max(1, remainingSources)
          })
        }
      }
      run.gapVerdicts = [...(run.gapVerdicts ?? []), gapVerdict]
      await this.record(run, {
        type: 'GAP_CHECK_COMPLETED',
        verdict: gapVerdict,
        roundIndex,
        followUpTaskCount: gapVerdict.followUpTasks.length
      })
      await this.options.repository.writeRun(run)

      if (gapVerdict.status !== 'need_more') return true
      roundIndex += 1
      tasks = gapVerdict.followUpTasks
        .map((task) => ({
          ...task,
          sourceTypes: task.sourceTypes.filter((sourceType) => sourceTypes.includes(sourceType))
        }))
        .filter((task) => task.sourceTypes.length > 0)
        .slice(0, Math.max(1, Math.min(run.budget.maxSubagents, remainingSources)))
    }
    return false
  }

  private validateWorkerResultPolicy(
    run: ResearchRun,
    task: ResearchTask,
    result: WorkerResult,
    existingSourceCount: number
  ): void {
    if (result.taskId !== task.id) {
      throw new Error(`Worker result taskId ${result.taskId} does not match runtime task ${task.id}`)
    }
    const allowedSourceTypes = new Set(run.brief.sourcePolicy.allowedSourceTypes)
    for (const source of result.sources) {
      if (!allowedSourceTypes.has(source.sourceType)) {
        throw new Error(`Source ${source.id} uses disallowed source type ${source.sourceType}`)
      }
    }
    if (result.sources.length > task.maxSources) {
      throw new Error(`Worker result for ${task.id} returned ${result.sources.length} sources, exceeding task limit ${task.maxSources}`)
    }
    if (existingSourceCount + result.sources.length > run.budget.maxSources) {
      throw new Error(`Research run ${run.id} exceeded source budget ${run.budget.maxSources}`)
    }
    const taskQuestionIds = new Set(task.questionIds)
    for (const questionId of result.questionIds) {
      if (!taskQuestionIds.has(questionId)) {
        throw new Error(`Worker result ${result.taskId} references question ${questionId} outside task scope`)
      }
    }
  }
}

class PlanAgentSupervisor implements ResearchSupervisor {
  constructor(private readonly planAgent: PlanAgent) {}

  createInitialPlan(input: Parameters<ResearchSupervisor['createInitialPlan']>[0]): Promise<ResearchPlan> {
    return this.planAgent.createPlan(input)
  }
}

function normalizeGapVerdict(verdict: ResearchGapVerdict): ResearchGapVerdict {
  if (verdict.status !== 'need_more' || verdict.followUpTasks.length > 0) return verdict
  return {
    ...verdict,
    status: 'budget_exhausted',
    stopReason: `${verdict.stopReason} Evaluator 没有返回可执行补充任务，runtime 将进入证据门校验。`
  }
}

function shouldRunDeepVoiFollowUp(
  run: ResearchRun,
  convergence: ResearchConvergenceVerdict,
  sourceCount: number,
  roundIndex: number
): boolean {
  return run.budget.preset === 'deep' &&
    convergence.wouldFurtherResearchChangeConclusion &&
    convergence.unresolvedHighValueTestIds.length > 0 &&
    roundIndex < run.budget.maxResearchRounds &&
    sourceCount < run.budget.maxSources
}

function tasksFromHighValueTests(input: {
  tests: HypothesisTest[]
  convergence: ResearchConvergenceVerdict
  run: ResearchRun
  roundIndex: number
  remainingSources: number
}): ResearchTask[] {
  const unresolved = new Set(input.convergence.unresolvedHighValueTestIds)
  const selectedTests = input.tests
    .filter((test) => unresolved.has(test.id))
    .sort((left, right) => right.valueOfInformation.score - left.valueOfInformation.score)
    .slice(0, Math.max(1, Math.min(input.run.budget.maxSubagents, input.remainingSources, 3)))
  if (selectedTests.length === 0 || input.remainingSources <= 0) return []
  const perTask = Math.max(1, Math.floor(input.remainingSources / selectedTests.length))
  return selectedTests.map((test, index) => ({
    id: `voi_${input.roundIndex + 1}_task_${index + 1}`,
    questionIds: test.questionIds,
    hypothesisIds: [test.hypothesisId],
    testIds: [test.id],
    objective: `寻找能改变最终判断的证据：${test.testQuestion}`,
    expectedEvidence: [
      `如果该搜索成功，必须能改变、削弱或限定最终判断；否则不继续补充相关资料。`,
      test.expectedEvidenceIfTrue,
      test.evidenceThatWouldWeakenIt
    ],
    sourceTypes: test.preferredSources,
    searchHints: [
      input.run.brief.topic,
      input.run.frame.centralQuestion,
      test.testQuestion,
      test.expectedEvidenceIfTrue,
      test.evidenceThatWouldWeakenIt
    ].map((hint) => hint.trim()).filter(Boolean),
    maxSources: Math.max(1, Math.min(perTask, input.remainingSources - index * perTask || 1)),
    priority: test.priority,
    valueOfInformation: test.valueOfInformation,
    status: 'pending'
  }))
}

function availableRepairSourceTypes(run: ResearchRun, worker: ResearchTaskWorker): ResearchTask['sourceTypes'] {
  const allowed = new Set(run.brief.sourcePolicy.allowedSourceTypes)
  const sourceTypes: ResearchTask['sourceTypes'] = []
  if (allowed.has('web') && (worker.hasSearchCapability?.() ?? false)) {
    sourceTypes.push('web')
  }
  if (worker.hasLocalEvidenceCapability?.() ?? false) {
    for (const sourceType of run.brief.sourcePolicy.allowedSourceTypes) {
      if (sourceType !== 'web') sourceTypes.push(sourceType)
    }
  }
  return [...new Set(sourceTypes)]
}

function verificationEvidenceTasks(input: {
  run: ResearchRun
  verdict: QualityVerdict
  attempt: number
  roundIndex: number
  remainingSources: number
  sourceTypes: ResearchTask['sourceTypes']
}): ResearchTask[] {
  if (input.remainingSources <= 0 || input.sourceTypes.length === 0) return []
  const requiredQuestions = input.run.frame.coreQuestions
    .filter((question) => question.required || question.priority === 'high')
    .slice(0, Math.max(1, Math.min(input.run.budget.maxSubagents, input.remainingSources, 3)))
  const questions = requiredQuestions.length > 0 ? requiredQuestions : input.run.frame.coreQuestions.slice(0, 1)
  if (questions.length === 0) return []
  const perTask = Math.max(1, Math.floor(input.remainingSources / questions.length))
  return questions.map((question, index) => ({
    id: `verification_repair_${input.attempt}_${input.roundIndex}_${index + 1}`,
    questionIds: [question.id],
    objective: `补充能改变最终判断的真实证据：${question.text}`,
    expectedEvidence: [
      '这个搜索任务如果成功，必须能改变、削弱或限定最终判断；如果只能补充相关背景，就不要把它当作完成证据。',
      ...input.verdict.blockingIssues.slice(0, 3)
    ],
    sourceTypes: input.sourceTypes,
    searchHints: [
      input.run.brief.topic,
      input.run.frame.centralQuestion,
      question.text,
      ...input.verdict.blockingIssues.slice(0, 4)
    ].map((hint) => hint.trim()).filter(Boolean),
    maxSources: Math.max(1, Math.min(perTask, input.remainingSources - index * perTask || 1)),
    priority: question.priority,
    valueOfInformation: {
      uncertaintyImportance: 1,
      discriminativePower: 1,
      decisionImpact: 1,
      sourceFeasibility: input.sourceTypes.includes('web') ? 0.9 : 0.7,
      estimatedCost: 0.4,
      score: 0.95,
      decisionRelevanceQuestion: '如果补到这条证据，最终判断是否会改变、削弱或被限定？'
    },
    status: 'pending'
  }))
}

function evidenceVerdictBeforeSynthesis(
  run: ResearchRun,
  latestGap: ResearchGapVerdict | undefined,
  sources: SourceRecord[],
  evidenceSpans: EvidenceSpan[],
  webSearchEnabled: boolean,
  nowIso: string
): QualityVerdict | undefined {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const hasRealVerifiableEvidence = evidenceSpans.some((span) =>
    canCiteEvidenceSpan(span, sourceById.get(span.sourceId))
  )
  const isPreliminaryQuick = run.budget.preset === 'quick' && !webSearchEnabled

  if (!hasRealVerifiableEvidence && !isPreliminaryQuick) {
    const primaryIssue = `evidence_blocking: 缺乏真实可验证的研究证据（Web搜索已禁用，或无本地文件支撑），系统无法生成带引用的 DeepResearch 报告。`
    const issues = [
      { code: 'research_evidence_insufficient', message: primaryIssue, severity: 'blocking' as const }
    ]
    return {
      pass: false,
      scores: {
        requirementsAlignment: 0,
        answersCoreQuestions: 0,
        followsCoreResearchThread: 0,
        reportCompleteness: 0,
        citationAccuracy: 0,
        evidenceCoverage: 0,
        sourceQuality: 0,
        conflictHandling: 0,
        uncertaintyCalibration: 0,
        writingQuality: 0,
        llmJudgeOverall: 0
      },
      blockingIssues: [primaryIssue],
      warnings: ['由于未收集到真实外部或本地证据，已前置拦截，未调用 Synthesis Writer 或 LLM Judge。'],
      recommendedFixes: [
        '开启联网功能重新运行，以获取真实的 Web 网页来源证据。',
        '在 Workspace 中上传包含相关研究事实的本地文件。'
      ],
      issues,
      verifiedAt: nowIso
    }
  }

  if (!latestGap || latestGap.status !== 'budget_exhausted' || latestGap.missingEvidence.length === 0) return undefined
  const requiredQuestions = latestGap.coverageByQuestion.filter((coverage) => coverage.required || coverage.priority === 'high')
  const coveredQuestions = requiredQuestions.filter((coverage) => coverage.covered).length
  const answerCoverage = requiredQuestions.length === 0 ? 0 : coveredQuestions / requiredQuestions.length
  const primaryIssue = `证据收集未达到 ${run.budget.preset} preset 的最低完成标准：${latestGap.stopReason}`
  const missingEvidenceIssues = latestGap.missingEvidence.slice(0, 8).map((item) => `证据缺口：${item}`)
  const issues = [
    { code: 'research_evidence_insufficient', message: primaryIssue, severity: 'blocking' as const },
    ...missingEvidenceIssues.map((message) => ({
      code: 'research_evidence_gap',
      message,
      severity: 'blocking' as const
    }))
  ]
  return {
    pass: false,
    scores: {
      requirementsAlignment: answerCoverage,
      answersCoreQuestions: answerCoverage,
      followsCoreResearchThread: answerCoverage,
      reportCompleteness: 0,
      citationAccuracy: 0,
      evidenceCoverage: answerCoverage,
      sourceQuality: 0,
      conflictHandling: 0,
      uncertaintyCalibration: 0,
      writingQuality: 0,
      llmJudgeOverall: 0
    },
    blockingIssues: issues.map((issue) => issue.message),
    warnings: ['证据不足，runtime 已停止报告合成，未调用 Synthesis Writer 或 LLM Judge。'],
    recommendedFixes: [
      '补充更具体的检索词、官方来源、数据页或可交叉验证的行业资料后重新运行。',
      '如果用户需要历史长周期分析，应在需求里明确时间范围，避免默认最近一年窗口过窄。'
    ],
    issues,
    verifiedAt: nowIso
  }
}

function judgeFailureType(
  verdict: QualityVerdict
): 'writing_fixable' | 'citation_fixable' | 'evidence_blocking' | 'missing_required_dimensions' | 'scope_frame_mapping_error' {
  const issueText = verdict.issues?.map((issue) => `${issue.code}\n${issue.message}`).join('\n') ?? ''
  const blockingText = verdict.blockingIssues.join('\n')
  const fullText = `${issueText}\n${blockingText}`.toLowerCase()
  if (/scope_frame_mapping|frame mapping|您是否|请说明|待确认|clarification prompt/.test(fullText)) {
    return 'scope_frame_mapping_error'
  }
  if (/required_question_uncovered|user_clarification_uncovered|missing_required_dimensions|缺维度|缺少.*维度|没有覆盖|未覆盖|没覆盖|未回答|没回答|核心问题|综合实力|特定领域差距|产业结构|贸易|供应链|科技创新|数字经济|脱钩/.test(fullText)) {
    return 'missing_required_dimensions'
  }
  const isEvidenceBlocking = verdict.issues?.some((issue) => {
    const code = (issue.code || '').toLowerCase()
    const msg = (issue.message || '').toLowerCase()
    return code.startsWith('research_') ||
      code.includes('evidence') ||
      code.includes('claim') ||
      code.includes('unsupported') ||
      code.includes('fallback') ||
      msg.includes('资料卡') ||
      msg.includes('模型生成') ||
      msg.includes('证据使用严重不足') ||
      msg.includes('没有真实网页') ||
      msg.includes('外部可验证') ||
      msg.includes('证据基础薄弱') ||
      msg.includes('抽取失败') ||
      msg.includes('兜底证据') ||
      msg.includes('fallback_extracted') ||
      msg.includes('this operation was aborted')
  })
  if (isEvidenceBlocking) return 'evidence_blocking'

  const isCitationFixable = verdict.issues?.some((issue) => {
    const code = (issue.code || '').toLowerCase()
    return code.includes('citation') || code.includes('cite')
  })
  if (isCitationFixable) return 'citation_fixable'

  return 'writing_fixable'
}
