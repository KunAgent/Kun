import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assessClaimFaithfulness,
  BasicConvergenceAnalyzer,
  BasicCoverageEvaluator,
  CascadingWebSearchProvider,
  DefaultResearchTaskWorker,
  DeepSeekWebSearchProvider,
  EvidenceStore,
  ResearchRunRepository,
  ResearchRuntime,
  adaptResearchBudgetToSourceBoundary,
  applyResearchProgressGuard,
  buildResearchFrame,
  canCiteSource,
  buildCoverageContract,
  buildResearchQuestionContract,
  classifyResearchEvidenceAssignment,
  comparisonTargetAliases,
  comparisonTargetMatchesText,
  projectComparisonEvidenceText,
  coversResearchDimensionFocusGroups,
  evaluateCoverageRequirementEvidence,
  finalizeResolvedReportProse,
  deriveResearchSourcePolicy,
  extractComparisonTargets,
  evaluateResearchProgress,
  isEligibleStrongWebEvidence,
  isBibliographicMetadataOnlyText,
  isSourceTitleOnlyText,
  isResearchTextRelevant,
  isResearchEvidenceFocused,
  isUsableEvidenceText,
  isComparisonText,
  isResearchSourceCandidateAllowed,
  isResearchSourceUrlAllowed,
  isSelfContainedContextualEvidence,
  normalizeSourceUrl,
  repairDanglingConclusionConnectors,
  repairDanglingAtomicClaimText,
  reportArgumentMeetsDepth,
  reportArgumentSignals,
  reportConclusionDepthIssue,
  reportLimitationsDepthIssue,
  researchDimensionFocusGroups,
  resolveResearchBudget,
  type ResearchBrief,
  type ResearchFrame,
  type ResearchReportBlueprint,
  type ResearchRun,
  type ResearchTaskWorkerInput,
  type ResearchScopeAssessment
} from '../src/research/index.js'
import type { WebProvider, WebSearchProviderAttempt } from '../src/ports/web-provider.js'
import {
  assertPublicResearchUrl,
  extractLinkedDocumentSeeds,
  extractReadableText,
  fetchSeedSources,
  fetchSeedSource,
  sourceRecordForFetched
} from '../src/research/runtime/ResearchWebContent.js'
import { extractResearchPdfText } from '../src/research/runtime/ResearchPdfText.js'
import {
  cleanExtractedWebText,
  cleanFallbackSentence,
  isLowSignalWebText,
  primaryFocusGroups,
  selectRelevantFallbackExcerpt
} from '../src/research/runtime/ResearchWebFallbackText.js'
import { ResearchRunIndex } from '../src/research/runtime/ResearchRunIndex.js'
import { applyVerifiedSourceAssessments } from '../src/research/runtime/ResearchSourceAuthority.js'
import {
  buildSynthesisRevisionTargets,
  canPublishAfterEvidenceExhaustion,
  pruneJudgeRejectedBlueprintClaims
} from '../src/research/runtime/ResearchSynthesisPipeline.js'
import {
  exhaustedQuestionIdsForVerificationRepair,
  runVerificationEvidenceRepair
} from '../src/research/runtime/ResearchVerificationRepair.js'
import {
  buildWebExtractionPrompt,
  isExtractedEvidenceGroundedInSource,
  parseWebExtractionResult,
  filterFetchedSourcesForResearch,
  focusedExactSentences,
  prioritizeNovelFetchedSources,
  prioritizeNovelSeedSources,
  reusableExistingSourceSeeds,
  verifiedSourceFocusAliasGroups
} from '../src/research/runtime/SeededWebResearchTaskWorker.js'
import {
  questionIdsForCard,
  questionIdsForEvidence
} from '../src/research/runtime/ResearchWebEvidenceText.js'
import {
  applySearchTimeRange,
  buildSearchQueries,
  defaultSearchTimeRange,
  extractionCardLimit,
  isPrimaryMaterialSearchResult,
  isRelevantSearchResult,
  normalizeSearchQuery,
  rankSearchResultsForResearch,
  searchSeedSources,
  seedCandidateLimitForTask,
  tagsForSearchResult
} from '../src/research/runtime/ResearchWebSearchPolicy.js'
import {
  judgeFailureType,
  shouldRunDeepVoiFollowUp,
  tasksFromHighValueTests,
  verificationEvidenceTasks
} from '../src/research/runtime/ResearchRuntimePolicy.js'
import {
  containsExtractionBoilerplate,
  repeatedFindingSentenceAcrossSections,
  reportBodyUrlIssue,
  sanitizeExtractionBoilerplateSentences,
  sanitizeReportBodyUrls,
  sanitizeUncitedDraftSentences,
  sanitizeUncitedResolvedSentences,
  uncitedReportSentences
} from '../src/research/evidence/CitationProximity.js'
import { renderFinalReportMarkdown } from '../src/research/markdown/ReportRenderer.js'
import { validateResearchPlan } from '../src/research/core/validation.js'
import { normalizeResearchChineseScript } from '../src/research/core/chinese-script.js'
import { sourceTextMatchesResearchSubject } from '../src/research/runtime/ResearchWebQueryText.js'
import {
  citedClaimIdsForMarkdown,
  conditionalApplicationCoversQuestion,
  directEvidenceCoversQuestion,
  reportArgumentQualityIssues
} from '../src/research/verification/QualityVerifier.js'

describe('DeepResearch hardening boundaries', () => {
  it('does not turn a low-quality no-core-answer Judge failure into limited success', () => {
    const deterministic = { pass: true } as never
    const verdict = {
      pass: false,
      llmJudge: {
        scores: {
          requirementsAlignment: 0.3,
          answersConfirmedScope: 0.2,
          followsResearchFrame: 0.3,
          citationFaithfulness: 0.7,
          writingQuality: 0.4
        },
        issues: [{ code: 'no_core_answer', category: 'scope', message: '未回答核心问题。', severity: 'blocking' }]
      }
    } as never

    expect(canPublishAfterEvidenceExhaustion(verdict, deterministic, new Set(['q1']))).toBe(false)
  })

  it('classifies analytical evidence roles without relying on topic-specific rules', () => {
    const riskContract = buildResearchQuestionContract({
      id: 'q_resilience',
      text: '在「运行风险」维度上，主要风险和不确定性是什么？',
      required: true
    }, '运行风险')

    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_adverse',
      evidenceText: 'The service depends on one external component, creating disruption risk when that component is unavailable.'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_denial',
      evidenceText: 'The maintainers report that the service is not exposed to any significant availability risk.'
    }).role).toBe('contradicts')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_context',
      evidenceText: 'The maintainers released a new interface and updated the public documentation this month.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_method_only',
      evidenceText: '生命周期评价可用于环境影响分析，在微观层面识别主要环境影响环节，并为宏观影响预测提供支持。'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_concrete_adverse',
      evidenceText: '该系统依赖单一外部组件，组件中断会造成服务不可用风险。'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_measured_impact',
      evidenceText: 'Changes in operating conditions can reduce local biodiversity, while toxic material may enter the food chain and harm exposed populations.'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_risk_communication',
      evidenceText: 'Transparent communication about environmental risks and pricing fosters informed consent.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_named_risk_list',
      evidenceText: '风险提示：需求增长不及预期；政策推进不及预期；地缘政治风险；海外政策不确定性。'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_measured_loss',
      evidenceText: '规则调整后单日账面损失达到12%，价格波动空间也扩大一倍。'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_risk_named_rule',
      evidenceText: '风险警示对象的阈值由5%调整为10%，其他类别的阈值保持不变。'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: riskContract,
      claimId: 'claim_named_risk_with_effect',
      evidenceText: '规则变动风险：规则调整可能直接影响服务通道的可用性。'
    }).role).toBe('supports')

    const scaleContract = buildResearchQuestionContract({
      id: 'q_scale',
      text: '在「系统规模与结构」维度上，关键数量事实是什么？',
      required: true
    }, '系统规模与结构')
    expect(classifyResearchEvidenceAssignment({
      contract: scaleContract,
      claimId: 'claim_quantitative_scale',
      evidenceText: '该系统共有3370个节点，合计48.67万单位，其中第一类占47.2%。'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: scaleContract,
      claimId: 'claim_unmeasured_context',
      evidenceText: '维护者更新了系统说明文档。'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: scaleContract,
      claimId: 'claim_structure_facet',
      evidenceText: '系统结构已从单层调整为相互独立的三个层级。'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: scaleContract,
      claimId: 'claim_single_example',
      evidenceText: '示例对象共有3370个节点，合计48.67万单位。',
      suggestedRole: 'supports',
      suggestedExplanation: '该条是一个单一样本案例，可作为整体规模的参考。'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: buildResearchQuestionContract({
        id: 'q_example',
        text: '请分析一个具体案例。',
        required: true
      }, '案例分析'),
      claimId: 'claim_requested_example',
      evidenceText: '示例对象共有3370个节点，合计48.67万单位。',
      suggestedRole: 'supports',
      suggestedExplanation: '该条是用户要求的具体案例。'
    }).role).toBe('supports')

    const compositionContract = buildResearchQuestionContract({
      id: 'q_composition',
      text: '在「类别构成」维度上，各类别的实际分布是什么？',
      required: true
    }, '类别构成')
    expect(classifyResearchEvidenceAssignment({
      contract: compositionContract,
      claimId: 'claim_tool_changelog',
      evidenceText: 'Version 3.2 fixed an API endpoint and now fetches category membership in one request.'
    }).role).toBe('context')

    expect(isUsableEvidenceText('指标详情（数据日期：2026-07-17） 更多 MetricA MetricB MetricC MetricD MetricE CategoryOne CategoryTwo')).toBe(false)
    expect(isUsableEvidenceText('这允许读者对该指数有更全面的理解。')).toBe(false)

    const compoundGroups = researchDimensionFocusGroups('在「准入与退出机制」维度上，关键事实是什么？')
    expect(coversResearchDimensionFocusGroups(
      compoundGroups,
      '准入要求由公开规则确定；退出条件由另一份文件规定。'
    )).toBe(true)
    expect(researchDimensionFocusGroups('在「跨境投资门槛与主要风险」维度上，关键事实是什么？'))
      .toContainEqual(expect.arrayContaining(['主要风险']))

    const riskProcessContract = buildResearchQuestionContract({
      id: 'q_risk_process',
      text: '该组织如何开展风险识别、评估和监测？',
      required: true
    }, '风险治理流程')
    expect(classifyResearchEvidenceAssignment({
      contract: riskProcessContract,
      claimId: 'claim_process_answer',
      evidenceText: '该框架规定了风险识别、评估和持续监测流程。'
    }).role).toBe('supports')

    const binaryRiskContract = buildResearchQuestionContract({
      id: 'q_binary',
      text: '该服务是否存在重大可用性风险？',
      required: true
    }, '是否存在重大可用性风险')
    expect(classifyResearchEvidenceAssignment({
      contract: binaryRiskContract,
      claimId: 'claim_binary_denial',
      evidenceText: 'The service is not exposed to any significant availability risk.'
    }).role).toBe('supports')

    const causeContract = buildResearchQuestionContract({
      id: 'q_cause',
      text: '运行中断的主要原因是什么？',
      required: true
    }, '中断原因')
    expect(classifyResearchEvidenceAssignment({
      contract: causeContract,
      claimId: 'claim_cause',
      evidenceText: 'The interruption occurred because a required dependency stopped responding.'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: causeContract,
      claimId: 'claim_cause_context',
      evidenceText: 'The service was restored later that afternoon.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: causeContract,
      claimId: 'claim_direct_effect',
      evidenceText: 'Input quality affects processing demand, while supplier prices increase operating costs.'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: causeContract,
      claimId: 'claim_driver_list',
      evidenceText: 'Operating cost drivers include energy use, maintenance work, and required capital investment.'
    }).role).toBe('supports')

    const recentCostTrendContract = buildResearchQuestionContract({
      id: 'q_recent_cost',
      text: '在「过去五年成本变化」维度上，成本如何变化？',
      required: true
    }, '过去五年成本变化', '2026-07-18T00:00:00.000Z')
    expect(classifyResearchEvidenceAssignment({
      contract: recentCostTrendContract,
      claimId: 'claim_old_cost',
      evidenceText: 'The cost declined from more than $5 in the 1970s to less than $1 by 2000.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: recentCostTrendContract,
      claimId: 'claim_wrong_metric',
      evidenceText: 'Market revenue is forecast to grow at 9.3% from 2021 to 2026.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: recentCostTrendContract,
      claimId: 'claim_recent_cost',
      evidenceText: 'Typical cost declined from $1.20 per unit in 2021 to $0.90 in 2025.'
    }).role).toBe('supports')
    expect(classifyResearchEvidenceAssignment({
      contract: recentCostTrendContract,
      claimId: 'claim_undated_cost',
      evidenceText: 'The cost has declined because the process became more efficient.'
    }).role).toBe('context')

    const futureTrendContract = buildResearchQuestionContract({
      id: 'q_future',
      text: '在「未来五年趋势」维度上，现有预测支持什么判断？',
      required: true
    }, '未来五年趋势', '2026-07-18T00:00:00.000Z')
    expect(classifyResearchEvidenceAssignment({
      contract: futureTrendContract,
      claimId: 'claim_expired_forecast',
      evidenceText: 'Market revenue was forecast to grow from 2021 to 2026.'
    }).role).toBe('context')
    expect(classifyResearchEvidenceAssignment({
      contract: futureTrendContract,
      claimId: 'claim_current_forecast',
      evidenceText: 'The indicator is forecast to grow from 2026 to 2031.'
    }).role).toBe('supports')
  })

  it('does not count reference definitions as a second report limitation', () => {
    const markdown = [
      '## 局限与不确定性',
      '',
      '现有证据未覆盖现金流和债务期限结构。',
      '',
      '[1]: <https://example.com/report> "Annual Report"',
      '[2]: <https://example.com/outlook> "Market Outlook"'
    ].join('\n')

    expect(reportLimitationsDepthIssue(markdown, 'standard'))
      .toContain('至少说明两个具体证据边界')
  })

  it('discovers only direct PDF links from a fetched document index', () => {
    const linked = extractLinkedDocumentSeeds([
      '<html><body>',
      '<a href="/reports/annual-report.pdf#page=1">Annual Report</a>',
      '<a href="https://cdn.example.org/reports/interim.PDF?download=1">Interim Report</a>',
      '<a href="/reports/annual-report.pdf#duplicate">Duplicate</a>',
      '<a href="/investors/results">Results page</a>',
      '</body></html>'
    ].join(''), 'https://issuer.example.org/investors/documents', {
      url: 'https://issuer.example.org/investors/documents',
      title: 'Investor documents',
      publisher: 'issuer.example.org',
      reliabilityReason: 'Search result candidate.',
      tags: ['deepseek_web_search', 'web_search_only']
    })

    expect(linked.map((source) => source.url)).toEqual([
      'https://issuer.example.org/reports/annual-report.pdf',
      'https://cdn.example.org/reports/interim.PDF?download=1'
    ])
    expect(linked[0]?.tags).toContain('linked_document')
    expect(linked[0]?.tags).toContain('primary_material_candidate')
    expect(linked[0]?.tags).not.toContain('web_search_only')
  })

  it('does not confuse an arbitrary PDF with a primary research document', () => {
    const input = makeSearchInput()
    input.brief = {
      ...input.brief,
      topic: 'Example Subject current assessment'
    }

    expect(isPrimaryMaterialSearchResult(input, {
      sourceId: 'prediction-pdf',
      url: 'https://publisher.example/academy/doc/example-subject-price-prediction.pdf',
      title: 'Example Subject price prediction',
      snippet: 'Third-party outlook and price forecast for Example Subject.',
      retrievedAt: '2026-07-16T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    }, ['Example Subject'])).toBe(false)

    expect(isPrimaryMaterialSearchResult(input, {
      sourceId: 'official-document-pdf',
      url: 'https://documents.example/release/opaque-file.pdf',
      title: 'Example Subject official document',
      snippet: 'Original source document published for Example Subject.',
      retrievedAt: '2026-07-16T00:00:00.000Z',
      provider: 'test-search',
      rank: 2
    }, ['Example Subject'])).toBe(true)
  })

  it('does not upgrade an HTML aggregator merely because it republishes first-person source text', () => {
    const aggregatorText = 'IP operations are the core driver of our group. Our group develops artists and products worldwide.'.repeat(5)
    const [aggregator] = applyVerifiedSourceAssessments([{
      sourceIndex: 1,
      role: 'primary',
      provenanceText: 'IP operations are the core driver of our group. Our group develops artists and products worldwide.',
      reason: 'The page quotes a company announcement.'
    }], [{
      url: 'https://dev.quamnet.example/market-data/company',
      finalUrl: 'https://dev.quamnet.example/market-data/company',
      title: 'Company business | Quamnet Market Data',
      publisher: 'deepseek-web-search',
      reliabilityReason: 'Search result candidate.',
      tags: ['web_search'],
      text: aggregatorText,
      contentType: 'text/html',
      byteCount: aggregatorText.length,
      fetchedAt: '2026-07-16T00:00:00.000Z'
    }])
    expect(aggregator?.tags).not.toContain('model_verified_primary_source')

    const officialText = 'Example Docs is maintained and published by Example Foundation for the public.'.repeat(5)
    const [official] = applyVerifiedSourceAssessments([{
      sourceIndex: 1,
      role: 'authoritative',
      provenanceText: 'Example Docs is maintained and published by Example Foundation for the public.',
      reason: 'The page identifies its publisher.'
    }], [{
      url: 'https://docs.example.org/protocol',
      finalUrl: 'https://docs.example.org/protocol',
      title: 'Protocol reference | Example Docs',
      publisher: 'deepseek-web-search',
      reliabilityReason: 'Search result candidate.',
      tags: ['web_search'],
      text: officialText,
      contentType: 'text/html',
      byteCount: officialText.length,
      fetchedAt: '2026-07-16T00:00:00.000Z'
    }])
    expect(official?.tags).toContain('model_verified_authoritative_source')
  })

  it('upgrades a formal primary-material PDF only when its publisher brand is present in the document body', () => {
    const formalText = [
      'EXAMPLE LABS GROUP LIMITED',
      'ANNUAL RESULTS ANNOUNCEMENT FOR THE YEAR ENDED 31 DECEMBER 2025',
      'The board of Example Labs Group Limited is pleased to announce the audited consolidated results.'
    ].join(' ').repeat(4)
    const [formal] = applyVerifiedSourceAssessments(undefined, [{
      url: 'https://reports.examplelabs.com/results-2025.pdf',
      finalUrl: 'https://reports.examplelabs.com/results-2025.pdf',
      title: 'Example Labs annual results',
      publisher: 'reports.examplelabs.com',
      reliabilityReason: 'Primary material candidate.',
      tags: ['primary_material_candidate'],
      text: formalText,
      contentType: 'application/pdf',
      byteCount: formalText.length,
      fetchedAt: '2026-07-16T00:00:00.000Z'
    }])
    expect(formal?.tags).toContain('document_verified_primary_source')

    const [thirdParty] = applyVerifiedSourceAssessments(undefined, [{
      url: 'https://reports.archivehub.net/results-2025.pdf',
      finalUrl: 'https://reports.archivehub.net/results-2025.pdf',
      title: 'Example Labs annual results mirror',
      publisher: 'reports.archivehub.net',
      reliabilityReason: 'Mirrored candidate.',
      tags: ['primary_material_candidate'],
      text: formalText,
      contentType: 'application/pdf',
      byteCount: formalText.length,
      fetchedAt: '2026-07-16T00:00:00.000Z'
    }])
    expect(thirdParty?.tags).not.toContain('document_verified_primary_source')
  })

  it('matches a publisher acronym to the formal organization name inside a primary-material PDF', () => {
    const text = [
      'Rules Governing the Listing of Stocks on Shanghai Stock Exchange',
      'These Rules apply to listing, information disclosure and delisting of stocks.',
      'Shanghai Stock Exchange issued these Rules for its listed market.'
    ].join(' ').repeat(4)
    const [source] = applyVerifiedSourceAssessments(undefined, [{
      url: 'https://english.sse.example/rules/listing-rules.pdf',
      finalUrl: 'https://english.sse.example/rules/listing-rules.pdf',
      title: 'Rules Governing the Listing of Stocks',
      publisher: 'english.sse.example',
      reliabilityReason: 'Primary material candidate.',
      tags: ['primary_material_candidate'],
      text,
      contentType: 'application/pdf',
      byteCount: text.length,
      fetchedAt: '2026-07-16T00:00:00.000Z'
    }])

    expect(source?.tags).toContain('document_verified_primary_source')
  })

  it('does not let explicit model ownership bypass an incidental dynamic focus mention', () => {
    const input = makeSearchInput()
    input.brief.topic = '全面分析某公司的财务健康、业务模式和主要风险。'
    input.frame.coreQuestions = [{
      id: 'finance',
      text: '在「财务健康」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    }]
    input.task.questionIds = ['finance']
    input.task.reportQuestionIds = ['finance']
    const administrativeText = '董事会文件须在会议前送呈全体董事，让董事了解本公司的最新动态及财务状况，并使其能作出知情决定。'

    expect(questionIdsForCard(
      { questionIds: ['finance'] },
      input,
      administrativeText,
      [],
      [['财务状况']],
      true
    )).toEqual([])
  })

  it('matches citation claims after citation placement normalizes punctuation spacing', () => {
    const claimIds = citedClaimIdsForMarkdown('机制前提已经确认。 [1]', [{
      id: 'cit_occ_1',
      displayId: 'cit_1',
      displayIds: ['cit_1'],
      reportPath: '/tmp/report.md',
      reportAnchor: 'claim:claim_context:1',
      reportClaimText: '机制前提已经确认 。',
      claimId: 'claim_context',
      claimIds: ['claim_context'],
      evidenceSpanIds: ['span_1'],
      status: 'verified'
    }])

    expect([...claimIds]).toEqual(['claim_context'])
  })

  it('treats a fully cited conditional application as question coverage without direct notes', () => {
    const factA = 'no-cache 允许存储响应，但每次复用前必须验证。'
    const factB = 'no-store 表示缓存不应存储响应。'
    const markdown = [
      '## 主要发现',
      '### API 响应缓存场景',
      `${factA} [1]`,
      `${factB} [2]`,
      '由此判断，若两项机制前提在 API 响应缓存场景中同时成立，则该场景只能分别按复用前验证与是否允许存储的条件解释。 [1][2]'
    ].join('\n\n')
    const blueprint: ResearchReportBlueprint = {
      reportType: 'explanatory',
      title: 'API 响应缓存',
      directAnswer: '只能条件化回答。',
      thesis: '只能条件化回答。',
      sections: [{
        id: 'api', title: 'API 响应缓存场景', purpose: '条件化分析。', questionIds: ['q_api'],
        claimIds: [], contextClaimIds: ['claim_no_cache', 'claim_no_store'], evidenceMode: 'conditional_application',
        sourceIds: ['source_1', 'source_2'],
        argument: {
          conclusion: '只能条件化回答。', claimIds: [], inference: '使用两条机制前提。',
          conditions: [], counterClaimIds: []
        },
        limitations: ['没有场景直证。']
      }],
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    const citations = [{
      id: 'cit_occ_1', displayId: 'cit_1', displayIds: ['cit_1'], reportPath: '/tmp/report.md',
      reportAnchor: 'claim:claim_no_cache:1', reportClaimText: `${factA.slice(0, -1)} 。`,
      claimId: 'claim_no_cache', claimIds: ['claim_no_cache'], evidenceSpanIds: ['span_1'], status: 'verified' as const
    }, {
      id: 'cit_occ_2', displayId: 'cit_2', displayIds: ['cit_2'], reportPath: '/tmp/report.md',
      reportAnchor: 'claim:claim_no_store:2', reportClaimText: `${factB.slice(0, -1)} 。`,
      claimId: 'claim_no_store', claimIds: ['claim_no_store'], evidenceSpanIds: ['span_2'], status: 'verified' as const
    }]

    expect(conditionalApplicationCoversQuestion('q_api', markdown, blueprint, citations)).toBe(true)
    expect(conditionalApplicationCoversQuestion('other', markdown, blueprint, citations)).toBe(false)
  })

  it('treats a direct blueprint claim used in its own section as question coverage', () => {
    const fact = '当前来源直接说明了该问题的一项可核验事实。'
    const markdown = `## 主要发现\n\n### 结构差异\n\n${fact} [1]`
    const blueprint: ResearchReportBlueprint = {
      reportType: 'comparative',
      title: '通用比较',
      directAnswer: '按直接证据比较。',
      thesis: '按直接证据比较。',
      sections: [{
        id: 'structure', title: '结构差异', purpose: '比较结构。', questionIds: ['q_structure'],
        claimIds: ['claim_structure'], evidenceMode: 'direct', sourceIds: ['source_weak'],
        argument: {
          conclusion: fact, claimIds: ['claim_structure'], inference: '仅限当前来源。',
          conditions: [], counterClaimIds: []
        },
        limitations: ['来源质量有限。']
      }],
      createdAt: '2026-07-19T00:00:00.000Z'
    }
    const citations = [{
      id: 'cit_occ_1', displayId: 'cit_1', displayIds: ['cit_1'], reportPath: '/tmp/report.md',
      reportAnchor: 'claim:claim_structure:1', reportClaimText: fact,
      claimId: 'claim_structure', claimIds: ['claim_structure'], evidenceSpanIds: ['span_1'], status: 'verified' as const
    }]

    expect(directEvidenceCoversQuestion('q_structure', markdown, blueprint, citations)).toBe(true)
    expect(directEvidenceCoversQuestion('other', markdown, blueprint, citations)).toBe(false)
  })

  it('routes Judge occurrences to explicit sections and closing without parsing feedback prose', () => {
    const targets = buildSynthesisRevisionTargets({
      blueprint: {
        reportType: 'explanatory',
        title: '缓存研究',
        directAnswer: '缓存行为取决于验证和存储语义。',
        thesis: '缓存行为取决于验证和存储语义。',
        sections: [{
          id: 'etag', title: 'ETag', purpose: '解释 ETag', questionIds: ['q1'], claimIds: ['claim_etag'], sourceIds: ['source_1'],
          argument: { conclusion: 'ETag 事实', claimIds: ['claim_etag'], inference: '解释关系', conditions: [], counterClaimIds: [] }, limitations: []
        }, {
          id: 'cache_control', title: 'Cache-Control', purpose: '解释缓存指令', questionIds: ['q2'], claimIds: ['claim_cache'], sourceIds: ['source_2'],
          argument: { conclusion: '缓存指令事实', claimIds: ['claim_cache'], inference: '解释关系', conditions: [], counterClaimIds: [] }, limitations: []
        }],
        createdAt: '2026-07-13T00:00:00.000Z'
      },
      citations: [{
        id: 'cit_occ_1', reportPath: '/tmp/report.md', reportAnchor: 'claim:claim_etag:1',
        reportClaimText: '弱 ETag 允许语义等价时避免重新下载。', claimIds: ['claim_etag'], evidenceSpanIds: ['span_1'], status: 'verified'
      }, {
        id: 'cit_occ_2', reportPath: '/tmp/report.md', reportAnchor: 'claim:claim_cache:2',
        reportClaimText: 'no-cache 完全覆盖 freshness 的优先级。', claimIds: ['claim_cache'], evidenceSpanIds: ['span_2'], status: 'verified'
      }],
      draftMarkdown: [
        '## 主要发现',
        '### Cache-Control',
        'no-cache 完全覆盖 freshness 的优先级 [claim:claim_cache]。',
        '## 结论',
        '弱 ETag 允许语义等价时避免重新下载 [claim:claim_etag]。'
      ].join('\n'),
      verdict: {
        pass: false,
        scores: {
          requirementsAlignment: 1, answersCoreQuestions: 1, followsCoreResearchThread: 1, reportCompleteness: 1,
          citationAccuracy: 0.8, evidenceCoverage: 0.8, sourceQuality: 1, conflictHandling: 1,
          uncertaintyCalibration: 1, writingQuality: 0.5, llmJudgeOverall: 0.7
        },
        llmJudge: {
          source: 'llm_judge', pass: false, model: 'flash',
          scores: { requirementsAlignment: 1, answersConfirmedScope: 1, followsResearchFrame: 1, reportCompleteness: 1, evidenceUse: 0.8, citationFaithfulness: 0.8, uncertaintyCalibration: 1, writingQuality: 0.5, overall: 0.7 },
          rationale: '存在无证据扩写。',
          issues: [{ code: 'unsupported_closing', category: 'writing', message: '报告结论部分存在扩写。', severity: 'blocking', claimId: 'claim_etag', unsupportedFragment: '不可精确定位的结论转述', evidenceQuote: 'ETag fact' },
            { code: 'unsupported_section', category: 'writing', message: '存在扩写。', severity: 'blocking', occurrenceId: 'cit_occ_2', claimId: 'claim_cache', unsupportedFragment: '完全覆盖 freshness 的优先级', evidenceQuote: 'cache fact' }],
          blockingIssues: ['存在无证据扩写。'], warnings: [], recommendedFixes: [], judgedAt: '2026-07-13T00:00:00.000Z'
        },
        blockingIssues: ['存在无证据扩写。'], warnings: [], recommendedFixes: [],
        issues: [], verifiedAt: '2026-07-13T00:00:00.000Z'
      }
    })

    expect(targets).toEqual({ sectionIds: ['cache_control'], rewriteClosing: true })
  })

  it('routes a limitations-only failure to closing without rewriting report sections', () => {
    const targets = buildSynthesisRevisionTargets({
      blueprint: {
        reportType: 'explanatory',
        title: '通用研究',
        directAnswer: '当前证据支持受限判断。',
        thesis: '当前证据支持受限判断。',
        sections: [{
          id: 'finding', title: '核心发现', purpose: '解释核心发现', questionIds: ['q1'], claimIds: ['claim_1'], sourceIds: ['source_1'],
          argument: { conclusion: '核心事实', claimIds: ['claim_1'], inference: '解释关系', conditions: [], counterClaimIds: [] }, limitations: []
        }],
        createdAt: '2026-07-16T00:00:00.000Z'
      },
      citations: [],
      draftMarkdown: [
        '## 主要发现',
        '### 核心发现',
        '核心事实 [claim:claim_1]。',
        '## 结论',
        '当前证据支持受限判断。',
        '## 局限与不确定性',
        '当前只列出一项证据边界。'
      ].join('\n'),
      verdict: {
        pass: false,
        scores: {
          requirementsAlignment: 1, answersCoreQuestions: 1, followsCoreResearchThread: 1, reportCompleteness: 0.8,
          citationAccuracy: 1, evidenceCoverage: 1, sourceQuality: 1, conflictHandling: 1,
          uncertaintyCalibration: 0.5, writingQuality: 1
        },
        blockingIssues: ['报告的“局限与不确定性”必须至少说明两个具体证据边界或未解决缺口。'],
        warnings: [],
        recommendedFixes: [],
        issues: [],
        verifiedAt: '2026-07-16T00:00:00.000Z'
      }
    })

    expect(targets).toEqual({ sectionIds: [], rewriteClosing: true })
  })

  it('rejects exact-source claims that end in the middle of a word', () => {
    const support = 'The POST request will contain the If-Match header containing ETag values to check freshness against the current resource.'
    expect(assessClaimFaithfulness(
      'will contain the If-Match header containing ETag values to check freshness agains',
      [support]
    )).toMatchObject({ faithful: false, reasons: expect.arrayContaining(['claim_boundary_truncated']) })
    expect(cleanFallbackSentence('word '.repeat(80)).split(/\s+/u).every((token) => token === 'word')).toBe(true)
  })

  it('keeps natural mechanism reasoning after a cited fact without requiring template transitions', () => {
    const markdown = [
      '## 主要发现',
      '',
      '缓存响应在满足新鲜条件时可以直接复用 [claim:claim_1]。',
      '因此，现有事实需要先区分直接复用与重新确认的先后关系。',
      '这意味着存储策略与验证策略是先后协同，而不是互相替代。',
      '关键在于两类已引用行为不能互相替代，也不应被写成新的外部事实。'
    ].join('\n')
    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).toContain('因此，现有事实需要先区分直接复用与重新确认的先后关系')
    expect(sanitized).toContain('这意味着存储策略与验证策略是先后协同')
    expect(sanitized).toContain('关键在于两类已引用行为不能互相替代')
  })

  it('does not disguise unsupported applicability and action advice as causal synthesis', () => {
    const markdown = [
      '## 主要发现',
      '',
      '缓存响应在满足新鲜条件时可以直接复用 [claim:claim_1]。',
      '因此，弱 ETag 更适合所有动态 API 响应。',
      '这意味着，对于 API 响应中需要精确验证数据完整性的场景，强 ETag 可能更合适，但当前证据不足以解释该根源或验证细节。',
      '关键在于，开发者必须主动管理资源版本号。',
      '这意味着两类机制需要按证据边界分别判断。'
    ].join('\n')
    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('更适合所有动态 API 响应')
    expect(sanitized).not.toContain('强 ETag 可能更合适')
    expect(sanitized).not.toContain('开发者必须主动管理资源版本号')
    expect(sanitized).toContain('两类机制需要按证据边界分别判断')
  })

  it('does not disguise unsupported performance effects or optimality claims as synthesis', () => {
    const markdown = [
      '## 主要发现',
      '',
      '第一条事实已经绑定到来源 [claim:claim_1]。',
      '这意味着缓存命中率可能降低，但能确保客户端获得绝对一致的内容。',
      '关键在于，静态资源的内容极少变化，且其验证成本极低。',
      '因此，当前组合并非唯一或绝对最优的方案。',
      '关键在于，现有证据只支持已引用事实之间的关系。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('缓存命中率可能降低')
    expect(sanitized).not.toContain('验证成本极低')
    expect(sanitized).not.toContain('并非唯一或绝对最优')
    expect(sanitized).toContain('现有证据只支持已引用事实之间的关系')
  })

  it('removes invented driver and fallback strategy classifications', () => {
    const markdown = [
      '## 主要发现',
      '',
      'no-cache 会要求缓存复用前验证 [claim:claim_1]。',
      '关键在于，no-cache 将缓存决策从“时间驱动”转变为“验证驱动”。',
      '这意味着静态资源采用“新鲜度优先、验证作为后备”的策略。',
      '由此判断，现有证据只支持已引用行为之间的区别。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('时间驱动')
    expect(sanitized).not.toContain('新鲜度优先')
    expect(sanitized).toContain('现有证据只支持已引用行为之间的区别')
  })

  it('removes uncited implementation trust and invented strategy classifications', () => {
    const markdown = [
      '## 主要发现',
      '',
      '弱 ETag 与强 ETag 的已验证差异已经绑定证据 [claim:claim_1]。',
      '区别在于，强 ETag 的字节级精确性使缓存系统可以信任字节范围响应，并将其与完整资源缓存合并。',
      '这意味着，no-cache 实际上是一种有条件的新鲜度策略。',
      '这一判断限于本章已经引用的对象和条件，其他实现是否相同，现有材料无法回答。'
    ].join('\n')
    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('缓存系统可以信任')
    expect(sanitized).not.toContain('有条件的新鲜度策略')
    expect(sanitized).toContain('其他实现是否相同')
  })

  it('does not treat unsupported technical mechanisms and examples as safe synthesis', () => {
    const markdown = [
      '## 主要发现',
      '',
      '静态资源可以被缓存复用 [claim:claim_1]。',
      '这意味着，max-age 必须与 cache busting 配合，例如在文件名中嵌入内容哈希值。',
      '关键在于，CDN 可能忽略 no-cache 并直接返回缓存副本。',
      '因此，no-cache 用验证开销换取带宽优化，no-store 用完全传输换取安全性。',
      '关键在于，no-cache 将最终决定权完全交给服务器。',
      '这意味着，服务器可以附带 `Last-Modified` 响应头作为轻量级基础。',
      '关键在于，积极缓存与 `Last-Modified` 验证机制并非互斥，而是互补关系。',
      '关键在于，强 ETag 与弱 ETag 的区别由 ETag 值前的 W/ 前缀标记所声明。',
      '这意味着，采用哈希命名的静态资源可以把 `max-age=31536000` 做到极致，而验证头会成为冗余信息。',
      '现有证据不足以解释优先级，但开发者可以配置 `Last-Modified` 强制改变验证行为。',
      '然而，现有证据仅覆盖不会改变的文件，并未讨论资源版本更新（如通过文件名哈希实现版本化）时的缓存失效机制。这意味着，如果开发者直接修改文件，积极缓存会导致用户无法及时获得新版本。',
      '例如，共享缓存是否可能忽略 no-cache？',
      '因此，现有证据只支持区分复用与验证两个阶段。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('cache busting')
    expect(sanitized).not.toContain('CDN')
    expect(sanitized).not.toContain('换取带宽优化')
    expect(sanitized).not.toContain('最终决定权完全交给服务器')
    expect(sanitized).not.toContain('附带 `Last-Modified`')
    expect(sanitized).not.toContain('并非互斥')
    expect(sanitized).not.toContain('W/ 前缀')
    expect(sanitized).not.toContain('31536000')
    expect(sanitized).not.toContain('开发者可以配置')
    expect(sanitized).not.toContain('文件名哈希')
    expect(sanitized).not.toContain('无法及时获得新版本')
    expect(sanitized).not.toContain('共享缓存是否可能')
    expect(sanitized).toContain('只支持区分复用与验证两个阶段')
  })

  it('keeps a specific technical evidence boundary but rejects invented implementation variants', () => {
    const markdown = [
      '## 主要发现',
      '',
      '缓存副本过期且存在匹配时会发起条件请求 [claim:claim_1]。',
      '现有证据仅覆盖“存在匹配且副本已过期”的前提，未覆盖缓存未命中或副本仍然新鲜时的路径。',
      '现有证据仅覆盖时间戳验证，未涉及内容哈希或版本化策略。',
      '现有证据未覆盖验证失败时的处理——即服务器返回 200 后缓存必须替换旧响应，此时不会节省带宽。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).toContain('存在匹配且副本已过期')
    expect(sanitized).not.toContain('内容哈希')
    expect(sanitized).not.toContain('缓存必须替换旧响应')
  })

  it('repeats uncited-fact cleanup after claim placeholders become numeric citations', () => {
    const markdown = [
      '## 主要发现',
      '### 静态资源',
      '服务器可以获取文件修改时间 [3]。',
      '这意味着验证开销极低，因为服务器无需执行复杂计算即可获得 Last-Modified 值。',
      '',
      '现有证据未覆盖其他实现，因此结论不能外推。',
      '',
      '[3]: <https://example.com> "Source"'
    ].join('\n')

    const sanitized = sanitizeUncitedResolvedSentences(markdown)

    expect(sanitized).toContain('服务器可以获取文件修改时间 [3]。')
    expect(sanitized).not.toContain('验证开销极低')
    expect(sanitized).toContain('[3]: <https://example.com>')
  })

  it('removes uncited synthesis assertions from findings even without mechanism verbs', () => {
    const markdown = [
      '## 主要发现',
      '### 参与方式',
      '来源记录了两个对象在不同时间的参与比例 [1]。',
      '这表明，两者的参与方式存在显著差异。',
      '关键在于，后一对象的参与渠道更为多元。',
      '现有证据未覆盖统一时间口径，因此不能据此外推总体趋势。'
    ].join('\n')

    const sanitized = sanitizeUncitedResolvedSentences(markdown)

    expect(sanitized).toContain('来源记录了两个对象在不同时间的参与比例 [1]。')
    expect(sanitized).not.toContain('存在显著差异')
    expect(sanitized).not.toContain('参与渠道更为多元')
    expect(sanitized).toContain('不能据此外推总体趋势')
  })

  it('preserves an uncited evidence-gap delivery through resolved citation cleanup', () => {
    const markdown = [
      '## 主要发现',
      '### 最近三年变化',
      '现有可引用材料不足以直接回答“最近三年变化”，因此无法形成可靠结论。',
      '',
      '现有材料没有覆盖回答该问题所需的直接事实与适用范围，不能用相关背景、单一案例或时间范围不匹配的数据替代，也不能据此外推总体方向。'
    ].join('\n')

    const sanitized = sanitizeUncitedResolvedSentences(markdown)

    expect(sanitized).toContain('无法形成可靠结论')
    expect(sanitized).toContain('不能据此外推总体方向')
    expect(reportArgumentQualityIssues(sanitized, {
      requiredSections: [{ id: 'gap', title: '最近三年变化', required: true, questionIds: ['q_gap'], limitationFallback: '证据不足。' }],
      createdAt: '2026-07-18T00:00:00.000Z'
    }, '', {
      claims: [],
      citations: [],
      evidenceGapSectionIds: ['gap']
    })).toEqual([])
  })

  it('preserves a scoped evidence-gap boundary that starts with the missing item label', () => {
    const boundary = '关于「Beta」，本次补研获得的可引用证据仍不足以形成可靠结论；其他对象或章节的材料不能替代，也不能据此外推。'
    const sanitized = sanitizeUncitedResolvedSentences([
      '## 主要发现',
      '### 结果比较',
      boundary
    ].join('\n'))

    expect(sanitized).toContain(boundary)
  })

  it('removes uncited causal outcome expansion even when it is phrased as synthesis', () => {
    const markdown = [
      '## 主要发现',
      '### 风险',
      '来源仅确认局部对象受到影响 [1]。',
      '关键在于，条件变化会形成新的屏障，迫使敏感对象离开或失效，从而重塑整体结构。',
      '因此，即使局部条件恢复，其他效应仍可能对更广对象构成持续风险。',
      '现有证据未覆盖更广对象，因此不能据此外推。'
    ].join('\n')

    const sanitized = sanitizeUncitedResolvedSentences(markdown)

    expect(sanitized).toContain('来源仅确认局部对象受到影响 [1]。')
    expect(sanitized).not.toContain('形成新的屏障')
    expect(sanitized).not.toContain('构成持续风险')
    expect(sanitized).toContain('现有证据未覆盖更广对象')
  })

  it('removes an uncited conditional forecast while retaining the cited observed fact', () => {
    const markdown = [
      '## 主要发现',
      '### 趋势',
      '当前指标预计在报告期内增长 [1]。',
      '即便单位成本保持稳定，只要新增需求扩大，市场仍可实现这一增速。',
      '现有证据未覆盖单位成本，因此不能据此外推。'
    ].join('\n')

    const sanitized = sanitizeUncitedResolvedSentences(markdown)

    expect(sanitized).toContain('当前指标预计在报告期内增长 [1]。')
    expect(sanitized).not.toContain('市场仍可实现这一增速')
    expect(sanitized).toContain('现有证据未覆盖单位成本')
  })

  it('repairs contradictory conclusion connectors', () => {
    expect(repairDanglingConclusionConnectors('## 结论\n\n综合来看，相反，强 ETag 提供更严格的验证。'))
      .toContain('综合来看，强 ETag 提供更严格的验证。')
    expect(repairDanglingConclusionConnectors('## 结论\n\n而强 ETag 允许范围请求仍可被缓存 [1]。'))
      .toContain('强 ETag 允许范围请求仍可被缓存 [1]。')
    expect(repairDanglingConclusionConnectors('## 结论\n\n而强 ETag 允许范围请求仍可被缓存 [1]。'))
      .not.toContain('\n\n而强 ETag')
  })

  it('rejects a conclusion without inventing a fixed evidence-boundary sentence', () => {
    const markdown = [
      '## 结论',
      '',
      '第一条关键事实已经由来源直接支持 [claim:claim_1]。',
      '第二条判断解释了两项事实之间的局部关系 [claim:claim_2]。',
      '',
      '## 局限与不确定性',
      '',
      '当前证据范围有限。'
    ].join('\n')

    expect(reportConclusionDepthIssue(markdown, 'standard')).toContain('不足三句')
    expect(markdown).not.toContain('现有证据仅覆盖本文已经引用的对象和条件')
  })

  it('does not let a later citation on the same line support an earlier factual sentence', () => {
    const markdown = [
      '## 主要发现',
      '',
      'no-cache 能确保 API 数据实时性。静态资源无需在浏览器重载时重新验证 [claim:claim_static]。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(markdown)

    expect(sanitized).not.toContain('确保 API 数据实时性')
    expect(sanitized).toContain('静态资源无需在浏览器重载时重新验证 [claim:claim_static]')
  })

  it('accepts a substantive section without forcing a per-section boundary template', () => {
    const paragraphOne = [
      '本节结论是缓存策略必须把可直接复用与需要重新验证分开处理，这一判断来自已解析的协议行为 [1]。',
      '第一条证据说明响应在满足新鲜条件时可以直接复用，从而避免不必要的网络往返 [1]。',
      '第二条证据说明响应失效后要进入条件验证流程，并根据服务器判断选择复用或更新 [1]。'
    ].join('')
    const paragraphTwo = [
      '因此，两类行为并不是互相冲突的配置，而是同一缓存生命周期中的先后阶段。',
      '这意味着设计者应先判断响应是否仍可用，再决定是否发送验证请求，不能把存储策略和验证策略混为一谈。',
      '如果跳过这一顺序，系统就会把本可直接复用的响应也送去验证，或者错误复用已经失效的内容，最终同时损害性能与正确性。'
    ].join('')
    const markdown = `## 主要发现\n\n### 缓存机制\n\n${paragraphOne}\n\n${paragraphTwo}`
    expect(reportArgumentQualityIssues(markdown, {
      requiredSections: [{ id: 'mechanism', title: '缓存机制', required: true, questionIds: ['q1'], limitationFallback: '证据不足。' }],
      createdAt: '2026-07-13T00:00:00.000Z'
    })).toEqual([])
  })

  it('allows terse arguments only when a caller explicitly opts into the diagnostic path', () => {
    const markdown = [
      `第一条长句陈述两项已经绑定的证据，并解释它们共同限定了本章能够确认的事实范围，不能把其中任何一项单独当作完整结论 [claim:claim_1]。第二条长句继续补充另一项独立证据，并说明它与第一项证据之间是先后关系而不是互相替代 [claim:claim_2]。`,
      '',
      '因此，这些证据支持的是一个有条件的局部判断，现有证据未覆盖其他实现、对象与时间范围，也没有明确说明不同环境下的行为是否一致，这会限制结论向未研究情形外推。'
    ].join('\n')

    expect(reportArgumentMeetsDepth({ markdown, minimumChars: 220, evidenceCount: 2 })).toBe(false)
    expect(reportArgumentMeetsDepth({
      markdown,
      minimumChars: 220,
      evidenceCount: 2,
      allowTerseArgument: true
    })).toBe(true)
    expect(reportArgumentMeetsDepth({
      markdown,
      minimumChars: 220,
      evidenceCount: 2,
      allowTerseArgument: false
    })).toBe(false)
    expect(reportArgumentMeetsDepth({ markdown: markdown.slice(0, 110), minimumChars: 220, evidenceCount: 2 })).toBe(false)
  })

  it('accepts a developed multi-evidence argument without forcing a repeated boundary template', () => {
    const body = [
      '第一条证据确认缓存响应在满足新鲜条件时可以直接复用，从而避免额外网络请求 [1]。第二条证据确认响应失效后会进入条件验证流程，并根据服务器结果决定复用或更新 [2]。',
      '',
      '关键在于，两条证据分别描述同一缓存生命周期中的前后阶段，因此不能把直接复用和重新验证理解为互相替代的策略。这个区分也限定了本章的回答方式：证据能够说明何时直接复用以及何时重新确认，但不能把两个阶段压缩成一个笼统的缓存开关。由此判断，判断缓存行为必须同时保留响应当前状态和复用前条件，遗漏任一层都会改变对同一副本后续处理的解释。换言之，前一阶段回答当前副本能否直接使用，后一阶段回答失效副本经过服务器确认后能否继续使用，这两个判断的对象和触发条件并不相同。只有把状态判断与验证结果分开，才能准确描述一次复用决策，而不是把所有缓存命中都写成相同行为。现有证据未覆盖具体浏览器实现及异常网络条件，因此上述关系不能外推为所有客户端都采用完全相同的处理细节。'
    ].join('\n')
    const contract = {
      requiredSections: [{ id: 'cache', title: '缓存机制', required: true, questionIds: ['q1'], limitationFallback: '证据不足。' }],
      createdAt: '2026-07-13T00:00:00.000Z'
    }

    expect(reportArgumentQualityIssues(`## 主要发现\n\n### 缓存机制\n\n${body}`, contract)).toEqual([])
    expect(reportArgumentQualityIssues(`## 主要发现\n\n### 缓存机制\n\n${body.replace(' [2]', '')}`, contract))
      .toEqual([])
    expect(reportArgumentQualityIssues(`## 主要发现\n\n### 缓存机制\n\n${body.replace(/现有证据未覆盖[^。]+。/u, '本章结论如上。')}`, contract))
      .toEqual([])
    expect(reportArgumentQualityIssues(`## 主要发现\n\n### 缓存机制\n\n${body.replace(' [2]', '').replace(/现有证据未覆盖[^。]+。/u, '本章结论如上。')}`, contract))
      .toEqual([])
  })

  it('accepts a concise comparison when both sides have cited evidence and one boundary', () => {
    const body = [
      'no-cache 允许缓存保存响应，但要求每次复用前向源服务器完成验证，因此它解决的是能否再次使用已有副本的问题 [1]。',
      '与之相反，no-store 直接禁止缓存保存响应，因此两者的核心差异是允许存储后验证，还是从源头取消后续复用 [2]。',
      '现有证据仅覆盖两个响应指令的直接语义，未覆盖不同缓存实现中的额外行为，因此不能据此外推。'
    ].join('')

    expect(reportArgumentMeetsDepth({
      markdown: body,
      minimumChars: 180,
      evidenceCount: 2,
      allowDirectComparison: true
    })).toBe(true)
  })

  it('keeps a complete direct scene claim direct instead of forcing unrelated context premises', () => {
    expect(isSelfContainedContextualEvidence(
      'When an operator transfers an artifact, the receiver performs an integrity check. But immutable artifacts do not need another check even when the transfer is repeated.'
    )).toBe(true)
    expect(isSelfContainedContextualEvidence(
      "But it's not necessary to check those kinds of immutable artifacts again when a transfer is repeated, because they cannot change."
    )).toBe(true)
    expect(isSelfContainedContextualEvidence(
      "When an operator transfers an artifact, the receiver performs an integrity check. But it's not necessary to check those kinds of artifacts again when a transfer is repeated."
    )).toBe(false)
    expect(isSelfContainedContextualEvidence(
      'The receiver performs an integrity check when a matching artifact is uncertain.'
    )).toBe(false)
  })

  it('does not count an evidence boundary as evidence-to-conclusion synthesis', () => {
    const signals = reportArgumentSignals([
      '缓存中存在过期匹配时会发起条件请求 [1]。',
      '现有证据仅覆盖这一触发条件，未覆盖其他实现，因此不能据此外推。'
    ].join('\n\n'))

    expect(signals.hasEvidenceBoundary).toBe(true)
    expect(signals.hasSynthesis).toBe(false)
  })

  it('recognizes synthesis when a resolved citation placeholder starts the next Markdown sentence', () => {
    const signals = reportArgumentSignals([
      '过期响应通过条件请求重新验证。 [cit_1]',
      '',
      '由此判断，freshness 决定是否需要验证，validation 决定过期副本能否继续复用。 [cit_1][cit_2]',
      '',
      '现有证据仅覆盖标准 HTTP 缓存流程，未覆盖浏览器历史导航快照。'
    ].join('\n'))

    expect(signals.hasSynthesis).toBe(true)
    expect(signals.hasEvidenceBoundary).toBe(true)
  })

  it('does not count a vague difference label as evidence-to-conclusion synthesis', () => {
    const signals = reportArgumentSignals([
      '第一个风险点由当前证据支持 [1]。',
      '第二个风险点由另一条证据支持 [2]。',
      '关键在于，这两个风险点的作用机制和触发条件完全不同。'
    ].join('\n\n'))

    expect(signals.hasSynthesis).toBe(false)
  })

  it('does not mistake a cited if-then fact or a direct contrast for evidence synthesis in a rich section', () => {
    const body = [
      '如果调用方希望每次都取得最新响应，则指令 A 会要求在复用前完成验证 [1]。',
      '与之相反，指令 B 会阻止缓存存储该响应，因此后续没有已存副本可供复用 [2]。',
      '第一项文档还说明验证结果会决定继续使用已有响应还是接收更新后的响应 [3]。',
      '第二项文档仅定义了禁止存储，并没有描述已经存在的旧副本如何处理 [4]。',
      '',
      '现有证据仅覆盖两项指令的直接语义，未覆盖不同客户端的额外实现细节，因此不能据此外推。'
    ].join('\n')
    const signals = reportArgumentSignals(body)

    expect(signals.hasSynthesis).toBe(false)
    expect(signals.hasDirectComparison).toBe(true)
    expect(reportArgumentMeetsDepth({
      markdown: body,
      minimumChars: 260,
      evidenceCount: 4,
      allowDirectComparison: true
    })).toBe(false)
  })

  it('uses confirmed bilingual frame aliases when checking report section facets', () => {
    const body = [
      '缓存仍然新鲜时可以直接复用，而过期响应进入验证路径，这一区别决定请求是否需要访问源服务器。 [1]',
      '验证阶段会携带已有验证器发起条件请求，服务器确认内容未改变时可以继续复用原响应。 [2]',
      '因此，新鲜度负责判断何时需要验证，验证负责判断过期副本是否仍然有效，两者是缓存生命周期中的先后环节。',
      '这一结论只覆盖标准 HTTP 缓存流程，不覆盖浏览器历史导航快照等没有重新验证的实现边界。'
    ].join('\n\n')
    const contract = {
      requiredSections: [{
        id: 'freshness_validation',
        title: 'freshness 与 validation',
        required: true,
        questionIds: ['q1'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const markdown = `## 主要发现\n\n### freshness 与 validation\n\n${body}`
    const withoutFrameAliases = reportArgumentQualityIssues(markdown, contract).join('\n')
    const withFrameAliases = reportArgumentQualityIssues(
      markdown,
      contract,
      '缓存机制中的新鲜度（freshness）与验证（validation）如何协同。'
    ).join('\n')

    expect(withoutFrameAliases).toContain('全部概念分面')
    expect(withFrameAliases).not.toContain('全部概念分面')
  })

  it('uses cited claim ownership when translated prose does not repeat English title facets', () => {
    const freshnessSentence = '缓存仍然新鲜时可以直接复用，而过期响应进入验证路径，这一区别决定请求是否需要访问源服务器。'
    const validationSentence = '验证阶段会携带已有验证器发起条件请求，服务器确认内容未改变时可以继续复用原响应。'
    const body = [
      `${freshnessSentence} [1]`,
      `${validationSentence} [2]`,
      '因此，新鲜度负责判断何时需要验证，验证负责判断过期副本是否仍然有效，两者是缓存生命周期中的先后环节。',
      '这一结论只覆盖标准 HTTP 缓存流程，不覆盖浏览器历史导航快照等没有重新验证的实现边界。'
    ].join('\n\n')
    const contract = {
      requiredSections: [{
        id: 'freshness_validation',
        title: 'freshness 与 validation',
        required: true,
        questionIds: ['q1'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const issues = reportArgumentQualityIssues(
      `## 主要发现\n\n### freshness 与 validation\n\n${body}`,
      contract,
      '',
      {
        claims: [{
          id: 'claim_freshness',
          text: 'A stored response remains fresh until its freshness lifetime expires.',
          entities: ['freshness'],
          claimType: 'fact',
          supportSpanIds: ['span_freshness'],
          confidence: 'high'
        }, {
          id: 'claim_validation',
          text: 'A stale response can become fresh after validation with the origin server.',
          entities: ['validation'],
          claimType: 'fact',
          supportSpanIds: ['span_validation'],
          confidence: 'high'
        }],
        citations: [{
          id: 'cit_occ_1',
          displayId: 'cit_1',
          displayIds: ['cit_1'],
          reportPath: '/tmp/report.md',
          reportAnchor: 'claim:claim_freshness:1',
          reportClaimText: freshnessSentence,
          claimId: 'claim_freshness',
          claimIds: ['claim_freshness'],
          evidenceSpanIds: ['span_freshness'],
          status: 'verified'
        }, {
          id: 'cit_occ_2',
          displayId: 'cit_2',
          displayIds: ['cit_2'],
          reportPath: '/tmp/report.md',
          reportAnchor: 'claim:claim_validation:2',
          reportClaimText: validationSentence,
          claimId: 'claim_validation',
          claimIds: ['claim_validation'],
          evidenceSpanIds: ['span_validation'],
          status: 'verified'
        }]
      }
    ).join('\n')

    expect(issues).not.toContain('全部概念分面')
  })

  it('accepts a sparse one-claim section only with synthesis and a concrete boundary', () => {
    const fact = '现有证据表明，缓存副本过期后，浏览器会发起条件请求来确认该副本是否仍然可复用。 [1]'
    const synthesis = '因此，本章只能判断验证动作会发生，不能据此推断验证令牌的选择、服务端实现或数据一致性效果。这个局部结论用于区分直接复用与重新确认两条路径，而不是给出完整的 API 缓存策略。'
    const boundary = '现有证据仅覆盖浏览器持有过期副本这一前提，未覆盖其他客户端、未缓存请求和验证失败后的完整响应流程，也没有比较不同服务端框架或部署环境，所以结论不能外推到这些对象。'
    const contract = {
      requiredSections: [{ id: 'api', title: 'API 响应缓存场景', required: true, questionIds: ['q1'], limitationFallback: '证据不足。' }],
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const markdown = `## 主要发现\n\n### API 响应缓存场景\n\n${fact}\n\n${synthesis}\n\n${boundary}`

    expect(reportArgumentQualityIssues(markdown, contract)).toEqual([])
    expect(reportArgumentQualityIssues(markdown
      .replace(synthesis, '因此，本章结论如上。')
      .replace(boundary, '本章结论如上。'), contract).join('\n'))
      .toContain('事实摘要')
  })

  it('rejects a concise one-claim section that only restates one fact and a generic boundary', () => {
    const body = [
      '在 API 响应缓存场景中，当浏览器缓存中存在匹配但已经过期的响应时，浏览器会向远程服务器发起条件请求。 [1]',
      '',
      '因此，现有材料只能支持上述条件下的局部判断。',
      '',
      '这一判断只覆盖浏览器持有过期副本的前提，未覆盖缓存未命中、验证失败、服务端实现、网络异常、历史导航与其他相关客户端，不能据此外推完整流程。'
    ].join('\n')
    const contract = {
      requiredSections: [{ id: 'api', title: 'API 响应缓存场景', required: true, questionIds: ['q1'], limitationFallback: '证据不足。' }],
      createdAt: '2026-07-13T00:00:00.000Z'
    }

    expect(reportArgumentQualityIssues(`## 主要发现\n\n### API 响应缓存场景\n\n${body}`, contract).join('\n'))
      .toContain('事实摘要')
  })

  it('turns explicit named scope items into hard all-of coverage requirements', () => {
    const brief: ResearchBrief = {
      id: 'brief_coverage_contract',
      version: 1,
      topic: '中国乒乓球实力分析：以2021年至今的奥运会、世锦赛、世界杯和WTT高级别赛事为范围，并与日本、德国、韩国比较。',
      userIntent: '输出有证据的完整报告。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['覆盖显式范围。'],
      constraints: [],
      createdAt: '2026-07-12T00:00:00.000Z'
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      alternativesToCompare: ['日本', '德国', '韩国'],
      coreQuestions: [{ id: 'q1', text: '在「竞技成绩」维度上如何判断？', priority: 'high', required: true }]
    }
    const reportContract = {
      requiredSections: [{
        id: 'results',
        title: '竞技成绩',
        required: true,
        questionIds: ['q1'],
        limitationFallback: '证据不足。'
      }],
      createdAt: '2026-07-12T00:00:00.000Z'
    }
    const contract = buildCoverageContract({
      brief,
      frame,
      reportContract,
      nowIso: '2026-07-12T00:00:00.000Z'
    })

    expect(contract.requirements.filter((item) => item.kind === 'named_item').map((item) => item.label))
      .toEqual(['奥运会', '世锦赛', '世界杯', 'WTT高级别赛事'])
    expect(contract.requirements.filter((item) => item.kind === 'comparison_target').map((item) => item.label))
      .toEqual(['日本', '德国', '韩国'])
    expect(contract.groups.find((group) => group.id === 'coverage_group_named_item')?.relation).toBe('all_of')
    expect(evaluateCoverageRequirementEvidence({
      contract,
      claims: [],
      evidenceSpans: [],
      sources: []
    }).find((item) => item.kind === 'dimension')?.covered).toBe(false)
  })

  it('requires every comparison target inside every required report section', async () => {
    const nowIso = '2026-07-19T00:00:00.000Z'
    const brief: ResearchBrief = {
      id: 'brief_section_target_matrix',
      version: 1,
      topic: '比较 Alpha 与 Beta 的规模和治理。',
      userIntent: '逐个维度比较两个对象。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['每个维度同时覆盖两个对象。'],
      constraints: [],
      createdAt: nowIso
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      alternativesToCompare: ['Alpha', 'Beta'],
      coreQuestions: [
        { id: 'q_size', text: '在「规模」维度上有何异同？', priority: 'high', required: true },
        { id: 'q_governance', text: '在「治理」维度上有何异同？', priority: 'high', required: true }
      ]
    }
    const reportContract = {
      requiredSections: [
        { id: 'size', title: '规模', required: true, questionIds: ['q_size'], limitationFallback: '证据不足。' },
        { id: 'governance', title: '治理', required: true, questionIds: ['q_governance'], limitationFallback: '证据不足。' }
      ],
      createdAt: nowIso
    }
    const contract = buildCoverageContract({ brief, frame, reportContract, nowIso })
    const targetRequirements = contract.requirements.filter((item) => item.kind === 'comparison_target')
    expect(targetRequirements.map((item) => [item.label, item.sectionIds[0]])).toEqual([
      ['Alpha', 'size'],
      ['Beta', 'size'],
      ['Alpha', 'governance'],
      ['Beta', 'governance']
    ])

    const sources = ['alpha-size', 'beta-size', 'alpha-governance'].map((id) => ({
      id: `source_${id}`,
      sourceType: 'web' as const,
      title: `${id} report`,
      canonicalUrl: `https://example.org/${id}`,
      accessedAt: nowIso,
      importedAt: nowIso,
      reliability: 'high' as const,
      reliabilityReason: 'Direct fixture.',
      sourcePolicyTags: ['web_fetch'],
      fingerprint: `fp_${id}`,
      status: 'fetched' as const,
      kind: 'web_strong' as const
    }))
    const evidenceSpans = sources.map((source, index) => ({
      id: `span_${index + 1}`,
      sourceId: source.id,
      text: index === 0
        ? 'Alpha has a documented scale of 40 units.'
        : index === 1
          ? 'Beta has a documented scale of 55 units.'
          : 'Alpha uses an independently documented governance process.',
      textHash: `hash_${index + 1}`,
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: nowIso,
      extractorRunId: 'rr_section_target_matrix'
    }))
    const claims = evidenceSpans.map((span, index) => ({
      id: `claim_${index + 1}`,
      text: span.text,
      entities: [index === 1 ? 'Beta' : 'Alpha'],
      claimType: 'fact' as const,
      supportSpanIds: [span.id],
      confidence: 'high' as const
    }))
    const notes = claims.map((claim, index) => ({
      id: `note_${index + 1}`,
      taskId: `task_${index + 1}`,
      questionIds: [index < 2 ? 'q_size' : 'q_governance'],
      claimIds: [claim.id],
      summary: claim.text,
      implicationForBrief: 'Direct evidence.',
      confidence: 'high' as const,
      limitations: [],
      comparisonTargets: [index === 1 ? 'Beta' : 'Alpha']
    }))
    const evaluated = evaluateCoverageRequirementEvidence({ contract, claims, evidenceSpans, sources, notes })
    expect(evaluated.find((item) => item.label === 'Beta' &&
      contract.requirements.find((requirement) => requirement.id === item.requirementId)?.sectionIds.includes('governance')))
      .toMatchObject({ covered: false, claimIds: [] })

    const verdict = await new BasicCoverageEvaluator().evaluate({
      runId: 'rr_section_target_matrix',
      brief,
      frame,
      plan: { id: 'plan_matrix', runId: 'rr_section_target_matrix', rationale: 'test', tasks: [], createdAt: nowIso },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 20 }),
      coverageContract: contract,
      roundIndex: 1,
      sources,
      evidenceSpans,
      claims,
      notes,
      nowIso
    })
    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        questionIds: ['q_governance'],
        reportSectionIds: ['governance'],
        comparisonTargets: ['Beta'],
        objective: expect.stringContaining('对比对象「Beta」')
      })
    ]))
  })

  it('counts only answering evidence and uses a model-validated cross-language target mapping', () => {
    const nowIso = '2026-07-19T00:00:00.000Z'
    const contract = {
      createdAt: nowIso,
      groups: [],
      requirements: [{
        id: 'coverage_beta',
        required: true,
        kind: 'comparison_target' as const,
        label: '对象乙',
        aliases: ['对象乙'],
        questionIds: ['q_compare'],
        sectionIds: ['comparison'],
        minClaims: 1,
        minIndependentSources: 1,
        minStrongSources: 0,
        onMissing: 'block' as const
      }]
    }
    const sources = ['valid', 'context'].map((id) => ({
      id: `source_${id}`,
      sourceType: 'web' as const,
      title: id === 'valid' ? 'Entity B measurement report' : 'Object B implementation repository',
      canonicalUrl: `https://example.org/${id}`,
      accessedAt: nowIso,
      importedAt: nowIso,
      reliability: 'medium' as const,
      reliabilityReason: 'Fetched fixture.',
      sourcePolicyTags: ['web_fetch', ...(id === 'context' ? ['comparison_target:对象乙'] : [])],
      fingerprint: `fp_${id}`,
      status: 'fetched' as const,
      kind: 'web_weak' as const
    }))
    const evidenceSpans = [{
      id: 'span_valid', sourceId: 'source_valid',
      text: 'Entity B recorded 75 measured units in the current period.',
      textHash: 'hash_valid', location: { paragraphIndex: 1 }, extractedAt: nowIso, extractorRunId: 'rr_mapping'
    }, {
      id: 'span_context', sourceId: 'source_context',
      text: 'Added an ownership data layer to the repository.',
      textHash: 'hash_context', location: { paragraphIndex: 1 }, extractedAt: nowIso, extractorRunId: 'rr_mapping'
    }]
    const claims = evidenceSpans.map((span, index) => ({
      id: index === 0 ? 'claim_valid' : 'claim_context',
      text: span.text,
      entities: [],
      claimType: 'fact' as const,
      supportSpanIds: [span.id],
      confidence: 'high' as const
    }))
    const notes = [{
      id: 'note_valid', taskId: 'task_beta', questionIds: ['q_compare'], claimIds: ['claim_valid'],
      summary: claims[0]!.text, implicationForBrief: 'Direct answer.', confidence: 'high' as const, limitations: [],
      evidenceAssignments: [{
        questionId: 'q_compare', claimId: 'claim_valid', role: 'supports' as const, relevance: 1,
        explanation: '该证据直接回答对象乙的量化结果。', source: 'model_validated' as const
      }]
    }, {
      id: 'note_context', taskId: 'task_beta_context', questionIds: ['q_compare'], claimIds: ['claim_context'],
      summary: claims[1]!.text, implicationForBrief: 'Background only.', confidence: 'medium' as const, limitations: [],
      comparisonTargets: ['对象乙'],
      evidenceAssignments: [{
        questionId: 'q_compare', claimId: 'claim_context', role: 'context' as const, relevance: 0.25,
        explanation: 'Only background.', source: 'deterministic' as const
      }]
    }]

    expect(evaluateCoverageRequirementEvidence({ contract, claims, evidenceSpans, sources, notes })[0])
      .toMatchObject({ covered: true, claimIds: ['claim_valid'] })
  })

  it('repairs uncovered dimension facets before spending a round on source-count padding', async () => {
    const brief: ResearchBrief = {
      id: 'brief_dimension_repair',
      version: 1,
      topic: '解释 freshness 与 validation、no-cache 与 no-store。',
      userIntent: '逐项解释成对缓存概念。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['每个概念均有直接证据。'],
      constraints: [],
      createdAt: '2026-07-13T00:00:00.000Z'
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [{
        id: 'freshness_validation',
        text: '在「freshness 与 validation」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }, {
        id: 'cache_directives',
        text: '在「no-cache 与 no-store」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }]
    }
    const reportContract = {
      requiredSections: [{
        id: 'freshness_validation',
        title: 'freshness 与 validation',
        required: true,
        questionIds: ['freshness_validation'],
        limitationFallback: '证据不足。'
      }, {
        id: 'cache_directives',
        title: 'no-cache 与 no-store',
        required: true,
        questionIds: ['cache_directives'],
        limitationFallback: '证据不足。'
      }],
      createdAt: brief.createdAt
    }
    const verdict = await new BasicCoverageEvaluator().evaluate({
      runId: 'rr_dimension_repair',
      brief,
      frame,
      plan: {
        id: 'plan_dimension_repair',
        runId: 'rr_dimension_repair',
        rationale: 'test',
        tasks: [],
        createdAt: brief.createdAt
      },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 12, maxResearchRounds: 2 }),
      coverageContract: buildCoverageContract({ brief, frame, reportContract, nowIso: brief.createdAt }),
      roundIndex: 1,
      sources: [],
      evidenceSpans: [],
      claims: [],
      notes: [],
      nowIso: brief.createdAt
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks.map((task) => task.questionIds[0])).toEqual([
      'freshness_validation',
      'cache_directives'
    ])
    expect(verdict.followUpTasks[0]?.expectedEvidence.join('\n')).toContain('逐面覆盖')
    expect(verdict.followUpTasks[1]?.expectedEvidence.join('\n')).toContain('no-store')
  })

  it('binds an explicit dimension repair to its dimension question instead of the shared umbrella question', async () => {
    const brief: ResearchBrief = {
      id: 'brief_dimension_ownership',
      version: 1,
      topic: '分析一个系统的现金流与负债情况。',
      userIntent: '回答显式维度。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['现金流与负债均有证据。'],
      constraints: [],
      createdAt: '2026-07-15T00:00:00.000Z'
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      centralQuestion: '这个系统的财务健康如何？',
      coreQuestions: [{
        id: 'q1',
        text: '这个系统的财务健康如何？',
        priority: 'high',
        required: true
      }, {
        id: 'q2',
        text: '在「现金流 与 负债情况」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }]
    }
    const reportContract = {
      requiredSections: [{
        id: 'finance',
        title: '现金流 与 负债情况',
        required: true,
        questionIds: ['q1', 'q2'],
        limitationFallback: '证据不足。'
      }],
      createdAt: brief.createdAt
    }
    const verdict = await new BasicCoverageEvaluator().evaluate({
      runId: 'rr_dimension_ownership',
      brief,
      frame,
      plan: {
        id: 'plan_dimension_ownership',
        runId: 'rr_dimension_ownership',
        rationale: 'test',
        tasks: [],
        createdAt: brief.createdAt
      },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 12 }),
      coverageContract: buildCoverageContract({ brief, frame, reportContract, nowIso: brief.createdAt }),
      roundIndex: 1,
      sources: [],
      evidenceSpans: [],
      claims: [],
      notes: [],
      nowIso: brief.createdAt
    })

    const repair = verdict.followUpTasks.find((task) => task.objective.includes('用户硬性范围项'))
    expect(repair).toMatchObject({
      questionIds: ['q2'],
      reportQuestionIds: ['q2'],
      reportSectionIds: ['finance'],
      reportSectionTitles: ['现金流 与 负债情况']
    })
    expect(verdict.followUpTasks.filter((task) => task.questionIds.includes('q2'))).toHaveLength(1)
  })

  it('repairs only truly empty sections when sibling sections already have citable weak evidence', async () => {
    const nowIso = '2026-07-15T00:00:00.000Z'
    const brief: ResearchBrief = {
      id: 'brief_mixed_weak_coverage',
      version: 1,
      topic: '分析示例系统的运行稳定性、成本结构和恢复能力。',
      userIntent: '逐项回答三个维度。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['三个维度均有直接证据。'],
      constraints: [],
      createdAt: nowIso
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      centralQuestion: '示例系统的整体状态如何？',
      coreQuestions: ['运行稳定性', '成本结构', '恢复能力'].map((title, index) => ({
        id: `q${index + 1}`,
        text: `在「${title}」维度上，关键事实是什么？`,
        priority: 'high' as const,
        required: true
      }))
    }
    const reportContract = {
      requiredSections: frame.coreQuestions.map((question, index) => ({
        id: question.id,
        title: ['运行稳定性', '成本结构', '恢复能力'][index]!,
        required: true,
        questionIds: [question.id],
        limitationFallback: '证据有限。'
      })),
      createdAt: nowIso
    }
    const sources = ['stability', 'recovery'].map((name) => ({
      id: `source_${name}`,
      sourceType: 'web' as const,
      title: `Example ${name} record`,
      originalUrl: `https://public.example/${name}`,
      canonicalUrl: `https://public.example/${name}`,
      accessedAt: nowIso,
      importedAt: nowIso,
      reliability: 'medium' as const,
      reliabilityReason: 'Public but not primary.',
      sourcePolicyTags: ['web_fetch'],
      fingerprint: `fp_${name}`,
      status: 'fetched' as const,
      kind: 'web_weak' as const
    }))
    const spanTexts = [
      '运行记录显示，示例系统本季度的运行稳定性保持在既定服务阈值内。',
      '恢复演练记录显示，示例系统能够在计划窗口内恢复核心服务，体现了恢复能力。'
    ]
    const evidenceSpans = spanTexts.map((text, index) => ({
      id: `span_${index + 1}`,
      sourceId: sources[index]!.id,
      text,
      textHash: `hash_${index + 1}`,
      location: { url: sources[index]!.canonicalUrl, paragraphIndex: 1 },
      extractedAt: nowIso,
      extractorRunId: 'rr_mixed_weak_coverage'
    }))
    const claims = spanTexts.map((text, index) => ({
      id: `claim_${index + 1}`,
      text,
      entities: [index === 0 ? '运行稳定性' : '恢复能力'],
      claimType: 'fact' as const,
      supportSpanIds: [evidenceSpans[index]!.id],
      confidence: 'medium' as const,
      critical: true
    }))
    const notes = [{
      id: 'note_stability', taskId: 'task_stability', questionIds: ['q1'], claimIds: ['claim_1'],
      summary: claims[0]!.text, implicationForBrief: '回答运行稳定性。', confidence: 'medium' as const, limitations: ['来源较弱。']
    }, {
      id: 'note_recovery', taskId: 'task_recovery', questionIds: ['q3'], claimIds: ['claim_2'],
      summary: claims[1]!.text, implicationForBrief: '回答恢复能力。', confidence: 'medium' as const, limitations: ['来源较弱。']
    }]
    const plan = {
      id: 'plan_mixed_weak_coverage',
      runId: 'rr_mixed_weak_coverage',
      rationale: 'test',
      tasks: [{
        id: 'task_stability', questionIds: ['q1'], reportQuestionIds: ['q1'], objective: '运行稳定性', expectedEvidence: ['记录'], sourceTypes: ['web' as const], searchHints: ['运行稳定性'], maxSources: 1, priority: 'high' as const, status: 'done' as const
      }, {
        id: 'task_cost', questionIds: ['q2'], reportQuestionIds: ['q2'], objective: '成本结构', expectedEvidence: ['记录'], sourceTypes: ['web' as const], searchHints: ['成本结构'], maxSources: 1, priority: 'high' as const, status: 'done' as const
      }, {
        id: 'task_recovery', questionIds: ['q3'], reportQuestionIds: ['q3'], objective: '恢复能力', expectedEvidence: ['记录'], sourceTypes: ['web' as const], searchHints: ['恢复能力'], maxSources: 1, priority: 'high' as const, status: 'done' as const
      }],
      createdAt: nowIso
    }

    const verdict = await new BasicCoverageEvaluator().evaluate({
      runId: 'rr_mixed_weak_coverage',
      brief,
      frame,
      plan,
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 12 }),
      coverageContract: buildCoverageContract({ brief, frame, reportContract, nowIso }),
      roundIndex: 1,
      sources,
      evidenceSpans,
      claims,
      notes,
      nowIso
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks.map((task) => task.questionIds[0])).toEqual(['q2'])
  })

  it('never reuses a matching facet owned by another report question', async () => {
    const nowIso = '2026-07-13T00:00:00.000Z'
    const brief: ResearchBrief = {
      id: 'brief_scoped_dimension_coverage',
      version: 1,
      topic: '解释 freshness 与 validation、no-cache 与 no-store。',
      userIntent: '逐项解释成对缓存概念。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['每个概念均有直接证据。'],
      constraints: [],
      createdAt: nowIso
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [{
        id: 'freshness_validation',
        text: '在「freshness 与 validation」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }, {
        id: 'cache_directives',
        text: '在「no-cache 与 no-store」维度上，关键事实是什么？',
        priority: 'high',
        required: true
      }]
    }
    const reportContract = {
      requiredSections: [{
        id: 'freshness_validation',
        title: 'freshness 与 validation',
        required: true,
        questionIds: ['freshness_validation'],
        limitationFallback: '证据不足。'
      }, {
        id: 'cache_directives',
        title: 'no-cache 与 no-store',
        required: true,
        questionIds: ['cache_directives'],
        limitationFallback: '证据不足。'
      }],
      createdAt: nowIso
    }
    const contract = buildCoverageContract({ brief, frame, reportContract, nowIso })
    const sources = ['no-cache', 'no-store'].map((label, index) => ({
      id: `source_scoped_${index + 1}`,
      sourceType: 'web' as const,
      title: `${label} official documentation`,
      originalUrl: `https://example.com/${label}`,
      canonicalUrl: `https://example.com/${label}`,
      accessedAt: nowIso,
      importedAt: nowIso,
      reliability: 'high' as const,
      reliabilityReason: 'Official test documentation.',
      sourcePolicyTags: ['web_fetch'],
      fingerprint: `source_scoped_fp_${index + 1}`,
      status: 'fetched' as const,
      kind: 'web_strong' as const
    }))
    const spanTexts = [
      'The no-cache response directive permits storage but requires validation before every reuse.',
      'The no-store response directive tells caches not to store the response.'
    ]
    const evidenceSpans = spanTexts.map((text, index) => ({
      id: `span_scoped_${index + 1}`,
      sourceId: sources[index]!.id,
      text,
      textHash: `span_scoped_hash_${index + 1}`,
      location: { url: sources[index]!.canonicalUrl, paragraphIndex: 1 },
      extractedAt: nowIso,
      extractorRunId: 'rr_scoped_dimension'
    }))
    const claims = spanTexts.map((text, index) => ({
      id: `claim_scoped_${index + 1}`,
      text,
      entities: [index === 0 ? 'no-cache' : 'no-store'],
      claimType: 'fact' as const,
      supportSpanIds: [evidenceSpans[index]!.id],
      confidence: 'high' as const,
      critical: true
    }))
    const notes = [{
      id: 'note_cache_directives',
      taskId: 'task_cache_directives',
      questionIds: ['cache_directives'],
      claimIds: [claims[0]!.id],
      summary: 'Only no-cache is covered.',
      implicationForBrief: 'no-store still needs direct evidence.',
      confidence: 'high' as const,
      limitations: ['no-store is missing.']
    }, {
      id: 'note_other_question',
      taskId: 'task_other_question',
      questionIds: ['freshness_validation'],
      claimIds: [claims[1]!.id],
      summary: 'This claim belongs to another research question.',
      implicationForBrief: 'It must not satisfy cache_directives.',
      confidence: 'high' as const,
      limitations: []
    }]

    const explicitCoverage = evaluateCoverageRequirementEvidence({
      contract,
      claims,
      evidenceSpans,
      sources,
      notes
    })
    expect(explicitCoverage.find((item) => item.label === 'no-cache 与 no-store')).toMatchObject({
      covered: false,
      claimIds: [claims[0]!.id]
    })

    const verdict = await new BasicCoverageEvaluator().evaluate({
      runId: 'rr_scoped_dimension',
      brief,
      frame,
      plan: {
        id: 'plan_scoped_dimension',
        runId: 'rr_scoped_dimension',
        rationale: 'test',
        tasks: [],
        createdAt: nowIso
      },
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 8, maxResearchRounds: 2 }),
      coverageContract: contract,
      roundIndex: 1,
      sources,
      evidenceSpans,
      claims,
      notes,
      nowIso
    })
    expect(verdict.status).toBe('need_more')
    expect(verdict.followUpTasks.some((task) =>
      task.questionIds.includes('cache_directives') && task.objective.includes('用户硬性范围项')
    )).toBe(true)
    expect(verdict.followUpTasks.some((task) => task.questionIds.includes('freshness_validation'))).toBe(true)
  })

  it('does not count a named scope item from a source title when the citable evidence never mentions it', () => {
    const brief: ResearchBrief = {
      id: 'brief_coverage_evidence',
      version: 1,
      topic: '中国乒乓球实力分析：以2021年至今的奥运会、世锦赛、世界杯和WTT高级别赛事为范围。',
      userIntent: '输出有证据的完整报告。',
      outputFormat: 'Markdown',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
      successCriteria: ['覆盖显式范围。'],
      constraints: [],
      createdAt: '2026-07-12T00:00:00.000Z'
    }
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [{ id: 'q1', text: '竞技成绩如何？', priority: 'high', required: true }]
    }
    const contract = buildCoverageContract({
      brief,
      frame,
      reportContract: {
        requiredSections: [{
          id: 'results',
          title: '竞技成绩',
          required: true,
          questionIds: ['q1'],
          limitationFallback: '证据不足。'
        }],
        createdAt: brief.createdAt
      },
      nowIso: brief.createdAt
    })
    const labels = ['奥运会', '世锦赛', '世界杯', 'WTT高级别赛事']
    const sources = labels.map((label, index) => ({
      id: `source_${index + 1}`,
      sourceType: 'web' as const,
      title: index === 3 ? 'WTT 高级别赛事结果页' : `${label}官方结果页`,
      originalUrl: `https://example.com/result-${index + 1}`,
      canonicalUrl: `https://example.com/result-${index + 1}`,
      accessedAt: brief.createdAt,
      importedAt: brief.createdAt,
      reliability: 'high' as const,
      reliabilityReason: '测试中的官方结果页。',
      sourcePolicyTags: ['web_fetch'],
      fingerprint: `source_fp_${index + 1}`,
      status: 'fetched' as const,
      kind: 'web_strong' as const
    }))
    const spanTexts = [
      '奥运会官方结果记录了中国队在该届比赛中的项目成绩和奖牌结果。',
      '世锦赛官方结果记录了中国队在该届比赛中的项目成绩和晋级情况。',
      '世界杯官方结果记录了中国队在该届比赛中的项目成绩和最终名次。',
      '该页面只说明中国队参加了若干国际比赛，没有给出具体赛事名称。'
    ]
    const evidenceSpans = spanTexts.map((text, index) => ({
      id: `span_${index + 1}`,
      sourceId: `source_${index + 1}`,
      text,
      textHash: `span_hash_${index + 1}`,
      location: { paragraphIndex: index + 1 },
      extractedAt: brief.createdAt,
      extractorRunId: 'rr_coverage_evidence'
    }))
    const claims = spanTexts.map((text, index) => ({
      id: `claim_${index + 1}`,
      text,
      entities: index < 3 ? [labels[index]!] : ['中国队'],
      claimType: 'fact' as const,
      supportSpanIds: [`span_${index + 1}`],
      confidence: 'high' as const,
      critical: true
    }))

    const matrix = evaluateCoverageRequirementEvidence({ contract, claims, evidenceSpans, sources })
      .filter((item) => item.kind === 'named_item')

    expect(matrix.filter((item) => item.covered).map((item) => item.label))
      .toEqual(['奥运会', '世锦赛', '世界杯'])
    expect(matrix.find((item) => item.label === 'WTT高级别赛事')).toMatchObject({
      covered: false,
      claimIds: [],
      sourceIds: []
    })
  })

  it('does not charge completed task allocations against a follow-up round', () => {
    const frame = testFrame()
    const task = {
      id: 'task_initial',
      questionIds: ['central'],
      objective: 'collect initial evidence',
      expectedEvidence: ['official evidence'],
      sourceTypes: ['web' as const],
      searchHints: ['official source'],
      maxSources: 3,
      priority: 'high' as const,
      status: 'done' as const
    }
    const followUp = {
      ...task,
      id: 'task_follow_up',
      objective: 'repair evidence gap',
      maxSources: 12,
      status: 'pending' as const
    }

    expect(() => validateResearchPlan({
      id: 'plan_with_follow_up',
      runId: 'rr_with_follow_up',
      rationale: 'test budget accounting',
      tasks: [task, followUp],
      createdAt: '2026-07-11T00:00:00.000Z'
    }, frame, 12)).not.toThrow()
  })

  it('detects and removes factual sentences that borrow a paragraph-end citation', () => {
    const draft = [
      '# HTTP 缓存验证',
      '',
      '## 主要发现',
      '',
      '### no-store',
      '',
      'no-store 禁止缓存存储响应 [claim:claim_1]。这意味着每次请求都必须获取完整响应。从性能角度看，它一定会降低用户体验。no-cache 在历史导航中可能绕过验证 [claim:claim_1]，这一边界对 no-store 不成立。',
      '',
      '## 结论',
      '',
      'no-store 的证据边界只到禁止存储 [claim:claim_1]。',
      '',
      '## 局限与不确定性',
      '',
      '当前证据未覆盖浏览器差异。某些浏览器一定会忽略 no-store。'
    ].join('\n')
    const resolved = draft
      .replace(/\[claim:claim_1\]/g, '<sup data-citation-id="cit_1">[1]</sup>')

    expect(uncitedReportSentences(resolved)).toEqual(expect.arrayContaining([
      '这意味着每次请求都必须获取完整响应。',
      '从性能角度看，它一定会降低用户体验。',
      '这一边界对 no-store 不成立。',
      '某些浏览器一定会忽略 no-store。'
    ]))
    const sanitized = sanitizeUncitedDraftSentences(draft)
    expect(sanitized).toContain('no-store 禁止缓存存储响应 [claim:claim_1]。')
    expect(sanitized).not.toContain('每次请求都必须')
    expect(sanitized).not.toContain('降低用户体验')
    expect(sanitized).not.toContain('这一边界对 no-store 不成立')
    expect(sanitized).toContain('当前证据未覆盖浏览器差异。')
    expect(sanitized).not.toContain('一定会忽略 no-store')
  })

  it('does not mistake explicit report evidence boundaries for uncited findings', () => {
    const report = [
      '# Report',
      '## 局限与不确定性',
      '本报告仅使用本次已收集并通过引用校验的来源；未被这些来源明确覆盖的对象、时间范围和实现差异不纳入结论。'
    ].join('\n')

    expect(uncitedReportSentences(report)).toEqual([])
  })

  it('keeps explicit evidence limits but removes editor-added uncited conclusions', () => {
    const draft = [
      '# HTTP 缓存验证',
      '',
      '## 主要发现',
      '',
      '强 ETag 支持范围请求缓存 [claim:claim_1]。对于视频流，它一定会降低所有回源成本。',
      '',
      '## 结论',
      '',
      '强弱验证器影响范围请求缓存 [claim:claim_1]。这些机制共同构成所有浏览器缓存的一阶行为。',
      '',
      '## 局限与不确定性',
      '',
      '本报告基于 MDN 官方来源，结论受限于该文档的覆盖范围。本报告按用户要求仅使用 developer.mozilla.org，没有用其他来源交叉验证，结论范围以该来源明确覆盖的内容为限。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(draft)
    expect(sanitized).toContain('强 ETag 支持范围请求缓存 [claim:claim_1]。')
    expect(sanitized).toContain('强弱验证器影响范围请求缓存 [claim:claim_1]。')
    expect(sanitized).toContain('结论受限于该文档的覆盖范围')
    expect(sanitized).toContain('仅使用 developer.mozilla.org')
    expect(sanitized).not.toContain('一定会降低所有回源成本')
    expect(sanitized).not.toContain('共同构成所有浏览器缓存')
  })

  it('removes uncited suitability and operational advice from final conclusions', () => {
    const draft = [
      '# HTTP 缓存',
      '## 结论',
      'no-cache 允许缓存复用前验证 [claim:claim_1]。因此，两种策略解决的是不同约束。弱 ETag 更适合 API 响应，静态资源通常使用强 ETag 和较长 max-age。开发者需要优先使用 no-store 保护敏感数据。',
      '## 局限与不确定性',
      '现有证据未覆盖具体部署。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(draft)
    expect(sanitized).toContain('因此，两种策略解决的是不同约束。')
    expect(sanitized).not.toContain('更适合 API')
    expect(sanitized).not.toContain('通常使用强 ETag')
    expect(sanitized).not.toContain('开发者需要')
  })

  it('does not treat uncited direct-proof language as harmless evidence synthesis', () => {
    const draft = [
      '# 中国乒乓球实力分析',
      '## 主要发现',
      '中国队在该赛事保持全胜 [claim:claim_1]。这一成绩直接证明中国队在所有项目都拥有无可匹敌的统治力。',
      '## 结论',
      '现有证据只支持该赛事范围内的判断 [claim:claim_1]。',
      '## 局限与不确定性',
      '现有证据未覆盖其他项目。'
    ].join('\n')

    const sanitized = sanitizeUncitedDraftSentences(draft)
    expect(sanitized).toContain('中国队在该赛事保持全胜 [claim:claim_1]。')
    expect(sanitized).not.toContain('直接证明')
    expect(sanitized).not.toContain('无可匹敌')
  })

  it('removes MDN header metadata without deleting neighboring cited conclusions', () => {
    const draft = '综合来看，Header type Response header, Representation header Forbidden request header No Syntax http ETag: W/"x" [claim:claim_bad]；验证通过条件请求完成 [claim:claim_good]；no-store 禁止存储 [claim:claim_store]。'
    const sanitized = sanitizeExtractionBoilerplateSentences(draft)
    expect(sanitized).not.toContain('Header type')
    expect(sanitized).toContain('验证通过条件请求完成 [claim:claim_good]')
    expect(sanitized).toContain('no-store 禁止存储 [claim:claim_store]')
  })

  it('removes bilingual report-page headers pasted into a claim sentence', () => {
    const draft = 'EXAMPLE INTERNATIONAL GROUP LIMITED 示例國際集團有限公司 162 2024 ENVIRONMENTAL, SOCIAL AND GOVERNANCE REPORT 2024 年環境、社會及管治報告 Marketing Management In compliance with regulations [claim:claim_bad]。'
    expect(sanitizeExtractionBoilerplateSentences(draft)).toBe('')
  })

  it('removes cited navigation and truncated mixed-language fragments from resolved prose', () => {
    const report = [
      '## 主要发现',
      '### 示例维度',
      '完整的中文事实句说明了来源明确记录的结果。 [1]',
      'no limits first 5 days after listing) Example Exchange (示例所) ±30% (since Nov 2021) Special Stocks ±5%。 [2]',
      '> Public information > Disclosure directory > Topic category > Enforcement action. [3]',
      '',
      '[1]: <https://example.com/one> "One"',
      '[2]: <https://example.com/two> "Is this source usable? Yes."',
      '[3]: <https://example.com/three> "Three"'
    ].join('\n')

    const finalized = finalizeResolvedReportProse(report)

    expect(finalized).toContain('完整的中文事实句')
    expect(finalized).not.toContain('no limits first')
    expect(finalized).not.toContain('Disclosure directory')
    expect(finalized).not.toContain('[2]: <https://example.com/two> "Is this source usable? Yes."')
  })

  it('removes body URLs and authored links while preserving generated citation definitions', () => {
    const report = [
      '## 主要发现',
      '正文不应直接贴出 https://example.com/raw，也不应保留[模型链接](https://example.com/authored)。 [1]',
      '',
      '[1]: <https://example.com/source> "Source title"'
    ].join('\n')

    expect(reportBodyUrlIssue(report)).toContain('https://example.com/authored')
    const sanitized = sanitizeReportBodyUrls(report)
    expect(sanitized).not.toContain('https://example.com/raw')
    expect(sanitized).toContain('模型链接')
    expect(sanitized).toContain('[1]: <https://example.com/source> "Source title"')
    expect(reportBodyUrlIssue(sanitized)).toBeUndefined()
  })

  it('detects and removes near-duplicate evidence sentences across finding sections', () => {
    const report = [
      '## 主要发现',
      '### 市场结构',
      '现有统计显示两个市场的上市主体规模和投资者构成存在明显差异，这一差异会影响交易结构。 [1]',
      '### 交易制度',
      '现有统计显示两个市场的上市主体规模与投资者构成存在明显差异，这种差异会影响交易结构。 [2]',
      '',
      '[1]: <https://example.com/one> "One"',
      '[2]: <https://example.com/two> "Two"'
    ].join('\n')

    expect(repeatedFindingSentenceAcrossSections(report)).toContain('现有统计显示')
    const finalized = finalizeResolvedReportProse(report)
    expect(finalized.match(/现有统计显示/gu)).toHaveLength(1)
    expect(finalized).toContain('[1]: <https://example.com/one> "One"')
    expect(finalized).not.toContain('[2]: <https://example.com/two> "Two"')
  })

  it('treats a page-location cross-reference without substantive facts as extraction noise', () => {
    expect(containsExtractionBoilerplate(
      '本集团面对的主要风险及不明确因素之描述载于本年报第35页的「管理层讨论与分析」。'
    )).toBe(true)
    expect(containsExtractionBoilerplate(
      '管理层认为集团并未面临重大外汇风险。'
    )).toBe(false)
  })

  it('builds the summary only from cited prose and preserves later sentences on the same line', () => {
    const report = renderFinalReportMarkdown({
      brief: { topic: '缓存策略', userIntent: '解释缓存策略' },
      frame: { centralQuestion: '缓存策略如何工作？', coreResearchThread: '缓存策略边界' }
    } as never, [
      '# 缓存策略',
      '',
      '## 主要发现',
      '',
      '这个没有引用的判断不能进入摘要。而带引用的核心判断可以进入摘要。<sup data-citation-id="cit_1">[1]</sup> 同一行后续的证据边界必须保留。<sup data-citation-id="cit_2">[2]</sup>',
      '',
      '### 详细分析',
      '',
      '这里展开分析。<sup data-citation-id="cit_1">[1]</sup>',
      '',
      '## 结论',
      '',
      '结论有引用。<sup data-citation-id="cit_1">[1]</sup>'
    ].join('\n'), {
      generatedAt: '2026-07-11T00:00:00.000Z',
      sourceCount: 2,
      claimCount: 2
    })

    const summary = report.match(/## 摘要\n\n([\s\S]*?)\n\n## /u)?.[1] ?? ''
    expect(summary).not.toContain('这个没有引用的判断')
    expect(summary).not.toContain('而带引用')
    expect(summary).toContain('带引用的核心判断可以进入摘要')
    expect(summary).not.toMatch(/\[1\][；。]/u)
    expect(report).toContain('这个没有引用的判断不能进入摘要。')
    expect(report).toContain('同一行后续的证据边界必须保留。')
    expect(report).toContain('[1]: #citation-1')
    expect(report).not.toContain('<sup')
    expect(report).toContain('研究问题：缓存策略。')
    expect(report).not.toContain('分析围绕围绕')
  })

  it('prefers cited section judgements over the first cited fact in the summary', () => {
    const citation1 = '<sup data-citation-id="cit_1">[1]</sup>'
    const citation2 = '<sup data-citation-id="cit_2">[2]</sup>'
    const report = renderFinalReportMarkdown({
      brief: { topic: '公司基本面', userIntent: '分析财务和增长' },
      frame: { centralQuestion: '基本面如何？', coreResearchThread: '分析财务和增长' }
    } as never, [
      '# 公司基本面',
      '',
      '## 主要发现',
      '',
      '### 财务健康',
      '',
      `2024年资产负债率为26.8%。${citation1}`,
      '',
      `2025年营收同比增长184.7%。${citation2}`,
      '',
      `由此判断，业务扩张与负债率上升同时发生，但现有材料不能证明两者存在直接因果关系。${citation1}${citation2}`,
      '',
      '现有证据仅覆盖已披露的年度数据。',
      '',
      '## 结论',
      '',
      `财务判断受证据边界限制。${citation1}`
    ].join('\n'), { generatedAt: '2026-07-16T00:00:00.000Z', sourceCount: 2, claimCount: 2 })

    const summary = report.match(/## 摘要\n\n([\s\S]*?)\n\n## /u)?.[1] ?? ''
    expect(summary).toContain('由此判断')
    expect(summary).not.toContain('2024年资产负债率为26.8%')
  })

  it('ranks cited judgements across all sections instead of taking the earliest section facts', () => {
    const citation1 = '<sup data-citation-id="cit_1">[1]</sup>'
    const citation2 = '<sup data-citation-id="cit_2">[2]</sup>'
    const report = renderFinalReportMarkdown({
      brief: { topic: '跨领域比较', userIntent: '比较两个系统' },
      frame: { centralQuestion: '两个系统如何不同？', coreResearchThread: '比较系统边界' }
    } as never, [
      '# 跨领域比较',
      '## 主要发现',
      '### 第一部分',
      `第一部分只有一条引用事实。${citation1}`,
      '### 第二部分',
      `第二部分也有一条引用事实。${citation2}`,
      `由此判断，两部分分别约束不同条件，不能互相替代。${citation1}${citation2}`,
      '现有证据未覆盖条件之外的结果。',
      '## 结论',
      `结论受现有条件限制。${citation1}${citation2}`
    ].join('\n\n'), { generatedAt: '2026-07-20T00:00:00.000Z', sourceCount: 2, claimCount: 2 })

    const summary = report.match(/## 摘要\n\n([\s\S]*?)\n\n## /u)?.[1] ?? ''
    expect(summary.split('\n')[0]).toContain('由此判断')
  })

  it('removes a repeated findings preamble when multiple evidence subsections exist', () => {
    const citation = '<sup data-citation-id="cit_1">[1]</sup>'
    const report = renderFinalReportMarkdown({
      brief: { topic: '缓存策略', userIntent: '解释缓存策略' },
      frame: { centralQuestion: '缓存策略如何工作？', coreResearchThread: '缓存策略边界' }
    } as never, [
      '# 缓存策略',
      '',
      '## 主要发现',
      '',
      `这里先重复所有章节的结论。${citation}`,
      '',
      '### 强弱验证器',
      '',
      `强 ETag 支持范围请求缓存。${citation}`,
      '',
      '### no-cache 与 no-store',
      '',
      `no-store 禁止存储。${citation}`,
      '',
      '## 结论',
      '',
      `缓存策略需要按目标选择。${citation}`,
      '',
      '## 局限与不确定性',
      '',
      '当前仅核验指定来源。'
    ].join('\n'), { generatedAt: '2026-07-11T00:00:00.000Z', sourceCount: 1, claimCount: 2 })

    expect(report).not.toContain('这里先重复所有章节的结论')
    expect(report).toContain('### 强弱验证器')
    expect(report).toContain('### no-cache 与 no-store')
  })

  it('removes a single-section findings preamble when the same cited facts reappear in reverse order', () => {
    const citation = '<sup data-citation-id="cit_1">[1]</sup>'
    const report = renderFinalReportMarkdown({
      brief: { topic: '缓存策略', userIntent: '解释缓存策略' },
      frame: { centralQuestion: '缓存策略如何工作？', coreResearchThread: '缓存策略边界' }
    } as never, [
      '# 缓存策略',
      '',
      '## 主要发现',
      '',
      `事实 A。${citation}事实 B。${citation}`,
      '',
      '### 核心机制',
      '',
      `事实 B。${citation}事实 A。${citation}`,
      '',
      '因此，两条事实共同限定核心机制。' + citation,
      '',
      '## 结论',
      '',
      `结论。${citation}`,
      '',
      '## 局限与不确定性',
      '',
      '当前仅核验指定来源。'
    ].join('\n'), { generatedAt: '2026-07-14T00:00:00.000Z', sourceCount: 1, claimCount: 2 })

    const findings = report.match(/## 主要发现\n\n([\s\S]*?)\n\n## 结论/u)?.[1] ?? ''
    expect(findings).toMatch(/^### 核心机制/u)
    expect(findings.match(/事实 A/gu)).toHaveLength(1)
    expect(findings.match(/事实 B/gu)).toHaveLength(1)
  })

  it('deduplicates near-identical cited findings across the summary and a single subsection', () => {
    const citation = '<sup data-citation-id="cit_1">[1]</sup>'
    const report = renderFinalReportMarkdown({
      brief: { topic: '缓存策略', userIntent: '解释缓存策略' },
      frame: { centralQuestion: 'no-cache 如何约束缓存复用？', coreResearchThread: '解释存储与验证的关系' }
    } as never, [
      '# 缓存策略',
      '',
      '## 主要发现',
      '',
      `no-cache 允许浏览器缓存存储响应，但强制每次复用前向源服务器重新验证其有效性。${citation}`,
      '',
      '### no-cache',
      '',
      `no-cache 允许缓存（包括浏览器缓存）存储响应，但强制要求在每次复用该响应之前向源服务器重新验证。${citation}`,
      '',
      '因此，它约束的是已存储响应的复用条件。',
      '',
      '## 结论',
      '',
      `no-cache 不等于禁止存储。${citation}`,
      '',
      '## 局限与不确定性',
      '',
      '当前仅核验指定来源。'
    ].join('\n'), { generatedAt: '2026-07-14T00:00:00.000Z', sourceCount: 1, claimCount: 1 })

    const findings = report.match(/## 主要发现\n\n([\s\S]*?)\n\n## 结论/u)?.[1] ?? ''
    const summary = report.match(/## 摘要\n\n([\s\S]*?)\n\n## /u)?.[1] ?? ''
    expect(findings).toMatch(/^### no-cache/u)
    expect(summary.match(/^- /gmu)).toHaveLength(1)
  })

  it('treats Findings and Conclusion table data rows as factual prose', () => {
    const unresolvedTable = [
      '# 市场比较',
      '',
      '## 主要发现',
      '',
      '| 产品 | 市场份额 |',
      '| --- | ---: |',
      '| 产品 A | 45% |',
      '',
      '## 结论',
      '',
      '| 判断 | 结果 |',
      '| --- | --- |',
      '| 排名 | 产品 A 位列第一 |'
    ].join('\n')

    expect(uncitedReportSentences(unresolvedTable)).toEqual(expect.arrayContaining([
      '产品 A | 45%',
      '排名 | 产品 A 位列第一'
    ]))
    const sanitized = sanitizeUncitedDraftSentences(unresolvedTable)
    expect(sanitized).not.toContain('| 产品 A | 45% |')
    expect(sanitized).not.toContain('| 排名 | 产品 A 位列第一 |')
    expect(sanitized).toContain('| 产品 | 市场份额 |')
  })

  it('preserves a site allowlist when truncating a long search query', () => {
    const query = normalizeSearchQuery(`${'HTTP 缓存验证 '.repeat(30)} site:developer.mozilla.org`)

    expect(query.length).toBeLessThanOrEqual(160)
    expect(query).toMatch(/ site:developer\.mozilla\.org$/)
  })

  it('keeps provider-specific date metadata out of generic query strings', () => {
    const input = makeSearchInput()
    input.brief.userClarifications = ['时间范围为过去5年。']
    const range = defaultSearchTimeRange(input, '2026-07-11T00:00:00.000Z')
    input.brief.sourcePolicy = {
      allowedSourceTypes: ['web'],
      requireCitations: true,
      allowedDomains: ['developer.mozilla.org']
    }

    const query = normalizeSearchQuery('HTTP 缓存验证 site:developer.mozilla.org')
    const rangedQuery = applySearchTimeRange(query, range)

    expect(rangedQuery).toBe('HTTP 缓存验证 site:developer.mozilla.org')
    expect(rangedQuery).not.toContain('after:')
    expect(rangedQuery).not.toContain('before:')
  })

  it('prioritizes a hard named-item repair target over generic queries', () => {
    const input = makeSearchInput()
    input.task.id = 'gap_2_coverage_1'
    input.task.objective = '补足用户硬性范围项「Enterprise套餐」的直接证据：定价与权限'
    input.task.questionIds = ['q1']

    const queries = buildSearchQueries(input).slice(0, 3)

    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('Enterprise套餐')
    expect(queries[1]).toContain('Enterprise套餐')
    expect(queries.every((query) => !/table tennis|WTT|Olympics/iu.test(query))).toBe(true)
  })

  it('generates independent high-priority queries for grouped report sections', () => {
    const input = makeSearchInput()
    input.brief.topic = '企业协作软件采购分析'
    input.frame.coreQuestions = [
      { id: 'pricing', text: '在「定价」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'security', text: '在「安全合规」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['pricing', 'security']
    input.task.reportSectionIds = ['pricing', 'security']

    const queries = buildSearchQueries(input).slice(0, 3)

    expect(queries.some((query) => query.includes('定价'))).toBe(true)
    expect(queries.some((query) => query.includes('安全合规'))).toBe(true)
  })

  it('starts broad comparison research with concise generic queries instead of full framing prose', () => {
    const input = makeSearchInput()
    input.brief.topic = '对比中美奥运会擅长项目'
    input.brief.sourcePolicy.allowedDomains = undefined
    input.frame.alternativesToCompare = ['中国', '美国']
    input.frame.centralQuestion = '核心矛盾在于如何定义擅长项目，并综合历史成绩、项目覆盖广度与近期竞争变化形成最终判断？'
    input.frame.coreQuestions = [{
      id: 'q1',
      text: input.frame.centralQuestion,
      priority: 'high',
      required: true
    }]
    input.task.objective = input.frame.centralQuestion

    const queries = buildSearchQueries(input).slice(0, 3)

    expect(queries).toHaveLength(3)
    expect(queries.every((query) => query.includes('中美奥运会擅长项目'))).toBe(true)
    expect(queries.some((query) => query.includes('中国 美国'))).toBe(true)
    expect(queries.every((query) => !query.includes('核心矛盾在于如何定义'))).toBe(true)
  })

  it('stops only when evidence is unchanged and the next research task repeats', () => {
    const task = {
      id: 'gap_2_task_1', questionIds: ['q1'], objective: '补足核心问题证据',
      expectedEvidence: ['官方数据'], sourceTypes: ['web'], searchHints: ['主题 官方 数据'],
      maxSources: 2, priority: 'high', status: 'pending'
    }
    const verdict = (roundIndex: number, sourceCount: number) => ({
      id: `gap_${roundIndex}`, roundIndex, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [{
        questionId: 'q1', question: '核心问题', required: true, priority: 'high', covered: false,
        requiredSourceCount: 2, requiredStrongWebSourceCount: 1, sourceCount, strongWebSourceCount: 0,
        requiredClaimCount: 1, claimCount: sourceCount, criticalClaimCount: sourceCount, noteCount: sourceCount,
        missingEvidence: ['缺证据']
      }],
      coverageMatrix: {
        totalSourceCount: sourceCount, strongWebSourceCount: 0, requiredQuestionCount: 1,
        coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: false, comparisonTargets: []
      },
      missingEvidence: ['缺证据'], followUpTasks: [{ ...task, id: `gap_${roundIndex + 1}_task_1` }],
      createdAt: `2026-07-14T00:00:0${roundIndex}.000Z`
    }) as never
    const first = verdict(1, 0)

    expect(evaluateResearchProgress([first], verdict(2, 0)).stalled).toBe(true)
    expect(evaluateResearchProgress([first], verdict(2, 1)).stalled).toBe(false)
  })

  it('does not count extra weak sources after the unmet strong-source threshold as progress', () => {
    const task = {
      id: 'gap_2_task_1', questionIds: ['q1'], objective: '补足核心问题强证据',
      expectedEvidence: ['可回查的一手来源'], sourceTypes: ['web'], searchHints: ['主题 一手来源'],
      maxSources: 2, priority: 'high', status: 'pending'
    }
    const verdict = (roundIndex: number, sourceCount: number) => ({
      id: `gap_${roundIndex}`, roundIndex, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [{
        questionId: 'q1', question: '核心问题', required: true, priority: 'high', covered: false,
        requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount, strongWebSourceCount: 0,
        requiredClaimCount: 1, claimCount: sourceCount, criticalClaimCount: 1, noteCount: sourceCount,
        missingEvidence: ['仍缺强网页来源']
      }],
      coverageMatrix: {
        totalSourceCount: sourceCount, strongWebSourceCount: 0, requiredQuestionCount: 1,
        coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: true, comparisonTargets: []
      },
      missingEvidence: ['仍缺强网页来源'], followUpTasks: [{ ...task, id: `gap_${roundIndex + 1}_task_1` }],
      createdAt: `2026-07-15T00:00:0${roundIndex}.000Z`
    }) as never

    expect(evaluateResearchProgress([verdict(1, 1)], verdict(2, 3)).stalled).toBe(true)
  })

  it('does not count weak-source growth for an explicit requirement whose strong-source gate is still unmet', () => {
    const verdict = (roundIndex: number, sourceCount: number, claimCount: number) => ({
      id: `gap_${roundIndex}`, roundIndex, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [{
        questionId: 'q1', question: '范围项', required: true, priority: 'high', covered: true,
        requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount: 1, strongWebSourceCount: 1,
        requiredClaimCount: 1, claimCount: 1, criticalClaimCount: 1, noteCount: 1, missingEvidence: []
      }],
      coverageMatrix: {
        totalSourceCount: sourceCount, strongWebSourceCount: 1, requiredQuestionCount: 1,
        coveredRequiredQuestionCount: 1, disconfirmingEvidenceCovered: true, comparisonTargets: [],
        explicitRequirements: [{
          requirementId: 'coverage_named', label: '明确范围项', kind: 'named_item',
          sourceCount, claimCount, strongSourceCount: 0,
          requiredSourceCount: 1, requiredClaimCount: 1, requiredStrongSourceCount: 1,
          covered: false, onMissing: 'block'
        }]
      },
      missingEvidence: ['范围项仍缺强来源'],
      followUpTasks: [{
        id: `task_${roundIndex}`, questionIds: ['q1'], objective: '检索明确范围项原始材料',
        expectedEvidence: ['一手材料'], sourceTypes: ['web'], searchHints: ['明确范围项 原始材料'],
        maxSources: 1, priority: 'high', status: 'pending'
      }],
      createdAt: `2026-07-19T00:00:0${roundIndex}.000Z`
    }) as never

    expect(evaluateResearchProgress([verdict(1, 1, 1)], verdict(2, 4, 6)).stalled).toBe(true)
  })

  it('keeps researching through multiple empty transitions when the next tasks are materially different', () => {
    const verdict = (roundIndex: number, objective: string) => ({
      id: `gap_${roundIndex}`, roundIndex, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [{
        questionId: 'q1', question: '核心问题', required: true, priority: 'high', covered: false,
        requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount: 0, strongWebSourceCount: 0,
        requiredClaimCount: 1, claimCount: 0, criticalClaimCount: 0, noteCount: 0, missingEvidence: ['缺证据']
      }],
      coverageMatrix: {
        totalSourceCount: 0, strongWebSourceCount: 0, requiredQuestionCount: 1,
        coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: false, comparisonTargets: []
      },
      missingEvidence: ['缺证据'],
      followUpTasks: [{
        id: `task_${roundIndex}`, questionIds: ['q1'], objective, expectedEvidence: ['官方证据'],
        sourceTypes: ['web'], searchHints: [objective], maxSources: 1, priority: 'high', status: 'pending'
      }],
      createdAt: `2026-07-14T00:00:0${roundIndex}.000Z`
    }) as never
    const first = verdict(1, '检索官方定义')
    const second = verdict(2, '检索官方实现边界')
    const third = verdict(3, '检索官方反例')

    expect(evaluateResearchProgress([first, second], third).stalled).toBe(false)
    expect(evaluateResearchProgress([first, second, third], verdict(4, '检索官方反例')).stalled).toBe(true)
  })

  it('detects a two-step task cycle when no qualifying evidence changes', () => {
    const verdict = (roundIndex: number, objective: string) => ({
      id: `gap_${roundIndex}`, roundIndex, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [{
        questionId: 'q1', question: '核心问题', required: true, priority: 'high', covered: false,
        requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount: 2, strongWebSourceCount: 0,
        requiredClaimCount: 1, claimCount: 2, criticalClaimCount: 1, noteCount: 2, missingEvidence: ['缺强证据']
      }],
      coverageMatrix: {
        totalSourceCount: 2, strongWebSourceCount: 0, requiredQuestionCount: 1,
        coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: true, comparisonTargets: []
      },
      missingEvidence: ['缺强证据'],
      followUpTasks: [{
        id: `task_${roundIndex}`, questionIds: ['q1'], objective, expectedEvidence: ['一手材料'],
        sourceTypes: ['web'], searchHints: [objective], maxSources: 1, priority: 'high', status: 'pending'
      }],
      createdAt: `2026-07-19T00:00:0${roundIndex}.000Z`
    }) as never

    expect(evaluateResearchProgress([
      verdict(1, '检索发布方原始材料'),
      verdict(2, '检索独立统计材料')
    ], verdict(3, '检索发布方原始材料')).stalled).toBe(true)
  })

  it('removes a stagnant repeated subtask while keeping a genuinely new search task', () => {
    const task = (id: string, questionId: string, objective: string) => ({
      id, questionIds: [questionId], objective, expectedEvidence: ['一手材料'],
      sourceTypes: ['web'], searchHints: [objective], maxSources: 1, priority: 'high', status: 'pending'
    })
    const coverage = (questionId: string) => ({
      questionId, question: questionId, required: true, priority: 'high', covered: false,
      requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount: 1, strongWebSourceCount: 0,
      requiredClaimCount: 1, claimCount: 1, criticalClaimCount: 1, noteCount: 1, missingEvidence: ['缺强证据']
    })
    const first = {
      id: 'gap_1', roundIndex: 1, status: 'need_more', confidence: 'low', stopReason: '继续',
      coverageByQuestion: [coverage('q1'), coverage('q2')],
      coverageMatrix: { totalSourceCount: 2, strongWebSourceCount: 0, requiredQuestionCount: 2, coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: true, comparisonTargets: [] },
      missingEvidence: ['缺强证据'], followUpTasks: [task('task_1', 'q1', '检索 q1 原始材料')], createdAt: '2026-07-19T00:00:01.000Z'
    } as never
    const current = {
      ...first,
      id: 'gap_2', roundIndex: 2,
      coverageByQuestion: [coverage('q1'), {
        ...coverage('q2'), covered: true, strongWebSourceCount: 1, missingEvidence: []
      }],
      coverageMatrix: {
        totalSourceCount: 2, strongWebSourceCount: 1, requiredQuestionCount: 2,
        coveredRequiredQuestionCount: 1, disconfirmingEvidenceCovered: true, comparisonTargets: []
      },
      followUpTasks: [task('task_2', 'q1', '检索 q1 原始材料'), task('task_3', 'q2', '检索 q2 原始材料')],
      createdAt: '2026-07-19T00:00:02.000Z'
    } as never

    const guarded = applyResearchProgressGuard([first], current).verdict

    expect(guarded.status).toBe('need_more')
    expect(guarded.followUpTasks.map((candidate) => candidate.questionIds[0])).toEqual(['q2'])
    expect(guarded.exhaustedQuestionIds).toEqual(['q1'])
  })

  it('does not recreate a task whose question was already exhausted before recovery', () => {
    const coverage = {
      questionId: 'q1', question: '核心问题', required: true, priority: 'high', covered: false,
      requiredSourceCount: 1, requiredStrongWebSourceCount: 1, sourceCount: 1, strongWebSourceCount: 0,
      requiredClaimCount: 1, claimCount: 1, criticalClaimCount: 1, noteCount: 1, missingEvidence: ['缺强证据']
    }
    const matrix = {
      totalSourceCount: 1, strongWebSourceCount: 0, requiredQuestionCount: 1,
      coveredRequiredQuestionCount: 0, disconfirmingEvidenceCovered: true, comparisonTargets: []
    }
    const history = [{
      id: 'gap_stopped', roundIndex: 3, status: 'unanswerable', confidence: 'low', stopReason: '已穷尽',
      coverageByQuestion: [coverage], coverageMatrix: matrix, missingEvidence: ['缺强证据'],
      followUpTasks: [], exhaustedQuestionIds: ['q1'], createdAt: '2026-07-19T00:00:03.000Z'
    }] as never
    const current = {
      id: 'gap_recovered', roundIndex: 4, status: 'need_more', confidence: 'low', stopReason: '恢复后继续',
      coverageByQuestion: [coverage], coverageMatrix: matrix, missingEvidence: ['缺强证据'],
      followUpTasks: [{
        id: 'gap_4_q1', questionIds: ['q1'], objective: '再次检索 q1 原始材料',
        expectedEvidence: ['一手材料'], sourceTypes: ['web'], searchHints: ['q1 原始材料'],
        maxSources: 1, priority: 'high', status: 'pending'
      }], createdAt: '2026-07-19T00:00:04.000Z'
    } as never

    const guarded = applyResearchProgressGuard(history, current).verdict

    expect(guarded.status).toBe('unanswerable')
    expect(guarded.followUpTasks).toEqual([])
    expect(guarded.exhaustedQuestionIds).toEqual(['q1'])
  })

  it('prioritizes uncovered questions ahead of comparison repair duplicates', async () => {
    const input = makeSearchInput()
    const evaluator = new BasicCoverageEvaluator()
    const verdict = await evaluator.evaluate({
      runId: input.runId,
      brief: input.brief,
      frame: input.frame,
      plan: { id: 'plan_gap_priority', runId: input.runId, rationale: 'test', tasks: [], createdAt: input.brief.createdAt },
      coverageContract: {
        requirements: [{
          id: 'coverage_enterprise',
          kind: 'named_item',
          label: 'Enterprise套餐',
          aliases: ['Enterprise套餐', 'Enterprise plan'],
          required: true,
          questionIds: ['q1'],
          sectionIds: ['q1'],
          minClaims: 1,
          minIndependentSources: 1,
          minStrongSources: 1,
          onMissing: 'block'
        }],
        groups: [{ id: 'coverage_named', relation: 'all_of', requirementIds: ['coverage_enterprise'] }],
        createdAt: input.brief.createdAt
      },
      budget: resolveResearchBudget({ preset: 'standard', maxSubagents: 4, minSources: 4, targetSources: 8, maxSources: 12, maxResearchRounds: 2 }),
      roundIndex: 1,
      sources: [],
      evidenceSpans: [],
      claims: [],
      notes: [],
      nowIso: input.brief.createdAt
    })

    expect(verdict.followUpTasks[0]?.objective).toContain('Enterprise套餐')
    expect(verdict.followUpTasks.slice(1, 3).every((task) => task.objective.startsWith('补足缺口：'))).toBe(true)
    expect(verdict.followUpTasks.slice(0, 3).some((task) => task.objective.includes('对比对象'))).toBe(false)
  })

  it('rejects a source title repeated as evidence without body content', () => {
    const source = {
      id: 'source_title_only', sourceType: 'web' as const, title: 'Enterprise pricing and access overview',
      originalUrl: 'https://example.com/pricing', canonicalUrl: 'https://example.com/pricing',
      accessedAt: '2026-07-12T00:00:00.000Z', importedAt: '2026-07-12T00:00:00.000Z',
      reliability: 'high' as const, reliabilityReason: 'official', sourcePolicyTags: ['web_fetch'],
      fingerprint: 'fp_title_only', status: 'fetched' as const, kind: 'web_strong' as const
    }
    const span = {
      id: 'span_title_only', sourceId: source.id,
      text: 'Enterprise pricing and access overview',
      textHash: 'hash_title_only', location: { paragraphIndex: 1 },
      extractedAt: '2026-07-12T00:00:00.000Z', extractorRunId: 'rr_title_only'
    }

    expect(isEligibleStrongWebEvidence(source, span)).toBe(false)
  })

  it('does not turn dimensions or workflow phrases into comparison targets', () => {
    expect(extractComparisonTargets('比较浏览器缓存行为和适用场景的差异')).toEqual([])
    expect(extractComparisonTargets('先确定可比股票池和市值前5，再比较营收和利润')).toEqual([])
    expect(extractComparisonTargets('用 MDN 官方文档区分缓存策略元数据、实体标签和条件请求判断各自承担的职责')).toEqual([])
    expect(extractComparisonTargets('解释 freshness 与 validation 的区别')).toEqual([])
    expect(extractComparisonTargets('解释 freshness 与 validation 的区别，以及 no-cache 和 no-store 的边界')).toEqual([])
    expect(extractComparisonTargets('说明强验证器与弱验证器的区别、freshness 与 validation 的区别')).toEqual([])
    expect(extractComparisonTargets('解释这些机制在 API 响应缓存和静态资源缓存中的实践差异')).toEqual([])
    expect(extractComparisonTargets('判断 no-store 在 API 与静态资源场景下的适用性')).toEqual([])
    expect(extractComparisonTargets([
      '细分赛道：同时按游戏类型和变现模式分析，重点识别内购、广告、混合变现差异。',
      '竞争对手：全球大型公司、东南亚区域头部企业和本地开发商全部覆盖。'
    ].join('\n'))).toEqual([])
    expect(extractComparisonTargets('对比 Micron Crucial P3/P5 与 SanDisk Extreme 消费级 SSD')).toEqual([
      'Micron Crucial P3/P5',
      'SanDisk Extreme'
    ])
    expect(extractComparisonTargets('A股与美股哪个更适合长期配置')).toEqual(['A股', '美股'])
    expect(extractComparisonTargets('调查 A 股和美股的异同。')).toEqual(['A 股', '美股'])
    expect(isComparisonText('调查 A 股和美股的异同。')).toBe(true)
    expect(extractComparisonTargets('需要与日本、德国、韩国等主要对手及全球整体水平对比')).toEqual([
      '日本',
      '德国',
      '韩国'
    ])
    expect(extractComparisonTargets('与日本、德国、韩国及全球水平对比')).toEqual([
      '日本',
      '德国',
      '韩国'
    ])
    expect(extractComparisonTargets('比较对象：日本、德国、韩国及全球水平。')).toEqual([
      '日本',
      '德国',
      '韩国'
    ])
    expect(extractComparisonTargets('制造业竞争力分析：以2021年至今的产量、出口、研发和供应链为范围，分析中国的优势、风险与未来两年走势，并与日本、德国、韩国主要对手比较。')).toEqual([
      '日本',
      '德国',
      '韩国'
    ])
    expect(extractComparisonTargets([
      'ETag 条件请求何时返回 304，以及与 Cache-Control 协同的边界。',
      '仅限 MDN 官方资料，不涉及其他来源；不比较其他缓存机制。'
    ].join('\n'))).toEqual([])
  })

  it('matches comparison targets across harmless spacing differences', () => {
    expect(comparisonTargetMatchesText('A 股', '截至本期，A股上市公司数量继续增加。')).toBe(true)
    expect(comparisonTargetMatchesText('A 股', '本段只讨论美股市场。')).toBe(false)
    expect(projectComparisonEvidenceText(
      '美股：标准明确。侧重市场表现与合规性。港股：标准宽泛。规则执行较灵活。A 股：侧重财务类指标。主板包含多类强制退市标准。',
      ['A 股', '美股']
    )).toBe('美股：标准明确。 侧重市场表现与合规性。 A 股：侧重财务类指标。 主板包含多类强制退市标准。')
  })

  it('turns explicit relationship pairs and application scenarios into required report dimensions', () => {
    const topic = '仅基于 MDN 官方文档，解释 HTTP 缓存中强 ETag 与弱 ETag、freshness 与 validation、no-cache 与 no-store 的具体含义、相互关系，以及它们在 API 响应缓存和静态资源缓存中的实践差异。请产出完整中文报告。'
    const scope: ResearchScopeAssessment = {
      understood: true,
      coreQuestionsConfirmed: true,
      readyForBrief: true,
      assessmentSource: 'model',
      summary: '解释 HTTP 缓存概念及其应用差异。',
      mainContradiction: '新鲜度与验证之间的权衡。',
      assumptions: [],
      clarificationQuestions: [],
      confirmationChecklist: ['核心问题：这些缓存机制如何协同？'],
      createdAt: '2026-07-12T00:00:00.000Z'
    }

    const frame = buildResearchFrame({ topic, scope })
    const requiredQuestions = frame.coreQuestions.filter((question) => question.required).map((question) => question.text)

    expect(frame.alternativesToCompare).toBeUndefined()
    expect(frame.coreResearchThread).toContain('强 ETag 与弱 ETag')
    expect(frame.coreResearchThread).not.toContain('权衡')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('权衡')
    expect(requiredQuestions).toEqual(expect.arrayContaining([
      expect.stringContaining('强 ETag 与 弱 ETag'),
      expect.stringContaining('freshness 与 validation'),
      expect.stringContaining('no-cache 与 no-store'),
      expect.stringContaining('API 响应缓存'),
      expect.stringContaining('静态资源缓存')
    ]))

    const separatelyAnalyzed = buildResearchFrame({
      topic: '仅基于 MDN 官方文档，解释 HTTP 缓存中强 ETag 与弱 ETag、freshness 与 validation、no-cache 与 no-store 的具体含义及相互关联，并分别分析 API 响应缓存和静态资源缓存场景。输出中文完整报告。',
      scope
    })
    const separateRequiredQuestions = separatelyAnalyzed.coreQuestions
      .filter((question) => question.required)
      .map((question) => question.text)
    const separateDimensionQuestions = separateRequiredQuestions.filter((question) => question.startsWith('在「'))
    expect(separateDimensionQuestions.filter((question) => question.includes('API 响应缓存'))).toHaveLength(1)
    expect(separateDimensionQuestions.filter((question) => question.includes('静态资源缓存'))).toHaveLength(1)
    expect(separateDimensionQuestions.some((question) =>
      question.includes('API 响应缓存') && question.includes('静态资源缓存')
    )).toBe(false)
    expect(separateRequiredQuestions.some((question) => question.includes('新鲜度 与 验证之间的权衡'))).toBe(false)

    const comparedAndSeparatelyAnalyzed = buildResearchFrame({
      topic: '仅基于 MDN 和 RFC 官方资料，比较 HTTP 缓存中强 ETag 与弱 ETag、freshness 与 validation、no-cache 与 no-store 的具体含义和相互关系，并分别分析 API 响应缓存和静态资源缓存场景。输出中文完整报告。',
      scope
    })
    const comparedDimensions = comparedAndSeparatelyAnalyzed.coreQuestions
      .filter((question) => question.required && question.text.startsWith('在「'))
      .map((question) => question.text.match(/^在「(.+?)」维度/u)?.[1])
      .filter((value): value is string => Boolean(value))
    expect(comparedDimensions).toEqual([
      '强 ETag 与弱 ETag',
      'freshness 与 validation',
      'no-cache 与 no-store',
      'API 响应缓存场景',
      '静态资源缓存场景'
    ])
    expect(comparedDimensions).not.toContain('相互')
    expect(comparedDimensions.some((dimension) => dimension.includes('并分别分析'))).toBe(false)

    const modelInventedComparison = buildResearchFrame({
      topic: '解释 HTTP 缓存机制。',
      scope: {
        ...scope,
        mainContradiction: '判断 no-store 在 API 与静态资源场景下的适用性。'
      }
    })
    expect(modelInventedComparison.alternativesToCompare).toBeUndefined()
    expect(modelInventedComparison.coreResearchThread).not.toContain('适用性')
  })

  it('matches explicitly declared bilingual research terms', () => {
    expect(isResearchTextRelevant(
      '分析 revalidation cache reuse（重新验证与缓存复用）的关系',
      'Revalidation is required before cache reuse of a stale stored response.'
    )).toBe(true)
  })

  it('maps English evidence back to Chinese report dimensions', () => {
    const context = '分析重新验证（revalidation）、市场规模（market size）与技术策略（technical strategy）。'
    expect(isResearchEvidenceFocused(
      '在「重新验证」维度上，关键事实是什么？',
      'Revalidation checks whether a stored response can be reused.',
      context
    )).toBe(true)
    expect(isResearchEvidenceFocused(
      '在「市场规模」维度上，关键事实是什么？',
      'The market size forecast reports annual revenue growth.',
      context
    )).toBe(true)
    expect(isResearchEvidenceFocused(
      '在「技术策略」维度上，关键事实是什么？',
      'The technical strategy changes the validation process.',
      context
    )).toBe(true)
    expect(comparisonTargetAliases('National Research Network')).toContain('NRN')
    expect(comparisonTargetAliases('生命周期排放（life-cycle emissions）')).toContain('life-cycle emissions')
  })

  it('rejects country-related pages that do not mention the research topic', () => {
    const input = makeSearchInput()
    input.brief.topic = '中国 HTTP 缓存基础设施分析'
    input.frame.coreResearchThread = '分析中国网站的缓存验证实现与标准兼容性。'
    input.frame.centralQuestion = '中国网站的 HTTP 缓存验证实现是否符合标准？'
    input.task.objective = '分析中国网站的缓存验证实现。'

    expect(isRelevantSearchResult(input, {
      sourceId: 'off_topic_japan_talent',
      url: 'https://example.com/japan-talent-policy',
      title: '日本国家人才发展战略',
      snippet: '分析日本博士人才培养和国际人力资源政策。',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    })).toBe(false)
  })

  it('rejects unrelated foreign-language top results when no entity anchor is shared', () => {
    const input = makeSearchInput()
    input.brief.topic = '城市公共服务系统评估'
    input.frame.coreResearchThread = '评估城市公共服务系统的运行可靠性。'
    input.frame.centralQuestion = '城市公共服务系统是否可靠？'
    input.task.objective = '寻找系统可靠性的原始记录。'

    expect(isRelevantSearchResult(input, {
      sourceId: 'unrelated_foreign_top_result',
      url: 'https://example.com/unrelated-history/article',
      title: 'A history of peaceful resistance',
      snippet: 'An encyclopedia entry about a historical movement and its leaders.',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    })).toBe(false)
  })

  it('derives and enforces a strict domain allowlist only from domains written by the user', () => {
    const policy = deriveResearchSourcePolicy({
      allowedSourceTypes: ['web'],
      requireCitations: true
    }, '只使用 developer.mozilla.org 和 rfc-editor.org 的官方文档，不要博客。')

    expect(policy.allowedDomains).toEqual(expect.arrayContaining([
      'developer.mozilla.org',
      'rfc-editor.org'
    ]))
    expect(isResearchSourceUrlAllowed(policy, 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching')).toBe(true)
    expect(isResearchSourceUrlAllowed(policy, 'https://www.rfc-editor.org/rfc/rfc9111')).toBe(true)
    expect(isResearchSourceUrlAllowed(policy, 'https://blog.csdn.net/example')).toBe(false)
    expect(normalizeSourceUrl('https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching')).toBe(
      normalizeSourceUrl('https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching')
    )

    const basedOnPolicy = deriveResearchSourcePolicy({
      allowedSourceTypes: ['web'],
      requireCitations: true
    }, '仅基于 developer.mozilla.org 官方网页解释 HTTP 缓存。')
    expect(basedOnPolicy.allowedDomains).toEqual(['developer.mozilla.org'])
  })

  it('derives and enforces strict publisher names without a domain or topic lookup table', () => {
    const policy = deriveResearchSourcePolicy({
      allowedSourceTypes: ['web'],
      requireCitations: true
    }, '仅基于 MDN 和 RFC 官方资料，比较 HTTP 缓存验证机制。')

    expect(policy.allowedPublishers).toEqual(['MDN', 'RFC'])
    expect(isResearchSourceCandidateAllowed(policy, {
      url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag',
      title: 'ETag header - HTTP | MDN',
      publisher: 'developer.mozilla.org'
    })).toBe(true)
    expect(isResearchSourceCandidateAllowed(policy, {
      url: 'https://www.rfc-editor.org/rfc/rfc9111',
      title: 'RFC 9111: HTTP Caching',
      publisher: 'rfc-editor.org'
    })).toBe(true)
    expect(isResearchSourceCandidateAllowed(policy, {
      url: 'https://docs.rs/s3s/latest/s3s/dto/enum.ETag.html',
      title: 'ETag in s3s::dto - Rust',
      publisher: 'docs.rs'
    })).toBe(false)

    const input = makeSearchInput()
    input.brief.sourcePolicy = policy
    expect(isRelevantSearchResult(input, {
      sourceId: 'third_party_etag',
      url: 'https://docs.rs/s3s/latest/s3s/dto/enum.ETag.html',
      title: 'ETag in s3s::dto - Rust',
      snippet: 'Enum ETag Copy item path',
      retrievedAt: '2026-07-20T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    })).toBe(false)
  })

  it('does not search sibling pages when the user strictly limits research to a concrete URL', async () => {
    let searchCalls = 0
    const input = makeSearchInput()
    input.brief = {
      ...input.brief,
      topic: '仅基于 https://docs.example.com/reference/alpha 分析 alpha 与 beta 的区别。',
      sourcePolicy: {
        allowedSourceTypes: ['web'],
        allowedDomains: ['docs.example.com'],
        preferredDomains: ['docs.example.com'],
        requireCitations: true
      }
    }
    const provider: WebProvider = {
      id: 'strict-url-search',
      search: async () => {
        searchCalls += 1
        return [{
          sourceId: 'sibling',
          url: 'https://docs.example.com/reference/unrelated',
          title: 'Unrelated sibling page',
          snippet: 'Unrelated material.',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          provider: 'strict-url-search',
          rank: 1
        }]
      }
    }

    const seeds = await searchSeedSources(input, {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000
    })

    expect(searchCalls).toBe(0)
    expect(seeds.map((seed) => seed.url)).toEqual([
      'https://docs.example.com/reference/alpha'
    ])
    expect(seeds[0]?.tags).toContain('direct_user_url')
  })

  it('uses a feasible source minimum for one strict official domain even when maxSources is explicit', () => {
    const requested = resolveResearchBudget({ preset: 'standard', maxSources: 12 })
    const brief: ResearchBrief = {
      ...makeSearchInput().brief,
      outputFormat: 'Markdown 中文完整报告',
      sourcePolicy: {
        allowedSourceTypes: ['web'],
        allowedDomains: ['developer.mozilla.org'],
        requireCitations: true
      }
    }

    const adapted = adaptResearchBudgetToSourceBoundary(requested, brief, '仅基于 MDN 官方文档解释 HTTP 缓存。', { maxSources: 12 })
    const explicitlyStrict = adaptResearchBudgetToSourceBoundary(requested, brief, '仅基于 MDN 官方文档解释 HTTP 缓存。', { minSources: 8, maxSources: 12 })

    expect(adapted).toMatchObject({ minSources: 1, targetSources: 8, maxSources: 12 })
    expect(explicitlyStrict.minSources).toBe(1)
  })

  it('requires source policy confirmation before tagging a commercial host as official', () => {
    const input = makeSearchInput()
    input.brief = {
      ...input.brief,
      topic: '对比 Vendor Alpha 和 Vendor Beta 的产品能力。',
      userIntent: '只判断产品能力，不把名称相似的社区站当成官网。',
      sourcePolicy: {
        allowedSourceTypes: ['web'],
        preferredDomains: ['vendor-alpha.example', 'vendor-beta.example'],
        requireCitations: true
      }
    }

    const resultFor = (url: string) => ({
      sourceId: url,
      url,
      title: 'Product documentation',
      snippet: 'Vendor product documentation and pricing.',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    })

    expect(tagsForSearchResult(input, resultFor('https://vendor-alpha.community/guides'))).not.toContain('official')
    expect(tagsForSearchResult(input, resultFor('https://vendor-beta.directory/resources'))).not.toContain('official')
    expect(tagsForSearchResult(input, resultFor('https://vendor-alpha.example/pricing'))).toContain('official')
    expect(tagsForSearchResult(input, resultFor('https://vendor-beta.example/help'))).toContain('official')
    expect(tagsForSearchResult(input, resultFor('https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/example/full'))).not.toContain('academic')
  })

  it('ranks official sources ahead of social search results', () => {
    const input = makeSearchInput()
    const results = rankSearchResultsForResearch(input, [{
      sourceId: 'social',
      url: 'https://x.com/stats/status/1',
      title: 'Product pricing discussion',
      snippet: 'Community discussion about product pricing.',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test',
      rank: 1
    }, {
      sourceId: 'official',
      url: 'https://cursor.com/pricing',
      title: 'Cursor pricing',
      snippet: 'Official Cursor pricing and plan details.',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test',
      rank: 2
    }])

    expect(results.map((result) => result.sourceId)).toEqual(['official', 'social'])
  })

  it('ranks fetchable deep result pages ahead of dynamic official homepages', () => {
    const input = makeSearchInput()
    input.brief.sourcePolicy.preferredDomains = ['vendor.example']
    const resultFor = (sourceId: string, url: string, rank: number) => ({
      sourceId,
      url,
      title: 'Product documentation',
      snippet: 'Official product documentation and pricing details.',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank
    })
    const results = rankSearchResultsForResearch(input, [
      resultFor('vendor_home', 'https://vendor.example/', 1),
      resultFor('community_article', 'https://community.example/vendor-pricing-review', 2),
      resultFor('vendor_docs', 'https://vendor.example/docs/account/pricing', 6)
    ])

    expect(results.map((result) => result.sourceId)).toEqual([
      'vendor_docs',
      'community_article',
      'vendor_home'
    ])
  })

  it('keeps search-content fallback outside citation and strong-source identity', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-research-source-identity-'))
    try {
      const input = makeSearchInput()
      const repository = new ResearchRunRepository({ workspaceRoot })
      const layout = await repository.createRunLayout({
        runId: 'rr_source_identity',
        title: 'Source identity',
        createdAt: '2026-07-11T00:00:00.000Z'
      })
      const store = new EvidenceStore(repository, layout)
      const fetchedText = 'Official documentation contains directly fetched, verifiable evidence about the requested product behavior.'
      const strongSource = sourceRecordForFetched(input, {
        url: 'https://cursor.com/docs/cache',
        finalUrl: 'https://cursor.com/docs/cache',
        title: 'Cursor cache documentation',
        publisher: 'cursor.com',
        reliabilityReason: 'Directly fetched first-party documentation.',
        tags: ['official'],
        text: fetchedText,
        byteCount: fetchedText.length,
        fetchedAt: '2026-07-11T00:00:00.000Z'
      }, 0, '2026-07-11T00:00:00.000Z')
      const academicText = 'Peer-reviewed analysis describes measurable technical characteristics of distributed collaboration systems.'
      const academicSource = sourceRecordForFetched(input, {
        url: 'https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/example/full',
        finalUrl: 'https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/example/full',
        title: 'Technical characteristics of distributed collaboration systems',
        publisher: 'frontiersin.org',
        reliabilityReason: 'Directly fetched peer-reviewed research article.',
        tags: ['academic'],
        text: academicText,
        byteCount: academicText.length,
        fetchedAt: '2026-07-11T00:00:30.000Z'
      }, 2, '2026-07-11T00:00:30.000Z')
      expect(academicSource.kind).toBe('web_strong')
      expect(academicSource.reliability).toBe('high')
      const primaryPdfSource = sourceRecordForFetched(input, {
        url: 'https://reports.example.org/original-study.pdf',
        finalUrl: 'https://reports.example.org/original-study.pdf',
        title: 'Original study report',
        publisher: 'reports.example.org',
        reliabilityReason: 'Primary material query candidate fetched and validated against its PDF body.',
        tags: ['primary_material_candidate'],
        text: 'The original study report contains directly verifiable methods, measurements and results.',
        contentType: 'application/pdf',
        byteCount: 120,
        fetchedAt: '2026-07-11T00:00:40.000Z'
      }, 4, '2026-07-11T00:00:40.000Z')
      expect(primaryPdfSource).toMatchObject({ kind: 'web_weak', reliability: 'medium' })
      const unverifiedPublisherTags = tagsForSearchResult(input, {
        sourceId: 'commercial_report',
        url: 'https://commercial-research.example/annual-measurement-report',
        title: 'Annual Measurement Report',
        snippet: 'A commercial measurement report.',
        retrievedAt: '2026-07-11T00:00:45.000Z',
        provider: 'yahoo-html-search',
        rank: 1
      })
      expect(unverifiedPublisherTags).not.toContain('primary_research')
      const commercialSource = sourceRecordForFetched(input, {
        url: 'https://commercial-research.example/annual-measurement-report',
        finalUrl: 'https://commercial-research.example/annual-measurement-report',
        title: 'Annual Measurement Report',
        publisher: 'commercial-research.example',
        reliabilityReason: 'Directly fetched commercial research.',
        tags: unverifiedPublisherTags,
        text: 'The report measures annual demand, unit cost and adoption by region.',
        byteCount: 100,
        fetchedAt: '2026-07-11T00:00:45.000Z'
      }, 3, '2026-07-11T00:00:45.000Z')
      expect(commercialSource).toMatchObject({ kind: 'web_weak', reliability: 'medium' })
      const fallbackText = 'Search result summary repeats a claim about the same URL, but the target page could not be fetched and verified.'
      const fallbackSource = sourceRecordForFetched(input, {
        url: strongSource.canonicalUrl!,
        finalUrl: strongSource.canonicalUrl!,
        title: strongSource.title,
        publisher: 'test-search',
        reliabilityReason: 'Search provider summary only.',
        tags: ['official', 'search_content_fallback'],
        text: fallbackText,
        byteCount: fallbackText.length,
        fetchedAt: '2026-07-11T00:01:00.000Z'
      }, 1, '2026-07-11T00:01:00.000Z')
      const strongSpan = {
        id: 'span_direct_fetch',
        sourceId: strongSource.id,
        text: fetchedText,
        textHash: 'hash_direct_fetch',
        location: { url: strongSource.canonicalUrl, paragraphIndex: 1 },
        extractedAt: '2026-07-11T00:00:00.000Z',
        extractorRunId: input.runId
      }
      const fallbackSpan = {
        id: 'span_search_summary',
        sourceId: fallbackSource.id,
        text: fallbackText,
        textHash: 'hash_search_summary',
        location: { url: fallbackSource.canonicalUrl, paragraphIndex: 1 },
        extractedAt: '2026-07-11T00:01:00.000Z',
        extractorRunId: input.runId
      }
      const workerResult = (source: typeof strongSource, span: typeof strongSpan) => ({
        taskId: input.task.id,
        questionIds: input.task.questionIds,
        sources: [source],
        evidenceSpans: [span],
        claims: [],
        notes: [],
        unresolvedQuestions: [],
        conflicts: [],
        suggestedNextQueries: []
      })

      await store.recordWorkerResult(workerResult(strongSource, strongSpan))
      const canonicalFallback = store.canonicalizeWorkerResult(workerResult(fallbackSource, fallbackSpan))

      expect(canCiteSource(fallbackSource)).toBe(false)
      expect(isEligibleStrongWebEvidence(fallbackSource, fallbackSpan)).toBe(false)
      expect(canonicalFallback.sources.map((source) => source.id)).toEqual([fallbackSource.id])
      expect(canonicalFallback.evidenceSpans[0]?.sourceId).toBe(fallbackSource.id)

      await store.recordWorkerResult(workerResult(fallbackSource, fallbackSpan))
      expect(store.listSources().map((source) => source.id)).toEqual([strongSource.id, fallbackSource.id])
      expect(store.listEvidenceSpans().map((span) => span.sourceId)).toEqual([strongSource.id, fallbackSource.id])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('keeps HTML block boundaries when selecting a deterministic fallback excerpt', () => {
    const input = makeSearchInput()
    input.brief.topic = '东南亚移动游戏市场分析'
    input.frame.coreQuestions = [{ id: 'genres', text: '在「游戏类型」维度上，关键事实是什么？', priority: 'high', required: true }]
    input.task.questionIds = ['genres']
    input.task.objective = '研究东南亚移动游戏类型趋势'
    const excerpt = selectRelevantFallbackExcerpt({
      url: 'https://sensortower.com/example',
      finalUrl: 'https://sensortower.com/example',
      title: 'Southeast Asia mobile game genres',
      publisher: 'sensortower.com',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_research'],
      text: [
        'search menu arrow_back Home keyboard_arrow_right Highlights',
        'Between January and August 2024, simulation, arcade, puzzle, and lifestyle mobile games accounted for 67% of Southeast Asia downloads.',
        'Strategy and shooting game downloads grew faster during the measured period.'
      ].join('\n'),
      byteCount: 300,
      fetchedAt: '2026-07-11T00:00:00.000Z'
    }, input)

    expect(excerpt).not.toMatch(/search menu|arrow_back/iu)
    expect(excerpt).toContain('67%')
  })

  it('prioritizes previously unseen pages in later research rounds', () => {
    const source = (url: string) => ({
      url,
      finalUrl: url,
      title: url,
      publisher: 'developer.mozilla.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['official'],
      text: 'HTTP caching evidence text with enough detail for extraction.',
      byteCount: 80,
      fetchedAt: '2026-07-12T00:00:00.000Z'
    })
    const repeated = source('https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching')
    const novel = source('https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests')

    const prioritized = prioritizeNovelFetchedSources(
      [repeated, novel],
      ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching#freshness']
    )

    expect(prioritized.map((item) => item.finalUrl)).toEqual([novel.finalUrl, repeated.finalUrl])
  })

  it('keeps a repeated primary PDF ahead of novel secondary pages', () => {
    const source = (url: string, tags: string[], contentType?: string) => ({
      url,
      finalUrl: url,
      title: url,
      publisher: new URL(url).hostname,
      reliabilityReason: 'Direct fetch.',
      tags,
      text: 'Subject evidence with enough detail for extraction and verification.'.repeat(8),
      ...(contentType ? { contentType } : {}),
      byteCount: 800,
      fetchedAt: '2026-07-15T00:00:00.000Z'
    })
    const article = source('https://news.example.com/new-analysis', ['web_search'])
    const primaryPdf = source('https://filings.example.com/report.pdf', ['primary_material_candidate'], 'application/pdf')

    const prioritized = prioritizeNovelFetchedSources([article, primaryPdf], [primaryPdf.finalUrl])

    expect(prioritized.map((item) => item.finalUrl)).toEqual([primaryPdf.finalUrl, article.finalUrl])
  })

  it('prioritizes chapter-focused evidence over an unrelated primary PDF', () => {
    const source = (url: string, tags: string[], text: string, contentType?: string) => ({
      url,
      finalUrl: url,
      title: url,
      publisher: new URL(url).hostname,
      reliabilityReason: 'Direct fetch.',
      tags,
      text,
      ...(contentType ? { contentType } : {}),
      byteCount: Buffer.byteLength(text),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    })
    const focusedArticle = source(
      'https://analysis.example.com/business-model',
      ['web_search'],
      'The company business model combines licensed product design with online and offline sales channels.'.repeat(4)
    )
    const unrelatedPrimaryPdf = source(
      'https://filings.example.com/financial-table.pdf',
      ['primary_material_candidate'],
      'The filing lists total assets, liabilities, revenue and profit for the fiscal year.'.repeat(4),
      'application/pdf'
    )

    const prioritized = prioritizeNovelFetchedSources(
      [unrelatedPrimaryPdf, focusedArticle],
      undefined,
      [['business model', 'product design', 'sales channels']]
    )

    expect(prioritized.map((item) => item.finalUrl)).toEqual([
      focusedArticle.finalUrl,
      unrelatedPrimaryPdf.finalUrl
    ])
  })

  it('prioritizes a fetched model-discovered primary document over an unverified aggregator PDF', () => {
    const source = (url: string, tags: string[]) => ({
      url,
      finalUrl: url,
      title: url,
      publisher: new URL(url).hostname,
      reliabilityReason: 'Direct fetch.',
      tags,
      contentType: 'application/pdf',
      text: 'Verified subject evidence with enough detail for extraction and citation.'.repeat(8),
      byteCount: 800,
      fetchedAt: '2026-07-15T00:00:00.000Z'
    })
    const aggregator = source('https://aggregator.example.com/report.pdf', ['web_search', 'primary_material_candidate'])
    const modelPrimary = source('https://primary.example.org/report.pdf', ['web_search', 'deepseek-web-search', 'primary_material_candidate'])

    const prioritized = prioritizeNovelFetchedSources([aggregator, modelPrimary], undefined)

    expect(prioritized.map((item) => item.finalUrl)).toEqual([modelPrimary.finalUrl, aggregator.finalUrl])
  })

  it('removes residual HTML block tags before evidence is admitted', () => {
    expect(cleanExtractedWebText('</p> <p>公司计划增加现有业务并尝试新的业务模式。')).toBe(
      '公司计划增加现有业务并尝试新的业务模式。'
    )
  })

  it('deduplicates mirrored fetched pages and removes subjectless portal home pages', () => {
    const input = makeSearchInput()
    input.brief.topic = '分析一个示例主体的公开表现'
    input.budget = resolveResearchBudget({ preset: 'standard' })
    const source = (url: string, title: string, text: string) => ({
      url,
      finalUrl: url,
      title,
      publisher: new URL(url).hostname,
      reliabilityReason: 'Direct fetch.',
      tags: ['web_search'],
      text,
      byteCount: text.length,
      fetchedAt: '2026-07-15T00:00:00.000Z'
    })
    const official = source('https://example-subject.org/report.pdf', 'Example Subject annual report', 'Example Subject reports measured operating results and risks.'.repeat(8))
    const mirror = source('https://mirror.example/report.pdf', official.title, official.text)
    const portal = source('https://news.example/sc/mobile/default.aspx', 'Market News', 'Unrelated bank and market ticker headlines.'.repeat(10))

    const deduped = prioritizeNovelFetchedSources([official, mirror, portal], undefined)
    const filtered = filterFetchedSourcesForResearch(input, deduped, ['Example Subject'])

    expect(deduped).toHaveLength(2)
    expect(filtered.map((item) => item.finalUrl)).toEqual([official.finalUrl])
  })

  it('isolates a fetched redirect that leaves the user named publisher boundary', () => {
    const input = makeSearchInput()
    input.brief.topic = '仅基于 MDN 和 RFC 官方资料解释 HTTP 缓存。'
    input.brief.sourcePolicy = deriveResearchSourcePolicy(input.brief.sourcePolicy, input.brief.topic)
    const source = (url: string, title: string, publisher: string) => ({
      url,
      finalUrl: url,
      title,
      publisher,
      reliabilityReason: 'Fetched for publisher boundary verification.',
      tags: ['web_search'],
      text: 'ETag and Cache-Control validation evidence with enough detail for extraction.'.repeat(8),
      byteCount: 800,
      fetchedAt: '2026-07-20T00:00:00.000Z'
    })
    const official = source(
      'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag',
      'ETag header - HTTP | MDN',
      'developer.mozilla.org'
    )
    const redirectedThirdParty = source(
      'https://www.cache-control.com/strong-vs-weak-etags-explained/',
      'Strong vs weak ETags explained',
      'cache-control.com'
    )

    expect(filterFetchedSourcesForResearch(input, [official, redirectedThirdParty]))
      .toEqual([official])
  })

  it('keeps a query-owned source for a single comparison-target repair after chapter focus checks', () => {
    const input = makeSearchInput()
    input.brief.topic = '比较对象甲与对象乙的治理机制。'
    input.frame.alternativesToCompare = ['对象甲', '对象乙']
    input.task.comparisonTargets = ['对象乙']
    input.task.questionIds = ['q1']
    input.task.reportQuestionIds = ['q1']
    input.frame.coreQuestions = [{
      id: 'q1',
      text: '在「治理机制」维度上，对象乙的关键事实是什么？',
      priority: 'high',
      required: true
    }]
    const source = {
      url: 'https://authority.example/rules',
      finalUrl: 'https://authority.example/rules',
      title: '治理规则',
      publisher: 'authority.example',
      reliabilityReason: 'The targeted query assigned this source to the requested comparison object.',
      tags: ['web_search', 'comparison_target:对象乙', 'primary_material_candidate'],
      text: '本规则由发布机构维护，规定治理决策必须记录、公开并接受独立复核。'.repeat(8),
      contentType: 'text/html',
      byteCount: 800,
      fetchedAt: '2026-07-20T00:00:00.000Z'
    }

    expect(filterFetchedSourcesForResearch(input, [source], ['Object B'])).toEqual([source])
  })

  it('keeps relevant repeated seed pages after novel candidates', () => {
    const repeated = {
      url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control',
      title: 'Cache-Control',
      publisher: 'developer.mozilla.org',
      reliabilityReason: 'Direct official documentation.',
      tags: ['official']
    }
    const novel = {
      ...repeated,
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/Cache',
      title: 'Cache API'
    }

    expect(prioritizeNovelSeedSources([repeated, novel], [repeated.url]).map((item) => item.url)).toEqual([
      novel.url,
      repeated.url
    ])
  })

  it('reuses previously admitted research URLs as refetched seeds for later subagents', () => {
    const seeds = reusableExistingSourceSeeds([
      'https://primary.example.org/report.pdf#page=3',
      'https://primary.example.org/report.pdf',
      'https://secondary.example.org/data'
    ], 2)

    expect(seeds).toHaveLength(2)
    expect(seeds[0]?.url).toBe('https://primary.example.org/report.pdf#page=3')
    expect(seeds[0]?.tags).toContain('prior_research_source')
    expect(seeds[1]?.url).toBe('https://secondary.example.org/data')
  })

  it('keeps every explicit concept family as an extraction obligation', () => {
    const groups = primaryFocusGroups(
      '解释强弱信号、baseline 与 peak load、manual 与 automatic 的区别和关系'
    )
    expect(groups).toHaveLength(6)
    expect(groups.some((group) => group.includes('baseline'))).toBe(true)
    expect(groups.some((group) => group.includes('peak load'))).toBe(true)
    expect(groups.some((group) => group.includes('manual'))).toBe(true)
    expect(groups.some((group) => group.includes('automatic'))).toBe(true)
    const spacedStrongWeakGroups = primaryFocusGroups('在「高负载 与 低负载」维度上，关键事实是什么？')
    expect(spacedStrongWeakGroups).toHaveLength(2)
    expect(isResearchEvidenceFocused(
      '在「高负载 与 低负载」维度上，关键事实是什么？',
      '高负载阶段延迟增加，而低负载阶段延迟保持稳定。'
    )).toBe(true)
  })

  it('does not accept an authoritative but off-topic page as cache-validation evidence', () => {
    const input = makeSearchInput()
    expect(isRelevantSearchResult(input, {
      sourceId: 'off_topic_mdn',
      url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTML/Guides/Constraint_validation',
      title: '约束验证 - HTML | MDN',
      snippet: '客户端表单验证与服务端表单验证。',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank: 1
    })).toBe(false)
    expect(isRelevantSearchResult(input, {
      sourceId: 'off_topic_authentication',
      url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Authentication',
      title: 'HTTP 身份验证 - HTTP | MDN',
      snippet: 'HTTP 权限控制、认证质询和客户端凭据。',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank: 2
    })).toBe(false)
    expect(isRelevantSearchResult(input, {
      sourceId: 'cache_mdn',
      url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching',
      title: 'HTTP caching - HTTP | MDN',
      snippet: 'ETag, If-None-Match, Cache-Control freshness and cache validation.',
      retrievedAt: '2026-07-11T00:00:00.000Z',
      provider: 'test-search',
      rank: 2
    })).toBe(true)

    input.task.maxSources = 1
    expect(extractionCardLimit(input, 1)).toBe(3)
  })

  it('does not map a generic shared noun to a more specific user-declared dimension', () => {
    const input = makeSearchInput()
    input.task.questionIds = ['emissions']
    input.frame.coreResearchThread = '比较生命周期排放（life-cycle emissions）与采购成本。'
    input.frame.coreQuestions = [{
      id: 'emissions',
      text: '在「生命周期排放」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    }]
    const unrelatedText = 'The procurement process allocates resources across regional suppliers.'

    expect(questionIdsForEvidence(input, unrelatedText)).toEqual([])
    expect(isResearchEvidenceFocused(
      input.frame.coreQuestions[0]!.text,
      'Life-cycle emissions include production, operation and end-of-life stages.',
      input.frame.coreResearchThread
    )).toBe(true)
  })

  it('does not mistake a broad term occurrence for a specific compound dimension', () => {
    const input = makeSearchInput()
    input.task.questionIds = ['evaluation']
    input.task.objective = '评估 Atlas 模型的预测质量。'
    input.task.expectedEvidence = ['Atlas model evaluation results']
    input.task.searchHints = ['Atlas model evaluation reference set']
    input.brief.topic = 'Atlas 模型评估（model evaluation）'
    input.brief.userIntent = '评估 Atlas 模型的预测质量。'
    input.frame.coreResearchThread = '评估模型效果，模型评估对应 model evaluation。'
    input.frame.centralQuestion = 'Atlas 模型评估结果是否可靠？'
    input.frame.coreQuestions = [{
      id: 'evaluation',
      text: '在「模型评估」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    }]

    expect(questionIdsForEvidence(
      input,
      'The business model describes how the company creates and captures value.'
    )).toEqual([])
    expect(questionIdsForEvidence(
      input,
      'Model evaluation compares predictions against a held-out reference set.'
    )).toEqual(['evaluation'])
  })

  it('uses context anchors to disambiguate an otherwise broad dimension term', () => {
    const question = '在「validation（验证）」维度上，关键事实、作用机制、风险和适用边界是什么？'
    const context = '评估 Atlas 系统中的 validation（验证）流程。'

    expect(isResearchEvidenceFocused(
      question,
      'Form validation checks whether a required field is empty.',
      context
    )).toBe(false)
    expect(isResearchEvidenceFocused(
      question,
      'Atlas validation compares every generated record with the approved reference set.',
      context
    )).toBe(true)
  })

  it('normalizes Simplified and Traditional Chinese only in the matching layer', () => {
    expect(normalizeResearchChineseScript('業務模式、現金流與主要風險')).toBe('业务模式、现金流与主要风险')
    expect(isResearchEvidenceFocused(
      '在「业务模式」维度上，关键事实是什么？',
      '集团主要業務模式包括设计、销售及授权自有知识产权。'
    )).toBe(true)
    expect(isResearchEvidenceFocused(
      '在「现金流」维度上，关键事实是什么？',
      '年内經營活動現金流保持为正。'
    )).toBe(true)
    expect(sourceTextMatchesResearchSubject(
      '示例集团业务分析',
      '示例集團的主要業務、營運数据及风险披露。'
    )).toBe(true)
  })

  it('requires a topic anchor when an explicit dimension only matches ambiguous validation prose', () => {
    const question = '在「freshness 与 validation」维度上，关键事实、作用机制、风险和适用边界是什么？'
    const context = '解释 HTTP 缓存中的 ETag、Cache-Control、freshness 与 validation。'

    expect(isResearchEvidenceFocused(
      question,
      '表单数据校验 - Web development | MDN\nHTML5 provides a constraint validation API for form controls.',
      context
    )).toBe(false)
    expect(isResearchEvidenceFocused(
      question,
      'ETag validation allows a stale cache entry to be checked before reuse.',
      context
    )).toBe(true)
  })

  it('rejects isolated source-code comments as report evidence', () => {
    expect(isLowSignalWebText('// validation to guarantee a fresh response')).toBe(true)
    expect(isLowSignalWebText('Cache-Control: private,no-cache,no-store,max-age=0,must-revalidate')).toBe(true)
    expect(isLowSignalWebText('本报告不可向未获许可的接收人发放或分发，业务收入从 2019 年 2')).toBe(true)
    expect(isLowSignalWebText('业务收入从 2019 年 2')).toBe(true)
    expect(isLowSignalWebText('招股书显示，2017-2019年，泡泡玛特营收分别为1')).toBe(true)
    expect(isUsableEvidenceText('招股书显示，2017-2019年，泡泡玛特营收分别为1')).toBe(false)
    expect(isUsableEvidenceText('公司将调整供应链，并持续推进主题乐园（1 原标题：某公司最新进展')).toBe(false)
    expect(isUsableEvidenceText('公司负责人表示：“明年门店数量将从72家增加到100家')).toBe(false)
    expect(isUsableEvidenceText('公司负责人表示：“计划已经完成。”相关数据也已发布。')).toBe(true)
    expect(isUsableEvidenceText('国际财务报告准则第 18 号将取代国际会计准则第 1 号，引 ⼊ 新规定以 助实现财务表现可 ⽐ 性及透明度')).toBe(false)
    expect(isUsableEvidenceText('投资评级 买入 上次评级 [Table_Chart] 资料来源：研究中心 [Table_BaseData] 公司主要数据 收盘价 2 06')).toBe(false)
    expect(isUsableEvidenceText('老产品若缺乏持续运营会面临销售下滑；而新产品若短')).toBe(false)
    expect(isUsableEvidenceText('请务必阅读正文之后的免责声明及其项下所有内容。')).toBe(false)
    expect(isUsableEvidenceText('投资者应结合自己的投资目标和财务状况自行判断是否采用本报告内容并自行承担风险。')).toBe(false)
    expect(isUsableEvidenceText('相关信息并未经过本网站证实，不对您构成任何建议，据此操作，风险自担。')).toBe(false)
    expect(isUsableEvidenceText('截至2025年底样本总量达到123万。资讯平台甲 . 2026-01-07 5. 原始报告 . 发布机构乙 . 2026-01-06 6. 样本总量同比增长22.5% . 资讯平台丙 . 2026-01')).toBe(false)
    expect(isLowSignalWebText('本报告及任何资料、材料及内容并未有考虑到个别的投资者的特定投资目标、财务情况、风险承受能力或任何特别需要。')).toBe(true)
    expect(isUsableEvidenceText('本报告及任何资料、材料及内容并未有考虑到个别的投资者的特定投资目标、财务情况、风险承受能力或任何特别需要。')).toBe(false)
    expect(isLowSignalWebText('未来随着公司全球化布局加速，我们预计 25 - 27 年净利润分别为 12 0')).toBe(true)
    expect(isUsableEvidenceText('未来随着公司全球化布局加速，我们预计 25 - 27 年净利润分别为 12 0')).toBe(false)
    expect(isLowSignalWebText('Revenue 37,120,052 13,037,749 184.7%')).toBe(true)
    expect(isUsableEvidenceText('Revenue 37,120,052 13,037,749 184.7%')).toBe(false)
    expect(isUsableEvidenceText('For the year ended 31 December 2025 2024 Change RMB’000 RMB’000 (%) Revenue 37,120,052 13,037,749 184.7%')).toBe(true)
    expect(isLowSignalWebText('EXAMPLE SUBJECT OFFICIAL DOCUMENT Document Number: DOC-9992 Dated official publication HIGHLIGHTS F')).toBe(true)
    expect(isUsableEvidenceText('EXAMPLE SUBJECT OFFICIAL DOCUMENT Document Number: DOC-9992 Dated official publication HIGHLIGHTS F')).toBe(false)
    expect(isLowSignalWebText('Revenue reached 37,120,052 thousand yuan for the year ended 2025, an increase of 184.7%.')).toBe(false)
    expect(isUsableEvidenceText('截至年度的指标 单位：UNIT 13,037,749 6,301,002 106.9%')).toBe(true)
    expect(isUsableEvidenceText('公司报告期内收入为130.377亿元人民币，同比增长106.9%。')).toBe(true)
    expect(isUsableEvidenceText('运营的IP 93个IP，包括12个自有IP、25个独家IP及56个非独家IP 公司A 公司B 排名 复合年增长率 2017年至2019年 2019年竞争格局 8.5 226.3 资料来源 泡泡')).toBe(false)
    expect(isUsableEvidenceText('2025年，中国市场收入208.5亿元，同比增长134.6%；亚太市场收入80.1亿元，同比增长157.6%；美洲市场收入68.1亿元，同比增长748.4%。')).toBe(true)
    expect(isUsableEvidenceText('本集团全球化进程进一步提速，品牌知名度持续提升。我们推出多款新产品，进一步提升了旗下品牌在全球范围')).toBe(false)
    expect(isLowSignalWebText('该细分市场在统计期内继续增长并最终实现 2268')).toBe(true)
    expect(isLowSignalWebText('以下为渠道收入明细：2024 年收入占比 人民币千元 1,113,741 41')).toBe(true)
    expect(isLowSignalWebText('以下為渠道收入明細：2024 年收入佔比 人民幣千元 1,113,741 41')).toBe(true)
    expect(isUsableEvidenceText('以下為渠道收入明細：2024 年收入佔比 人民幣千元 1,113,741 41')).toBe(false)
    expect(isLowSignalWebText('收益 13,037,749 6,301,002 銷售成本 (4,329,984) (2,436,931) 其他收益 4')).toBe(true)
    expect(isUsableEvidenceText('收益 13,037,749 6,301,002 銷售成本 (4,329,984) (2,436,931) 其他收益 4')).toBe(false)
    expect(isLowSignalWebText('截至年度的指标 单位：UNIT 13,037,749 6,301,002 106.9%')).toBe(false)
    expect(isUsableEvidenceText('但是，也存在一些问题；但是，也存在一些问题；为了解决这些问题，ETag 响应标头被 化作为替代方案。')).toBe(false)
  })

  it('rejects numeric unit conversions and accepts exact source numbers', () => {
    const support = 'Overseas revenue reached 16.27 billion yuan.'

    expect(assessClaimFaithfulness('海外收入达到16.27 billion yuan。', [support]).faithful).toBe(true)
    expect(assessClaimFaithfulness('海外收入达到162.7亿元。', [support]).reasons)
      .toContain('unsupported_numbers:162.7')
  })

  it('rejects rounded conversions from structured table units', () => {
    const support = 'As at 31 December Note 2024 2023 RMB’000 RMB’000 Assets Non-current assets Property, plant and equipment 739,378 653,278 Intangible assets 135,400 115,888 Right-of-use assets 927,558 726,053'

    expect(assessClaimFaithfulness('截至2024年12月31日，设备记录为739,378。', [support]).faithful).toBe(true)
    expect(assessClaimFaithfulness('截至2024年12月31日，设备换算为7.39。', [support]).reasons)
      .toContain('unsupported_numbers:7.39')
  })

  it('preserves exact numbers next to abbreviated units', () => {
    const support = 'The range grew from CNY 368mn to CNY 3.0bn and then CNY 14.2bn.'

    expect(assessClaimFaithfulness('记录数字从368增至3.0，再增至14.2。', [support]).faithful).toBe(true)
    expect(assessClaimFaithfulness('该系列收入增至152亿元。', [support]).reasons)
      .toContain('unsupported_numbers:152')
  })

  it('treats an English indefinite time count as one in Chinese translation', () => {
    const support = 'The payout ratio fell to 25% from 35% a year earlier.'

    expect(assessClaimFaithfulness('股息支付率从一年前的35%降至25%。', [support]).faithful).toBe(true)
    expect(assessClaimFaithfulness('股息支付率从两年前的35%降至25%。', [support]).reasons)
      .toContain('unsupported_numbers:2')
  })

  it('rejects a writer-added subject for an anonymous entity profile', () => {
    const support = '一家总部位于香港的跨国生产公司，设计、开发及制造面向全球市场的精细收藏玩具。'

    expect(assessClaimFaithfulness(support, [support]).faithful).toBe(true)
    expect(assessClaimFaithfulness(`示例集团是${support}`, [support]).reasons)
      .toContain('anonymous_entity_subject_not_supported')
  })

  it('does not backfill an unrelated sentence merely because its source is already relevant', () => {
    const input = makeDimensionWorkerInput()
    input.frame.coreQuestions = [
      { id: 'q2', text: '在「业务模式」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['q2']
    input.task.reportQuestionIds = ['q2']
    const irrelevant = '国际财务报告准则的新订及修订条款已经颁布，但本报告期内尚未强制执行。'
    const text = irrelevant.repeat(4)
    const source = {
      url: 'https://primary.example.org/report.pdf',
      finalUrl: 'https://primary.example.org/report.pdf',
      title: '某消费公司业务模式年度报告',
      publisher: 'primary.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(text),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }

    expect(focusedExactSentences(source, input, true, [['销售渠道', '产品设计']])).toEqual([])
  })

  it('does not map accounting disclosure metadata or sibling dimensions into the active section', () => {
    const input = makeDimensionWorkerInput()
    input.frame.coreQuestions = [
      { id: 'finance', text: '在「财务健康」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'risk', text: '在「主要风险」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['finance']
    input.task.reportQuestionIds = ['finance']
    const accountingMetadata = 'IFRS 18 will replace IAS 1 Presentation of financial statements and introduce new disclosure requirements.'
    const accountingPolicyIndex = '编制本综合财务报表时所采纳的会计政策载列如下。'
    const officeAddress = '综合财务报表附注1一般资料显示公司办事处的地址为P。'
    const siblingRisk = 'IP 生命周期管理不及预期风险，海外市场拓展也存在文化差异风险。'

    expect(questionIdsForCard({ questionIds: ['finance'] }, input, accountingMetadata, [], [['financial performance']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, accountingPolicyIndex, [], [['会计政策']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, officeAddress, [], [['办事处地址']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, '采纳国际财务报告准则第18号对净利润并无影响，但新类别分类将影响经营溢利的计算及报告。', [], [['净利润']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, 'IFRS 18 will have no impact on the Group’s net profit, but grouping items of income and expenses will change.', [], [['net profit']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, 'Adjusted net profit refers to net profit after excluding share-based payment expenses.', [], [['net profit']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, '本公司根据开曼群岛公司法在开曼群岛注册成立为获豁免有限公司。', [], [['公司']], true)).toEqual([])
    expect(questionIdsForCard({ questionIds: ['finance'] }, input, siblingRisk, [], [['风险']], true)).toEqual([])
  })

  it('does not let a verified source title override a contradictory sentence subject', () => {
    const input = makeDimensionWorkerInput()
    input.brief.topic = '分析 Target Process 的未来趋势。'
    input.frame.coreQuestions = [
      { id: 'trend', text: '在「未来趋势」维度上，未来变化方向是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['trend']
    input.task.reportQuestionIds = ['trend']
    const unrelatedPrimarySubject = 'The following factors contribute to growth of the unrelated materials market: Target Process, urbanization, and new technology.'

    expect(questionIdsForCard(
      { questionIds: ['trend'] },
      input,
      unrelatedPrimarySubject,
      ['Target Process'],
      [['growth', 'future']],
      true
    )).toEqual([])
  })

  it('overfetches standard search candidates but keeps quick mode bounded', () => {
    const input = makeSearchInput()
    input.task.maxSources = 2
    expect(seedCandidateLimitForTask(input)).toBe(6)
    input.budget = resolveResearchBudget({ preset: 'quick', maxSources: 4 })
    expect(seedCandidateLimitForTask(input)).toBe(2)
  })

  it('rejects bibliography fragments while retaining concrete academic findings', () => {
    expect(isBibliographicMetadataOnlyText(
      '1186/s13102-025-01521-8 Stroke-level performance fluctuation analysis Wenxuan Yu 1 Zheng Zhou 1 Department of Sports Science Keywords: Performance fluctuation Introduction'
    )).toBe(true)
    expect(isBibliographicMetadataOnlyText(
      'Results: male players exhibited significantly higher fluctuations than female players, while top players were more consistent in serving and receiving.'
    )).toBe(false)
    expect(isSourceTitleOnlyText(
      'The performance optimization model of adjusting technical and tactical decisions',
      'The performance optimization model of adjusting technical and tactical decisions'
    )).toBe(true)
    expect(isSourceTitleOnlyText(
      '泡泡玛特交出2025成绩单，下一步跨界IP家电',
      '全年营收371.2亿！泡泡玛特交出2025成绩单，下一步跨界IP小家电_腾讯新闻'
    )).toBe(true)
    expect(isUsableEvidenceText('File metadata and controls')).toBe(false)
    expect(isUsableEvidenceText('平台声明：该文观点仅代表作者本人，平台仅提供信息存储空间服务。')).toBe(false)
    expect(isUsableEvidenceText('按三个样本分组统计，第一组和第二组均保持稳定，第三组的测量结果为18')).toBe(false)
    expect(isUsableEvidenceText('The initial standard requires unrestricted securities and adopts associated definit')).toBe(false)
    expect(isUsableEvidenceText('The initial standard requires unrestricted securities and adopts an associated definition.')).toBe(true)
    expect(isUsableEvidenceText('FY/aHn6PitfAO7oCwg9jqql8Xgpn83n2GH0Jeg3UwEJbn0v/OJTCDKh9rdqfDw1Obfr9yPhfPU4IXe2/S+gEVhOtuN2kV15+u+sNqmKwmFbo4QG7+LjwUC8lxYW/MWQwNUSkJEjdrdFic985TTsdDLjhA7o/PvuaT00aAsWCw4WFUNotpFBU/zvqTt8P6O29pCcXjoLDr0OvcEEGe1PKM')).toBe(false)
    expect(isUsableEvidenceText('If-Match, If-Modified-Since, If-Unmodified-Since conditional request headers')).toBe(false)
  })

  it('does not corrupt evidence words that contain former navigation labels', () => {
    expect(cleanExtractedWebText('该数据集记录逐小时温度，并说明标准化方法与搜索策略。')).toBe(
      '该数据集记录逐小时温度，并说明标准化方法与搜索策略。'
    )
  })

  it('deduplicates repeated semicolon list items in resolved report prose', () => {
    expect(finalizeResolvedReportProse('政策不确定性；地缘风险；地缘风险；流动性压力。[1]\n\n[1]: <https://example.com> "Source"'))
      .toContain('政策不确定性；地缘风险；流动性压力。[1]')
  })

  it('accepts focused task assignments and rejects explicit sibling assignments', () => {
    const input = makeDimensionWorkerInput()

    expect(questionIdsForCard({
      questionIds: ['q2'],
      claimText: 'W/ marks a weak ETag.'
    }, input, 'W/ 前缀显式标记弱 ETag，If-None-Match 使用弱比较。', [], [['弱 ETag']])).toEqual(['q2'])
    expect(questionIdsForCard({
      questionIds: ['q4'],
      claimText: 'no-store prevents storage.'
    }, input, 'Cache-Control: no-store 禁止缓存存储响应。')).toEqual([])
    expect(questionIdsForCard({
      questionIds: ['q2'],
      claimText: 'no-store prevents storage.'
    }, input, 'Cache-Control: no-store 禁止缓存存储响应。')).toEqual([])
    input.task.questionIds = ['q3']
    expect(questionIdsForCard({
      questionIds: ['q3'],
      claimText: '过期响应需要重新验证。'
    }, input, '缓存过期后通过条件请求重新验证，并可转换为新鲜响应。')).toEqual(['q3'])
    input.task.questionIds = ['q2']
    expect(questionIdsForEvidence(
      input,
      'Cache-Control: no-cache 允许存储，no-store 禁止存储。'
    )).toEqual([])
  })

  it('does not trust a sole section id when the excerpt misses that section focus', () => {
    const input = makeDimensionWorkerInput()
    input.frame.centralQuestion = '泡泡玛特的基本面如何？'
    input.frame.coreQuestions = [
      { id: 'q1', text: input.frame.centralQuestion, priority: 'high', required: true },
      { id: 'q_growth', text: '在「增长驱动」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['q_growth']
    input.task.reportQuestionIds = ['q_growth']

    expect(questionIdsForCard(
      { questionIds: ['q_growth'] },
      input,
      '本集团下一年度起属于 OECD 支柱二立法范本范围，当前年度并无相关税务风险。'
    )).toEqual([])
  })

  it('requires dynamic focus evidence before assigning metrics to an abstract report dimension', () => {
    const input = makeDimensionWorkerInput()
    input.brief.topic = '全面分析某消费公司的财务健康、业务模式和主要风险。'
    input.frame.coreQuestions = [
      { id: 'finance', text: '在「财务健康」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'business', text: '在「业务模式」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'risk', text: '在「主要风险」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['finance']
    input.task.reportQuestionIds = ['finance']
    const metric = 'Revenue increased by 184.7% from RMB13,037.7 million to RMB37,120.1 million in 2025.'

    expect(questionIdsForCard(
      { questionIds: ['finance'], claimType: 'metric' },
      input,
      metric,
      ['Example Consumer Group'],
      [],
      true
    )).toEqual([])
    expect(questionIdsForCard(
      { questionIds: ['finance'], claimType: 'metric' },
      input,
      metric,
      ['Example Consumer Group'],
      [['revenue', 'profit', 'assets', 'liabilities']],
      true
    )).toEqual(['finance'])
    input.task.questionIds = ['business']
    input.task.reportQuestionIds = ['business']
    expect(questionIdsForCard(
      { questionIds: ['business'], claimType: 'metric' },
      input,
      'The group reported a debt-to-assets ratio of 29.4% at year end.',
      ['Example Consumer Group'],
      [['product design', 'sales channel']],
      true
    )).toEqual([])
  })

  it('uses verified dynamic markers only for a single owned report question', () => {
    const input = makeDimensionWorkerInput()
    input.brief.topic = '比较两个市场的投资者结构与跨境准入。'
    input.frame.coreQuestions = [
      { id: 'investors', text: '在「投资者结构」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'access', text: '在「跨境准入」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['investors']
    input.task.reportQuestionIds = ['investors']
    const evidence = 'Institutional investors held 62 percent of the listed equity market at year end.'

    expect(questionIdsForCard(
      { questionIds: ['investors'], claimType: 'metric' },
      input,
      evidence,
      [],
      [['institutional investors'], ['foreign investor access']],
      true
    )).toEqual(['investors'])
    input.task.questionIds = ['investors', 'access']
    input.task.reportQuestionIds = ['investors', 'access']
    expect(questionIdsForCard(
      { questionIds: ['investors'], claimType: 'metric' },
      input,
      evidence,
      [],
      [['institutional investors'], ['foreign investor access']],
      true
    )).toEqual([])
  })

  it('preserves decimal metrics when deriving an exact evidence claim', () => {
    const input = makeDimensionWorkerInput()
    input.brief.topic = '全面分析某消费公司的财务健康。'
    input.frame.coreQuestions = [
      { id: 'finance', text: '在「Revenue」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['finance']
    input.task.reportQuestionIds = ['finance']
    const metric = 'Revenue increased by 184.7% from RMB13,037.7 million to RMB37,120.1 million in 2025.'
    const sourceText = `${metric} ${metric} ${metric}`
    const result = parseWebExtractionResult(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        questionIds: ['finance'],
        evidenceText: metric,
        claimType: 'metric',
        confidence: 'high',
        critical: true
      }]
    }), input, [{
      url: 'https://reports.example.org/results.pdf',
      finalUrl: 'https://reports.example.org/results.pdf',
      title: 'Example Consumer Group annual results',
      publisher: 'reports.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: sourceText,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }], '2026-07-15T00:00:00.000Z', ['Example Consumer Group'])

    expect(result.claims).toHaveLength(1)
    expect(result.claims[0]?.text).toBe(metric)
  })

  it('deterministically restores a complete period header and metric row when the model selects definitions instead', () => {
    const input = makeDimensionWorkerInput()
    input.brief.topic = '全面分析某消费公司的财务健康。'
    input.frame.coreQuestions = [
      { id: 'finance', text: '在「财务健康」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['finance']
    input.task.reportQuestionIds = ['finance']
    const metricTable = 'For the year ended 31 December 2025 2024 Change RMB’000 RMB’000 (%) Revenue 37,120,052 13,037,749 184.7%'
    const definition = 'Adjusted performance means a value after excluding a presentation item.'
    const text = `${metricTable} Gross profit 26,764,916 8,707,765 207.4% ${definition} `.repeat(3)
    const source = {
      url: 'https://reports.example.org/results.pdf',
      finalUrl: 'https://reports.example.org/results.pdf',
      title: 'Example Consumer Group annual results',
      publisher: 'reports.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(text),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }

    const sentences = focusedExactSentences(source, input, false, [['revenue', 'profit']])

    expect(sentences[0]).toBe(metricTable)
    expect(isUsableEvidenceText(sentences[0] ?? '')).toBe(true)
    expect(questionIdsForEvidence(input, sentences[0] ?? '', [['revenue', 'profit']])).toEqual(['finance'])
  })

  it('drops extraction cards assigned to a sibling section before they enter evidence storage', () => {
    const input = makeDimensionWorkerInput()
    const weakValidatorEvidence = 'If-None-Match 始终使用弱比较算法，W/ 前缀用于显式声明弱 ETag。'
    const noStoreEvidence = 'Cache-Control: no-store 指令禁止任何缓存存储响应内容。'
    const sourceText = [
      weakValidatorEvidence,
      noStoreEvidence,
      'If-None-Match 与 ETag 配合处理 HTTP 条件请求，并根据比较结果决定是否复用已有响应。'
    ].join(' ').repeat(3)
    const result = parseWebExtractionResult(JSON.stringify({
      evidenceCards: [
        {
          sourceIndex: 1,
          questionIds: ['q2'],
          evidenceText: weakValidatorEvidence,
          claimText: 'If-None-Match 始终使用弱比较，W/ 前缀显式声明弱 ETag。',
          claimType: 'fact',
          confidence: 'high',
          critical: true,
          entities: ['If-None-Match', 'ETag', 'W/', 'WTT'],
          noteSummary: '模型擅自声称中国队已经获得冠军。',
          implicationForBrief: '模型擅自给出没有原文支持的影响判断。'
        },
        {
          sourceIndex: 1,
          questionIds: ['q2'],
          evidenceText: noStoreEvidence,
          claimText: 'Cache-Control: no-store 禁止缓存存储响应。',
          claimType: 'fact',
          confidence: 'high',
          critical: true,
          entities: ['Cache-Control', 'no-store']
        }
      ]
    }), input, [{
      url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/If-None-Match',
      finalUrl: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/If-None-Match',
      title: 'If-None-Match - HTTP | MDN',
      publisher: 'MDN',
      reliabilityReason: 'MDN official documentation.',
      tags: ['official'],
      text: sourceText,
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-11T00:00:00.000Z'
    }], '2026-07-11T00:00:00.000Z', [], [['弱 ETag']])

    expect(result.claims.map((claim) => claim.text)).toEqual([
      'If-None-Match 始终使用弱比较算法，W/ 前缀用于显式声明弱 ETag。'
    ])
    expect(result.claims.every((claim) => /弱比较|弱 ETag/u.test(claim.text))).toBe(true)
    expect(result.notes).toHaveLength(1)
    expect(result.notes.every((note) => note.questionIds.length === 1 && note.questionIds[0] === 'q2')).toBe(true)
    expect(result.notes[0]?.summary).toBe(weakValidatorEvidence)
    expect(result.notes[0]?.implicationForBrief).not.toContain('模型擅自')
    expect(result.claims[0]?.entities).not.toContain('WTT')
  })

  it('grounds a Simplified extraction card against the same Traditional source sentence', () => {
    const input = makeDimensionWorkerInput()
    const traditional = '弱驗證器只要求資源在語義上等價，並不保證每個位元組都完全相同。'
    const simplified = '弱验证器只要求资源在语义上等价，并不保证每个位元组都完全相同。'
    const sourceText = `${traditional} ${traditional} ${traditional}`

    const result = parseWebExtractionResult(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 1,
        questionIds: ['q2'],
        evidenceText: simplified,
        claimType: 'fact',
        confidence: 'high',
        critical: true,
        entities: ['弱验证器']
      }]
    }), input, [{
      url: 'https://standards.example.org/validators.pdf',
      finalUrl: 'https://standards.example.org/validators.pdf',
      title: '驗證器標準',
      publisher: 'standards.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: sourceText,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }], '2026-07-15T00:00:00.000Z')

    expect(isExtractedEvidenceGroundedInSource(simplified, sourceText)).toBe(true)
    expect(result.claims).toHaveLength(1)
    expect(result.notes[0]?.questionIds).toEqual(['q2'])
  })

  it('uses independently planned source-language aliases for a multi-relevant section fact', () => {
    const input = makeDimensionWorkerInput()
    input.frame.coreQuestions = [
      { id: 'q2', text: '在「业务模式」维度上，关键事实是什么？', priority: 'high', required: true },
      { id: 'q3', text: '在「收益」维度上，关键事实是什么？', priority: 'high', required: true }
    ]
    input.task.questionIds = ['q2']
    input.task.reportQuestionIds = ['q2']
    const evidence = '本集团通过自主产品设计与线上线下销售渠道实现收益。'

    expect(questionIdsForCard({ questionIds: ['q2'] }, input, evidence, ['POP MART'])).toEqual([])
    expect(questionIdsForCard(
      { questionIds: ['q2'] },
      input,
      evidence,
      ['POP MART'],
      [['产品设计', '销售渠道']],
      true
    )).toEqual(['q2'])
  })

  it('keeps only dynamic focus aliases that actually occur in fetched source text', () => {
    const sourceText = '本集團主要從事潮流玩具的產品設計與開發，年度收益亦在本文件中披露。'.repeat(4)
    const groups = verifiedSourceFocusAliasGroups([
      ['业务模式', '产品设计'],
      ['收入', '收益'],
      ['不存在的宽泛词']
    ], [{
      url: 'https://primary.example.org/report.pdf',
      finalUrl: 'https://primary.example.org/report.pdf',
      title: '年度業績',
      publisher: 'primary.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: sourceText,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }])

    expect(groups).toEqual([
      expect.arrayContaining(['产品设计', '产品', '设计']),
      ['收益']
    ])
    expect(groups.flat()).not.toContain('不存在的宽泛词')
  })

  it('expands abstract compound aliases into source-verified observable atoms', () => {
    const sourceText = [
      '集团全年营收同比增长184.7%，核心经营指标创历史新高。',
      '公司计划继续扩张海外门店。'
    ].join(' ').repeat(4)
    const groups = verifiedSourceFocusAliasGroups([
      ['增长潜力', '收入增长率', '海外市场扩张'],
      ['竞争地位']
    ], [{
      url: 'https://primary.example.org/results',
      finalUrl: 'https://primary.example.org/results',
      title: '年度业绩公告',
      publisher: 'primary.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: sourceText,
      contentType: 'text/html',
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }])

    expect(groups).toEqual([expect.arrayContaining(['增长', '海外', '扩张'])])
    expect(groups.flat()).not.toContain('竞争')
  })

  it('selects card-bearing sources before filling unused source slots', () => {
    const input = makeDimensionWorkerInput()
    input.task.maxSources = 1
    const evidence = 'If-None-Match 始终使用弱比较算法，W/ 前缀用于显式声明弱 ETag。'
    const irrelevant = '该页面只介绍一般 HTTP 消息格式，不包含验证器比较语义。'.repeat(6)
    const relevant = `${evidence} ${evidence} ${evidence}`

    const result = parseWebExtractionResult(JSON.stringify({
      evidenceCards: [{
        sourceIndex: 2,
        questionIds: ['q2'],
        evidenceText: evidence,
        claimType: 'fact',
        confidence: 'high',
        critical: true
      }]
    }), input, [{
      url: 'https://example.org/http-overview',
      finalUrl: 'https://example.org/http-overview',
      title: 'HTTP overview',
      publisher: 'example.org',
      reliabilityReason: 'Direct fetch.',
      tags: [],
      text: irrelevant,
      byteCount: Buffer.byteLength(irrelevant),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }, {
      url: 'https://example.org/validators',
      finalUrl: 'https://example.org/validators',
      title: 'HTTP validators',
      publisher: 'example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: relevant,
      byteCount: Buffer.byteLength(relevant),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }], '2026-07-15T00:00:00.000Z', [], [['弱 ETag']])

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.canonicalUrl).toBe('https://example.org/validators')
    expect(result.claims.map((claim) => claim.text)).toEqual([evidence])
  })

  it('uses verified dynamic aliases to select later complete prose for the extraction prompt', () => {
    const input = makeSearchInput()
    const leadSummary = 'The report opens with a complete executive summary of the measured results and comparison baseline.'
    const targetSentence = '管理层说明，經營活動所得現金流量淨額在報告期內保持為正。'
    const sourceText = `${leadSummary} ${'其他章节的通用背景材料。'.repeat(900)} ${targetSentence} ${'附录材料。'.repeat(100)}`
    const prompt = buildWebExtractionPrompt(input, [{
      url: 'https://primary.example.org/report.pdf',
      finalUrl: 'https://primary.example.org/report.pdf',
      title: '年度报告',
      publisher: 'primary.example.org',
      reliabilityReason: 'Direct fetch.',
      tags: ['primary_material_candidate'],
      text: sourceText,
      contentType: 'application/pdf',
      byteCount: Buffer.byteLength(sourceText),
      fetchedAt: '2026-07-15T00:00:00.000Z'
    }], [], [['现金流量', '經營活動所得現金流量淨額']])

    expect(prompt).toContain(leadSummary)
    expect(prompt).toContain(targetSentence)
  })

  it('continues the provider cascade until enough filtered results survive', async () => {
    const attempts: WebSearchProviderAttempt[] = []
    const first: WebProvider = {
      id: 'first',
      search: async () => [{
        sourceId: 'bad',
        url: 'https://blog.example.com/cache',
        snippet: 'secondary commentary',
        retrievedAt: '2026-07-10T00:00:00.000Z',
        provider: 'first',
        rank: 1
      }]
    }
    const second: WebProvider = {
      id: 'second',
      search: async () => [{
        sourceId: 'good',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching',
        snippet: 'HTTP caching reference',
        retrievedAt: '2026-07-10T00:00:00.000Z',
        provider: 'second',
        rank: 1
      }]
    }
    const provider = new CascadingWebSearchProvider([first, second])
    const results = await provider.searchFiltered({
      query: 'HTTP caching',
      limit: 1,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      onProviderAttempt: (attempt) => attempts.push(attempt)
    }, (result) => result.url.startsWith('https://developer.mozilla.org/'))

    expect(results.map((result) => result.provider)).toEqual(['second'])
    expect(attempts).toEqual([
      { providerId: 'first', rawResultCount: 1, acceptedResultCount: 0 },
      { providerId: 'second', rawResultCount: 1, acceptedResultCount: 1 }
    ])
  })

  it('skips paid model search when the runtime reserves calls for synthesis', async () => {
    let fetchCalls = 0
    const provider = new DeepSeekWebSearchProvider({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetchImpl: (async () => {
        fetchCalls += 1
        return new Response('{}', { status: 200 })
      }) as typeof fetch
    })
    const results = await provider.search({
      query: 'HTTP cache validation MDN',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      modelExecution: {
        canReserve: () => false,
        reserve: () => ({ id: 'should_not_reserve' }),
        record: async () => undefined,
        finish: async () => undefined
      }
    })

    expect(results).toEqual([])
    expect(fetchCalls).toBe(0)
  })

  it('leaves enough response space for the final official-site recovery search', async () => {
    let requestBody: Record<string, unknown> | undefined
    const provider = new DeepSeekWebSearchProvider({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetchImpl: (async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: '[Official rule](https://official.example/rule)' }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch
    })

    await provider.search({
      query: 'Example rule official source',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(requestBody?.max_tokens).toBe(1_800)
    expect((requestBody?.tools as Array<Record<string, unknown>>)[0]?.max_uses).toBe(3)
    expect(JSON.stringify(requestBody)).toContain('官网 site: 查询')
  })

  it('clamps inconsistent provider cache usage to a valid hit rate', async () => {
    let recordedUsage: { cacheHitTokens?: number; cacheMissTokens?: number; cacheHitRate: number | null } | undefined
    const provider = new DeepSeekWebSearchProvider({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetchImpl: (async () => new Response(JSON.stringify({
        usage: {
          input_tokens: 149,
          output_tokens: 20,
          cache_read_input_tokens: 256
        },
        content: [{ type: 'text', text: '[MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)' }]
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
    })

    await provider.search({
      query: 'HTTP cache validation MDN',
      limit: 1,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      modelExecution: {
        canReserve: () => true,
        reserve: () => ({ id: 'reservation_cache_usage' }),
        record: async ({ usage }) => { recordedUsage = usage },
        finish: async () => undefined
      }
    })

    expect(recordedUsage).toMatchObject({
      cacheHitTokens: 149,
      cacheMissTokens: 0,
      cacheHitRate: 1
    })
  })

  it('reuses identical DeepSeek web searches without another model request', async () => {
    let fetchCalls = 0
    const provider = new DeepSeekWebSearchProvider({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetchImpl: (async () => {
        fetchCalls += 1
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: '[Primary report](https://example.com/report.pdf)' }]
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }) as typeof fetch
    })
    const request = {
      query: 'Example Subject annual report',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    }

    const first = await provider.search(request)
    const second = await provider.search({ ...request, signal: new AbortController().signal })

    expect(first).toHaveLength(1)
    expect(second.map((item) => item.url)).toEqual(first.map((item) => item.url))
    expect(fetchCalls).toBe(1)
  })

  it('authorizes one model search for every distinct preferred strategy query', async () => {
    const flags: Array<boolean | undefined> = []
    const provider: WebProvider = {
      id: 'capture-search',
      search: async (request) => {
        flags.push(request.allowFallbackOnly)
        return []
      }
    }

    await searchSeedSources(makeSearchInput(), {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: ['Example Subject 2024 annual report PDF', 'Example Subject 2024 revenue'],
      subjectAliases: ['Example Subject']
    })

    expect(flags.filter(Boolean)).toHaveLength(2)
    expect(flags[0]).toBe(true)
    expect(flags[1]).toBe(true)
  })

  it('preserves model-declared comparison ownership on accepted search seeds', async () => {
    const input = makeSearchInput()
    input.frame = { ...input.frame, alternativesToCompare: ['对象甲', '对象乙'] }
    const query = 'Example Subject side B current metric'
    const provider: WebProvider = {
      id: 'comparison-owner-search',
      search: async (request) => request.query === query ? [{
        sourceId: 'side-b-source',
        url: 'https://data.example.org/side-b',
        title: 'Example Subject side B current metric',
        snippet: 'Example Subject original current metric for side B.',
        retrievedAt: '2026-07-15T00:00:00.000Z',
        provider: 'comparison-owner-search',
        rank: 1
      }] : []
    }

    const seeds = await searchSeedSources(input, {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: [{ query, comparisonTarget: '对象乙' }],
      subjectAliases: ['Example Subject']
    })

    expect(seeds[0]?.tags).toContain('comparison_target:对象乙')
  })

  it('searches the inferred material type before the generic primary-source recovery query', async () => {
    const queries: string[] = []
    const provider: WebProvider = {
      id: 'capture-query-order',
      search: async (request) => {
        queries.push(request.query)
        return []
      }
    }

    await searchSeedSources(makeSearchInput(), {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: ['Example Subject 2024 annual report PDF', 'Example Subject 2024 revenue'],
      subjectAliases: ['Example Subject']
    })

    expect(queries.slice(0, 3)).toEqual([
      'Example Subject 2024 annual report PDF',
      'Example Subject 2024 revenue',
      'Example Subject latest official primary source PDF document'
    ])
    expect(queries[2]).toBeTruthy()
  })

  it('marks a direct document from the first model strategy query as a primary-material candidate', async () => {
    const input = makeSearchInput()
    input.brief = {
      ...input.brief,
      topic: 'Example Subject current assessment',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true }
    }
    const strategyQuery = 'Example Subject latest primary report'
    const provider: WebProvider = {
      id: 'strategy-document-search',
      search: async (request) => request.query === strategyQuery ? [{
        sourceId: 'strategy-primary-document',
        url: 'https://documents.example.org/example-subject-latest.pdf',
        title: 'Example Subject latest primary report',
        snippet: 'Original report for Example Subject.',
        retrievedAt: '2026-07-15T00:00:00.000Z',
        provider: 'strategy-document-search',
        rank: 1
      }] : []
    }

    const seeds = await searchSeedSources(input, {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: [strategyQuery],
      subjectAliases: ['Example Subject']
    })

    expect(seeds.find((seed) => seed.url.includes('example-subject-latest.pdf'))?.tags)
      .toContain('primary_material_candidate')
  })

  it('still authorizes later strategy searches after the broad query finds one primary document', async () => {
    const flags: Array<boolean | undefined> = []
    const provider: WebProvider = {
      id: 'capture-primary-search',
      search: async (request) => {
        flags.push(request.allowFallbackOnly)
        if (flags.length !== 1) return []
        return [{
          sourceId: 'primary-document',
          url: 'https://primary.example.org/report.pdf',
          title: 'Example Subject official annual report',
          snippet: 'Example Subject original report.',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          provider: 'capture-primary-search',
          rank: 1
        }]
      }
    }

    await searchSeedSources(makeSearchInput(), {
      provider,
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: ['Example Subject 2024 annual report PDF', 'Example Subject 2024 revenue'],
      subjectAliases: ['Example Subject']
    })

    expect(flags[0]).toBe(true)
    expect(flags[1]).toBe(true)
    expect(flags.slice(2).some(Boolean)).toBe(false)
  })

  it('does not let relevant news results block any preferred model search', async () => {
    let fallbackCalls = 0
    const free: WebProvider = {
      id: 'free-news-search',
      search: async () => [{
        sourceId: 'news-result',
        url: 'https://market.example/stocks/news/story-123',
        title: 'POP MART annual report highlights',
        snippet: 'A news summary about POP MART annual results.',
        retrievedAt: '2026-07-15T00:00:00.000Z',
        provider: 'free-news-search',
        rank: 1
      }]
    }
    const fallback: WebProvider = {
      id: 'model-primary-search',
      fallbackOnly: true,
      search: async () => {
        fallbackCalls += 1
        return [{
          sourceId: 'primary-result',
          url: 'https://documents.example.com/reports/pop-mart-2024.pdf',
          title: 'POP MART Official Document 2024',
          snippet: 'Official primary document.',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          provider: 'model-primary-search',
          rank: 1
        }]
      }
    }
    const input = makeSearchInput()
    input.brief.topic = '泡泡玛特2024年基本面'

    const seeds = await searchSeedSources(input, {
      provider: new CascadingWebSearchProvider([free, fallback]),
      nowIso: () => '2026-07-15T00:00:00.000Z',
      timeoutMs: 1_000,
      preferredQueries: ['POP MART 2024 annual report', 'POP MART 2024 revenue'],
      subjectAliases: ['POP MART']
    })

    expect(fallbackCalls).toBe(2)
    expect(seeds[0]?.url).toBe('https://documents.example.com/reports/pop-mart-2024.pdf')
  })

  it('does not call a paid fallback when a cheaper provider already returned usable results', async () => {
    let paidCalls = 0
    const free: WebProvider = {
      id: 'free',
      search: async () => [{
        sourceId: 'free_result',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching',
        snippet: 'HTTP caching reference',
        retrievedAt: '2026-07-10T00:00:00.000Z',
        provider: 'free',
        rank: 1
      }]
    }
    const paid: WebProvider = {
      id: 'paid',
      fallbackOnly: true,
      search: async () => {
        paidCalls += 1
        return []
      }
    }
    const results = await new CascadingWebSearchProvider([free, paid]).search({
      query: 'HTTP caching',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(results).toHaveLength(1)
    expect(paidCalls).toBe(0)
  })

  it('enriches an explicitly authorized primary query even when free search has a candidate', async () => {
    let fallbackCalls = 0
    const free: WebProvider = {
      id: 'free-primary',
      search: async () => [{
        sourceId: 'free-pdf',
        url: 'https://research.example.com/subject-report.pdf',
        snippet: 'Third-party subject report.',
        retrievedAt: '2026-07-15T00:00:00.000Z',
        provider: 'free-primary',
        rank: 1
      }]
    }
    const fallback: WebProvider = {
      id: 'model-primary',
      fallbackOnly: true,
      search: async () => {
        fallbackCalls += 1
        return [{
          sourceId: 'official-pdf',
          url: 'https://filings.example.com/subject-official.pdf',
          snippet: 'Official filing.',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          provider: 'model-primary',
          rank: 1
        }]
      }
    }

    const results = await new CascadingWebSearchProvider([free, fallback]).search({
      query: 'subject primary report',
      limit: 3,
      acceptedLimit: 3,
      allowFallbackOnly: true,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(fallbackCalls).toBe(1)
    expect(results.map((item) => item.provider)).toEqual(['free-primary', 'model-primary'])
  })

  it('reuses a completed cascade query across later subagents', async () => {
    let searchCalls = 0
    const provider: WebProvider = {
      id: 'counted-search',
      search: async () => {
        searchCalls += 1
        return [{
          sourceId: 'cached-result',
          url: 'https://example.com/reference',
          snippet: 'Reusable primary reference.',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          provider: 'counted-search',
          rank: 1
        }]
      }
    }
    const cascade = new CascadingWebSearchProvider([provider])
    const request = {
      query: 'shared subject primary source',
      limit: 3,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    }

    await cascade.search(request)
    await cascade.search({ ...request, signal: new AbortController().signal })

    expect(searchCalls).toBe(1)
  })

  it('does not call a fallback-only provider when the query disallows it', async () => {
    let fallbackCalls = 0
    const empty: WebProvider = { id: 'empty', search: async () => [] }
    const fallback: WebProvider = {
      id: 'model-search',
      fallbackOnly: true,
      search: async () => {
        fallbackCalls += 1
        return []
      }
    }

    await new CascadingWebSearchProvider([empty, fallback]).search({
      query: 'secondary facet query',
      limit: 3,
      allowFallbackOnly: false,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })

    expect(fallbackCalls).toBe(0)
  })

  it('does not treat report length or HTTP status numbers as a requested year', () => {
    const input = {
      runId: 'rr_time',
      task: {
        id: 'task_time',
        questionIds: ['q1'],
        objective: '解释 ETag 何时返回 304。',
        expectedEvidence: ['ETag 与 304 条件请求'],
        sourceTypes: ['web'],
        searchHints: ['HTTP ETag 304'],
        maxSources: 2,
        priority: 'high',
        status: 'pending'
      },
      brief: {
        id: 'brief_time',
        version: 1,
        topic: '解释 ETag 何时返回 304',
        userIntent: '生成不少于 2000 字的报告。',
        outputFormat: 'Markdown',
        sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true },
        successCriteria: ['回答核心问题。'],
        constraints: [],
        createdAt: '2026-07-10T00:00:00.000Z'
      },
      frame: testFrame(),
      budget: resolveResearchBudget({ preset: 'standard' })
    } satisfies Parameters<typeof defaultSearchTimeRange>[0]

    expect(defaultSearchTimeRange(input, '2026-07-10T00:00:00.000Z')).toBeUndefined()
  })

  it('blocks local network URLs and extracts article text without navigation chrome', async () => {
    await expect(assertPublicResearchUrl('http://127.0.0.1/private', false)).rejects.toThrow(/private_network/)
    await expect(assertPublicResearchUrl('http://[::1]/private', false)).rejects.toThrow(/private_network/)
    await expect(assertPublicResearchUrl('http://[::ffff:7f00:1]/private', false)).rejects.toThrow(/private_network/)
    await expect(assertPublicResearchUrl('http://[0:0:0:0:0:ffff:a9fe:a9fe]/metadata', false)).rejects.toThrow(/private_network/)
    await expect(assertPublicResearchUrl('http://198.18.0.17/private', false)).rejects.toThrow(/private_network/)
    await expect(assertPublicResearchUrl('http://user:secret@example.com/private', false)).rejects.toThrow(/unsafe_research_url/)
    await expect(assertPublicResearchUrl('https://example.com/research', false)).resolves.toBeUndefined()
    await expect(assertPublicResearchUrl('https://mixed.example/research', true, async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ])).rejects.toThrow(/private_network_dns_blocked/)
    await expect(assertPublicResearchUrl('https://public.example/research', true, async () => [
      { address: '93.184.216.34', family: 4 }
    ])).resolves.toBeUndefined()
    await expect(assertPublicResearchUrl('https://proxy-resolved.example/research', true, async () => [
      { address: '198.18.0.17', family: 4 }
    ])).resolves.toBeUndefined()
    await expect(assertPublicResearchUrl('https://mixed-private.example/research', true, async () => [
      { address: '198.18.0.17', family: 4 },
      { address: '192.168.1.10', family: 4 }
    ])).rejects.toThrow(/private_network_dns_blocked/)

    const extracted = extractReadableText([
      '<html><head><title>HTTP Cache</title></head><body>',
      '<nav>Login Navigation Pricing</nav>',
      '<main><article><h1>HTTP caching</h1><p>RFC 9111 defines cache behavior and validation semantics.</p></article></main>',
      '<footer>Copyright and newsletter signup</footer>',
      '</body></html>'
    ].join(''), 'text/html')
    expect(extracted.title).toBe('HTTP Cache')
    expect(extracted.text).toContain('RFC 9111 defines cache behavior')
    expect(extracted.text).not.toContain('Login Navigation')
    expect(extracted.text).not.toContain('newsletter signup')
  })

  it('revalidates every redirect hop before issuing the next request', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      requestedUrls.push(String(input))
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/internal-metadata' }
      })
    }) as typeof fetch

    await expect(fetchSeedSource({
      url: 'https://public.example/research',
      title: 'Public research',
      publisher: 'public.example',
      reliabilityReason: 'Redirect safety fixture.',
      tags: ['official']
    }, {
      fetchImpl,
      nowIso: () => '2026-07-12T00:00:00.000Z',
      timeoutMs: 1_000,
      maxBytes: 32_000,
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true }
    })).rejects.toThrow(/private_network/)

    expect(requestedUrls).toEqual(['https://public.example/research'])
  })

  it('bounds concurrent source fetches instead of starting every candidate at once', async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = (async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return new Response(`<main><article>${'Grounded research evidence with enough detail for citation. '.repeat(12)}</article></main>`, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    }) as typeof fetch
    const seeds = Array.from({ length: 6 }, (_, index) => ({
      url: `https://public-${index}.example/research`,
      title: `Research ${index}`,
      publisher: `public-${index}.example`,
      reliabilityReason: 'Concurrency fixture.',
      tags: ['web_search']
    }))

    const fetched = await fetchSeedSources(seeds, {
      fetchImpl,
      nowIso: () => '2026-07-16T00:00:00.000Z',
      timeoutMs: 1_000,
      maxBytes: 64_000,
      maxConcurrency: 2,
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true }
    })

    expect(fetched).toHaveLength(6)
    expect(maxActive).toBe(2)
  })

  it('selects later PDF pages that match the active research question', async () => {
    const pdf = makeTextPdf([
      'Annual report cover and table of contents.',
      'Corporate governance biographies and legal notices.',
      'Revenue and profit increased during the reporting year.',
      'Operating cash flow improved while inventory consumed working capital.'
    ])

    const extracted = await extractResearchPdfText(pdf, 500, 'cash flow inventory working capital')

    expect(extracted.text).toContain('Operating cash flow improved')
    expect(extracted.text).not.toContain('Revenue and profit increased')
  })

  it('uses an extended timeout after a response is identified as PDF', async () => {
    const pdf = makeTextPdf(Array.from(
      { length: 8 },
      (_, index) => `Page ${index + 1}: ${'Operating cash flow evidence with independently verifiable detail. '.repeat(3)}`
    ))
    const fetchImpl = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(pdf)
          controller.close()
        }, 25)
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/pdf' }
    })) as typeof fetch

    const fetched = await fetchSeedSource({
      url: 'https://public.example/report.pdf',
      title: 'Research report',
      publisher: 'public.example',
      reliabilityReason: 'PDF timeout fixture.',
      tags: ['web_search']
    }, {
      fetchImpl,
      nowIso: () => '2026-07-16T00:00:00.000Z',
      timeoutMs: 5,
      pdfTimeoutMs: 500,
      maxBytes: 64_000,
      focusText: 'operating cash flow',
      sourcePolicy: { allowedSourceTypes: ['web'], requireCitations: true }
    })

    expect(fetched.text).toContain('Operating cash flow evidence')
  })

  it('rejects evidence text that was attached to the wrong fetched source', () => {
    const source = 'Cursor official pricing includes plan tiers, usage limits, and feature access for individual developers. '.repeat(8)
    expect(isExtractedEvidenceGroundedInSource(
      'Cursor official pricing includes plan tiers, usage limits, and feature access for individual developers.',
      source
    )).toBe(true)
    expect(isExtractedEvidenceGroundedInSource(
      'Windsurf is now Devin Desktop and uses a different pricing structure.',
      source
    )).toBe(false)
    expect(isExtractedEvidenceGroundedInSource(
      'Cursor official pricing includes five plan tiers and 12 enterprise limits.',
      source
    )).toBe(false)
    const directiveSource = 'The no-cache response directive indicates that the response can be stored in caches, but it must be validated before reuse. '.repeat(4)
    expect(isExtractedEvidenceGroundedInSource(
      'The no-store response directive indicates that the response can be stored in caches, but it must be validated before reuse.',
      directiveSource
    )).toBe(false)
    const cachingSource = 'In HTTP/1.0, freshness used to be specified by the Expires header. Modern caches use Cache-Control.'
    expect(isExtractedEvidenceGroundedInSource(
      '0, freshness used to be specified by the Expires header',
      cachingSource
    )).toBe(false)
    expect(isExtractedEvidenceGroundedInSource(
      'freshness used to be specified by the Expires header',
      cachingSource
    )).toBe(true)
    expect(isUsableEvidenceText('values to check freshness against')).toBe(false)
    expect(isUsableEvidenceText('The response must be validated with the origin server before each reuse, even when the cache is')).toBe(false)
    expect(isUsableEvidenceText('Caches are encouraged to treat the value as if it were 0.')).toBe(false)
    expect(isUsableEvidenceText('The value of max-age determines how long the response remains fresh.')).toBe(true)
    expect(isUsableEvidenceText('In HTTP/1.0, freshness used Expires. ... Therefore max-age was adopted in HTTP/1.1.')).toBe(false)
    expect(isUsableEvidenceText('First source window [SOURCE_CHUNK_BOUNDARY] second source window')).toBe(false)
  })

  it('routes judge coverage omissions back to writing instead of spending another search round', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{ code: 'llm_judge_coverage_missing_section', message: '报告漏写一个已有证据的章节。', severity: 'blocking' }]
    } as never)).toBe('writing_fixable')
  })

  it('persists a Judge-rejected irrelevant claim outside its report section blueprint', () => {
    const blueprint: ResearchReportBlueprint = {
      reportType: 'market',
      title: '通用研究报告',
      directAnswer: '基于多个章节回答问题。',
      thesis: '证据支持有限结论。',
      createdAt: '2026-07-16T00:00:00.000Z',
      sections: [{
        id: 'risk',
        title: '主要风险',
        purpose: '分析主要风险。',
        questionIds: ['q1'],
        claimIds: ['relevant_1', 'irrelevant_1', 'relevant_2'],
        sourceIds: ['source_1', 'source_2', 'source_3'],
        argument: {
          conclusion: '相关证据支持有限的风险判断。',
          claimIds: ['relevant_1', 'irrelevant_1', 'relevant_2'],
          inference: '比较证据。',
          conditions: [],
          counterClaimIds: ['irrelevant_1']
        },
        limitations: []
      }]
    }
    const pruned = pruneJudgeRejectedBlueprintClaims(blueprint, {
      llmJudge: {
        issues: [{
          code: 'citation_unfaithful',
          category: 'citation',
          severity: 'blocking',
          message: '主要风险章节使用了与核心风险不直接相关的证据。',
          claimId: 'irrelevant_1'
        }]
      }
    } as never, [{ id: 'relevant_1', text: '第一条相关事实。' }, {
      id: 'irrelevant_1', text: '无关背景事实。'
    }, { id: 'relevant_2', text: '第二条相关事实。' }])

    expect(pruned).not.toBe(blueprint)
    expect(pruned.sections[0]?.claimIds).toEqual(['relevant_1', 'relevant_2'])
    expect(pruned.sections[0]?.excludedClaimIds).toEqual(['irrelevant_1'])
    expect(pruned.sections[0]?.argument.counterClaimIds).toEqual([])
  })

  it('routes repetition and missing synthesis to targeted writing repair', () => {
    expect(judgeFailureType({
      llmJudge: {
        failureKind: 'report_quality',
        issues: [{
          code: 'evidence_synthesis_missing', category: 'evidence', severity: 'blocking',
          message: '章节列出三条风险，但没有分析其影响。'
        }]
      },
      issues: [{
        code: 'llm_judge_writing_writing_repetition',
        message: '同一事实被重复表述。', severity: 'blocking'
      }, {
        code: 'llm_judge_evidence_evidence_synthesis_missing',
        message: '章节列出三条风险，但没有分析其影响。', severity: 'blocking'
      }]
    } as never)).toBe('writing_fixable')
  })

  it('prioritizes a structured evidence deficit over simultaneous writing defects', () => {
    expect(judgeFailureType({
      llmJudge: {
        failureKind: 'report_quality',
        issues: [{
          code: 'missing_evidence', category: 'evidence', severity: 'blocking',
          message: '变化章节未提供指定时期的可比数据，只引用了长期背景。'
        }, {
          code: 'writing_fragment', category: 'writing', severity: 'blocking',
          message: '报告存在碎片化陈述。'
        }]
      },
      issues: [{
        code: 'llm_judge_evidence_missing_evidence',
        message: '变化章节未提供指定时期的可比数据，只引用了长期背景。', severity: 'blocking'
      }, {
        code: 'llm_judge_writing_writing_fragment',
        message: '报告存在碎片化陈述。', severity: 'blocking'
      }]
    } as never)).toBe('evidence_blocking')

    expect(judgeFailureType({
      llmJudge: {
        failureKind: 'report_quality',
        issues: [{
          code: 'incomplete_synthesis', category: 'coverage', severity: 'blocking',
          message: '风险章节未覆盖用户要求的其他主要风险。'
        }, {
          code: 'writing_repetition', category: 'writing', severity: 'blocking',
          message: '章节存在重复。'
        }]
      },
      issues: [{
        code: 'llm_judge_coverage_incomplete_synthesis',
        message: '风险章节未覆盖用户要求的其他主要风险。', severity: 'blocking'
      }, {
        code: 'llm_judge_writing_writing_repetition',
        message: '章节存在重复。', severity: 'blocking'
      }]
    } as never)).toBe('missing_required_dimensions')

    expect(judgeFailureType({
      llmJudge: {
        failureKind: 'report_quality',
        issues: [{
          code: 'missing_period_data', category: 'scope', severity: 'blocking',
          message: '变化章节未提供指定时期的可比成本或能耗数据，仅引用长期背景。'
        }, {
          code: 'writing_score_below_threshold', category: 'writing', severity: 'blocking',
          message: '写作评分低于通过线。'
        }]
      },
      issues: [{
        code: 'llm_judge_scope_missing_period_data',
        message: '变化章节未提供指定时期的可比成本或能耗数据，仅引用长期背景。', severity: 'blocking'
      }, {
        code: 'llm_judge_writing_writing_score_below_threshold',
        message: '写作评分低于通过线。', severity: 'blocking'
      }]
    } as never)).toBe('missing_required_dimensions')
  })

  it('routes incomplete synthesis and unsupported expansion to writing repair', () => {
    for (const code of ['incomplete_synthesis', 'unsupported_technical_expansion', 'unsupported_tech_expansion']) {
      expect(judgeFailureType({
        llmJudge: { failureKind: 'report_quality' },
        issues: [{ code, category: 'evidence', severity: 'blocking', message: '删除无依据连接并重写综合句。' }]
      } as never)).toBe('writing_fixable')
    }
  })

  it('routes a sentence fragment to writing repair before a derivative coverage failure', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_writing_writing_fragment',
        message: '综合句被拆成三个段落，无法形成完整句子。',
        severity: 'blocking'
      }, {
        code: 'llm_judge_coverage_incomplete_section',
        message: '该章节因为综合句残缺而没有形成可用结论。',
        severity: 'blocking'
      }]
    } as never)).toBe('writing_fixable')
  })

  it('routes missing analysis and boundary wording to writing instead of evidence search', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_coverage_incomplete_section',
        message: '该章节仅罗列事实，缺乏综合推理和边界分析。',
        severity: 'blocking'
      }]
    } as never)).toBe('writing_fixable')
  })

  it('routes a concrete Judge evidence omission back to research even when the writable gate admitted the section', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_coverage_incomplete_section',
        message: '场景章节只有两条事实，缺少足以回答问题的证据。',
        severity: 'blocking'
      }]
    } as never)).toBe('missing_required_dimensions')
  })

  it('routes concrete missing chapter dimensions back to evidence repair when evidence use also fails', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_coverage_incomplete_chapter',
        message: '财务健康章节仅列出营收利润数据，未分析偿债能力、现金流、资产负债率等关键维度。',
        severity: 'blocking'
      }, {
        code: 'llm_judge_evidence_evidence_score_below_threshold',
        message: 'LLM Judge 证据使用评分 0.60 低于通过线 0.75。',
        severity: 'blocking'
      }]
    } as never)).toBe('missing_required_dimensions')
  })

  it('routes concrete incomplete-analysis and lack-of-synthesis gaps back to evidence repair', () => {
    for (const issue of [{
      code: 'llm_judge_coverage_incomplete_analysis',
      message: '关键维度仅讨论背景分类，未涉及用户要求的数据、作用机制和边界条件。'
    }, {
      code: 'llm_judge_coverage_lack_of_synthesis',
      message: '该章节未分析已要求的事实、形成过程或与对比对象的关键差异。'
    }]) {
      expect(judgeFailureType({
        llmJudge: { failureKind: 'report_quality' },
        issues: [
          { ...issue, severity: 'blocking' },
          { code: 'llm_judge_evidence_evidence_score_below_threshold', message: '证据使用评分不足。', severity: 'blocking' }
        ]
      } as never)).toBe('missing_required_dimensions')
    }
  })

  it('lets a concrete low-density section override a simultaneous citation repair', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_coverage_incomplete_section',
        message: '财务健康章节仅有一句事实陈述，缺乏深入分析。',
        severity: 'blocking'
      }, {
        code: 'llm_judge_citation_citation_unfaithful',
        message: '竞争地位章节存在不忠实推断。',
        severity: 'blocking'
      }, {
        code: 'llm_judge_evidence_evidence_score_below_threshold',
        message: '证据使用评分不足。',
        severity: 'blocking'
      }]
    } as never)).toBe('missing_required_dimensions')
  })

  it('routes a Judge evidence mismatch back to evidence repair', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_evidence_evidence_mismatch',
        message: '章节引用的文档地址信息与核心指标无关，证据不匹配。',
        severity: 'blocking'
      }]
    } as never)).toBe('evidence_blocking')
  })

  it('routes a blocked evidence score with a low-density warning back to evidence repair', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [{
        code: 'llm_judge_evidence_evidence_gap',
        message: '报告仅使用4个来源，未达到 deep 预设的充分证据覆盖。',
        severity: 'warning'
      }, {
        code: 'llm_judge_evidence_evidence_score_below_threshold',
        message: 'LLM Judge 证据使用评分低于通过线。',
        severity: 'blocking'
      }]
    } as never)).toBe('evidence_blocking')
  })

  it('does not treat generic judge scope scores as a corrupted ResearchFrame', () => {
    expect(judgeFailureType({
      llmJudge: { failureKind: 'report_quality' },
      issues: [
        { code: 'llm_judge_coverage_missing_section', message: '已有证据的章节被编辑器删空。', severity: 'blocking' },
        { code: 'llm_judge_scope_scope_score_below_threshold', message: '范围覆盖评分不足。', severity: 'blocking' },
        { code: 'llm_judge_evidence_evidence_score_below_threshold', message: '证据表达评分不足。', severity: 'blocking' }
      ]
    } as never)).toBe('writing_fixable')
  })

  it('routes uncited editor prose back to writing instead of spending another search round', () => {
    expect(judgeFailureType({
      issues: [{ code: 'uncited_factual_sentence', message: '编辑器增加了无引用事实。', severity: 'blocking' }]
    } as never)).toBe('writing_fixable')
  })

  it('keeps explicit evidence synthesis and limitations without treating them as new external facts', () => {
    const markdown = [
      '## 主要发现',
      '中国队在该维度保持领先。中国队赢得该项赛事。[claim:claim_1] 这些事实共同表明领先优势仍然存在。基于上述证据，本章结论只能覆盖已记录赛事。需注意现有证据仅覆盖团体赛。现有研究已经证明所有对手都无法挑战中国。',
      '## 结论',
      '综合来看，优势存在。[claim:claim_1]',
      '## 局限与不确定性',
      '当前证据范围有限。'
    ].join('\n')
    const repaired = sanitizeUncitedDraftSentences(markdown)
    expect(repaired).toContain('中国队在该维度保持领先。')
    expect(repaired).toContain('这些事实共同表明领先优势仍然存在。')
    expect(repaired).toContain('基于上述证据，本章结论只能覆盖已记录赛事。')
    expect(repaired).toContain('需注意现有证据仅覆盖团体赛。')
    expect(repaired).not.toContain('所有对手都无法挑战中国')
  })

  it('removes an uncited business mechanism invented by a findings synthesis', () => {
    const markdown = [
      '## 主要发现',
      '',
      '外部调查显示，受访者也会购买多个竞争品牌 [claim:claim_1]。',
      '这意味着该公司的策略并未形成直接对抗，而是通过独特的销售机制和社群文化，在细分市场开辟了增量空间。',
      '关键在于，当前证据只支持竞争并非完全零和，不能继续扩写具体增长机制。'
    ].join('\n')

    const repaired = sanitizeUncitedDraftSentences(markdown)

    expect(repaired).not.toContain('销售机制和社群文化')
    expect(repaired).toContain('竞争并非完全零和')
  })

  it('removes an uncited qualitative assessment not present in the cited fact', () => {
    const markdown = [
      '## 主要发现',
      '',
      '资产负债率从22%升至26.8% [claim:claim_1]。',
      '因此，公司保持低杠杆和高速增长。'
    ].join('\n')

    expect(sanitizeUncitedDraftSentences(markdown)).not.toContain('低杠杆和高速增长')
  })

  it('repairs an atomic web claim truncated after an English connector', () => {
    const normalizedText = 'A consumer survey found that buyers were gaining wallet share in a growing collectibles market rather than facing zero-sum competition. Notably, most respondents also bought other brands.'
    const repaired = repairDanglingAtomicClaimText({
      id: 'claim_dangling',
      text: 'A consumer survey found that buyers were gaining wallet share in a growing collectibles market rather than',
      normalizedText,
      entities: ['consumer survey'],
      claimType: 'inference',
      supportSpanIds: ['span_dangling'],
      confidence: 'medium',
      critical: true
    })

    expect(repaired.text).toBe('A consumer survey found that buyers were gaining wallet share in a growing collectibles market rather than facing zero-sum competition.')
    expect(repaired.text).not.toContain('Notably')
  })

  it('targets evidence repair at the section named by the blocking issue', () => {
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [
        { id: 'q1', text: '定义是什么？', priority: 'high', required: true },
        { id: 'q2', text: '机制是什么？', priority: 'high', required: true },
        { id: 'q3', text: '边界是什么？', priority: 'high', required: true },
        { id: 'q4', text: '失败条件是什么？', priority: 'high', required: true }
      ]
    }
    const run = {
      frame,
      brief: testBrief(),
      budget: resolveResearchBudget({ preset: 'standard', maxSubagents: 3, maxSources: 8 }),
      reportContract: {
        createdAt: '2026-07-10T00:00:00.000Z',
        requiredSections: frame.coreQuestions.map((question) => ({
          id: `section_${question.id}`,
          title: question.id === 'q4' ? '失败条件' : question.text,
          required: true,
          questionIds: [question.id],
          limitationFallback: '证据不足。'
        }))
      }
    } as unknown as ResearchRun
    const tasks = verificationEvidenceTasks({
      run,
      verdict: {
        blockingIssues: ['必填章节「失败条件」缺少可引用证据。'],
        issues: [{ code: 'required_section_evidence_missing', message: '必填章节「失败条件」缺少可引用证据。', severity: 'blocking' }]
      } as never,
      attempt: 1,
      roundIndex: 2,
      remainingSources: 3,
      sourceTypes: ['web']
    })

    expect(tasks.map((task) => task.questionIds)).toEqual([['q4']])
  })

  it('maps shortened Judge section names back to scoped report sections', () => {
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [
        { id: 'q_cost', text: '指定时期的成本如何变化？', priority: 'high', required: true },
        { id: 'q_risk', text: '主要风险是什么？', priority: 'high', required: true },
        { id: 'q_outlook', text: '未来趋势是什么？', priority: 'high', required: true }
      ]
    }
    const run = {
      frame,
      brief: testBrief(),
      budget: resolveResearchBudget({ preset: 'standard', maxSubagents: 3, maxSources: 8 }),
      reportContract: {
        createdAt: '2026-07-17T00:00:00.000Z',
        requiredSections: [{
          id: 'cost', title: '过去五年成本变化', required: true, questionIds: ['q_cost'], limitationFallback: '证据不足。'
        }, {
          id: 'risk', title: '主要环境风险', required: true, questionIds: ['q_risk'], limitationFallback: '证据不足。'
        }, {
          id: 'outlook', title: '未来五年趋势', required: true, questionIds: ['q_outlook'], limitationFallback: '证据不足。'
        }]
      }
    } as unknown as ResearchRun
    const verdict = {
      blockingIssues: [
        '成本变化章节未提供指定时期的可比数据。',
        '环境风险章节未覆盖主要影响。',
        '未来趋势章节缺少条件性预测证据。'
      ],
      issues: []
    } as never

    const tasks = verificationEvidenceTasks({
      run, verdict, attempt: 1, roundIndex: 2, remainingSources: 6, sourceTypes: ['web']
    })

    expect(tasks.map((task) => task.questionIds)).toEqual([['q_cost'], ['q_risk'], ['q_outlook']])
    expect(tasks[0]?.searchHints.join('\n')).toContain('可比数据')
    expect(tasks[1]?.searchHints.join('\n')).toContain('主要影响')
    expect(tasks[2]?.searchHints.join('\n')).toContain('条件性预测证据')
  })

  it('creates one isolated evidence repair task for every Judge-targeted section', () => {
    const dimensions = [
      { id: 'q_finance', title: '财务健康', question: '财务健康如何？', gap: '财务健康章节未分析现金流、资产负债结构或盈利质量，且缺乏从数据到结论的推理。' },
      { id: 'q_business', title: '业务模式', question: '业务模式如何？', gap: '业务模式章节未解释IP运营机制、渠道策略如何驱动收入。' },
      { id: 'q_growth', title: '增长潜力', question: '增长潜力如何？', gap: '增长潜力章节未量化海外业务等独立驱动因素的贡献。' },
      { id: 'q_competition', title: '竞争地位', question: '竞争地位如何？', gap: '竞争地位章节缺乏近年竞争格局变化和与对手的对比分析。' }
    ]
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: dimensions.map((dimension) => ({
        id: dimension.id,
        text: dimension.question,
        priority: 'high' as const,
        required: true
      }))
    }
    const run = {
      frame,
      brief: testBrief(),
      budget: resolveResearchBudget({ preset: 'deep', maxSubagents: 5, maxSources: 20 }),
      reportContract: {
        createdAt: '2026-07-16T00:00:00.000Z',
        requiredSections: dimensions.map((dimension) => ({
          id: dimension.id,
          title: dimension.title,
          required: true,
          questionIds: [dimension.id],
          limitationFallback: '证据不足。'
        }))
      }
    } as unknown as ResearchRun
    const verdict = {
      blockingIssues: dimensions.map((dimension) => dimension.gap),
      issues: [
        ...dimensions.map((dimension) => ({
          code: 'llm_judge_coverage_incomplete_chapter',
          message: dimension.gap,
          severity: 'blocking' as const
        })),
        {
          code: 'llm_judge_evidence_evidence_score_below_threshold',
          message: 'LLM Judge 证据使用评分低于通过线。',
          severity: 'blocking' as const
        }
      ]
    } as never

    const tasks = verificationEvidenceTasks({
      run,
      verdict,
      attempt: 2,
      roundIndex: 3,
      remainingSources: 12,
      sourceTypes: ['web']
    })

    expect(tasks).toHaveLength(4)
    tasks.forEach((task, index) => {
      expect(task.questionIds).toEqual([dimensions[index]!.id])
      expect(task.searchHints.join('\n')).toContain('需要补充可核验的直接证据')
      expect(task.searchHints.join('\n')).not.toContain('章节未')
      expect(task.searchHints.join('\n')).not.toContain('且缺乏')
      for (const other of dimensions.filter((_, otherIndex) => otherIndex !== index)) {
        expect(task.searchHints).not.toContain(other.gap)
      }
    })
  })

  it('keeps generic low-density repair searches free of writing-score feedback', () => {
    const frame: ResearchFrame = {
      ...testFrame(),
      coreQuestions: [
        { id: 'q_central', text: '总体判断是什么？', priority: 'high', required: true },
        { id: 'q_finance', text: '财务健康如何？', priority: 'high', required: true },
        { id: 'q_growth', text: '增长潜力如何？', priority: 'high', required: true }
      ]
    }
    const run = {
      frame,
      brief: testBrief(),
      budget: resolveResearchBudget({ preset: 'deep', maxSubagents: 5, maxSources: 20 }),
      reportContract: {
        createdAt: '2026-07-16T00:00:00.000Z',
        requiredSections: frame.coreQuestions.filter((question) => question.id !== 'q_central').map((question) => ({
          id: question.id,
          title: question.id === 'q_finance' ? '财务健康' : '增长潜力',
          required: true,
          questionIds: [question.id],
          limitationFallback: '证据不足。'
        }))
      },
      gapVerdicts: [{
        coverageByQuestion: [{ questionId: 'q_central', question: '总体判断是什么？', covered: false, reasons: ['缺少总论。'] }]
      }]
    } as unknown as ResearchRun
    const evidenceGap = '报告仅使用4个来源，未达到 deep 预设的充分证据覆盖。'
    const tasks = verificationEvidenceTasks({
      run,
      verdict: {
        blockingIssues: ['写作质量低于通过线。', '证据使用评分低于通过线。'],
        issues: [{ code: 'llm_judge_evidence_evidence_gap', message: evidenceGap, severity: 'warning' }]
      } as never,
      attempt: 2,
      roundIndex: 3,
      remainingSources: 8,
      sourceTypes: ['web']
    })

    expect(tasks).toHaveLength(2)
    expect(tasks.map((task) => task.questionIds)).toEqual([['q_finance'], ['q_growth']])
    for (const task of tasks) {
      expect(task.searchHints).toContain(evidenceGap)
      expect(task.searchHints).not.toContain('写作质量低于通过线。')
    }
  })

  it('keeps a high-value falsifier unresolved when only a sibling test has evidence', async () => {
    const analyzer = new BasicConvergenceAnalyzer()
    const verdict = await analyzer.analyze({
      runId: 'rr_test_level_convergence',
      brief: testBrief(),
      frame: testFrame(),
      budget: resolveResearchBudget({ preset: 'deep', maxResearchRounds: 3, maxSources: 8 }),
      roundIndex: 1,
      plan: {
        id: 'plan_test_level',
        runId: 'rr_test_level_convergence',
        rationale: 'test',
        createdAt: '2026-07-10T00:00:00.000Z',
        tasks: [
          { id: 'task_support', questionIds: ['central'], testIds: ['test_support'], objective: 'support', expectedEvidence: ['support'], sourceTypes: ['web'], searchHints: ['support'], maxSources: 1, priority: 'high', status: 'done' },
          { id: 'task_falsifier', questionIds: ['central'], testIds: ['test_falsifier'], objective: 'falsify', expectedEvidence: ['falsifier'], sourceTypes: ['web'], searchHints: ['falsifier'], maxSources: 1, priority: 'high', status: 'pending' }
        ]
      },
      hypotheses: [{
        id: 'h1', statement: '缓存验证依赖实体标签。', explains: ['central'], assumptions: [], predictions: [], falsifiers: ['没有实体标签也能完成同等验证。'], discriminatingQuestions: [], supportingClaims: [], opposingClaims: [], uncertainty: [], status: 'leading', confidence: 'medium'
      }],
      tests: ['test_support', 'test_falsifier'].map((id) => ({
        id,
        hypothesisId: 'h1',
        questionIds: ['central'],
        testQuestion: id,
        expectedEvidenceIfTrue: 'evidence',
        evidenceThatWouldWeakenIt: 'counter evidence',
        preferredSources: ['web'],
        priority: 'high',
        valueOfInformation: { uncertaintyImportance: 1, discriminativePower: 1, decisionImpact: 1, sourceFeasibility: 1, estimatedCost: 0.2, score: 0.9, decisionRelevanceQuestion: id }
      })),
      sources: [{}],
      evidenceSpans: [{ id: 'span_support', sourceId: 'source_support', text: 'support', textHash: 'support', location: {}, extractedAt: '2026-07-10T00:00:00.000Z', extractorRunId: 'rr_test_level_convergence' }],
      claims: [{ id: 'claim_support', text: 'support', entities: [], claimType: 'fact', supportSpanIds: ['span_support'], confidence: 'high', critical: true }],
      notes: [{ id: 'note_support', taskId: 'task_support', questionIds: ['central'], claimIds: ['claim_support'], summary: 'support', implicationForBrief: 'support', confidence: 'high', limitations: [] }],
      bindings: [{ id: 'binding_support', hypothesisId: 'h1', evidenceSpanId: 'span_support', claimId: 'claim_support', relation: 'supports', strength: 'strong', reason: 'support', createdAt: '2026-07-10T00:00:00.000Z' }],
      updates: [],
      gapVerdict: { status: 'sufficient' },
      nowIso: '2026-07-10T00:00:00.000Z'
    } as never)

    expect(verdict.unresolvedHighValueTestIds).toEqual(['test_falsifier'])
    expect(verdict.readyToWrite).toBe(false)
  })

  it('treats a completed targeted test with citable evidence as handled even when it does not bind to the hypothesis', async () => {
    const analyzer = new BasicConvergenceAnalyzer()
    const verdict = await analyzer.analyze({
      runId: 'rr_completed_test',
      brief: testBrief(),
      frame: testFrame(),
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 8 }),
      roundIndex: 1,
      plan: {
        id: 'plan_completed_test', runId: 'rr_completed_test', rationale: 'test', createdAt: '2026-07-10T00:00:00.000Z',
        tasks: [{ id: 'task_falsifier', questionIds: ['central'], testIds: ['test_falsifier'], objective: 'falsify', expectedEvidence: ['falsifier'], sourceTypes: ['web'], searchHints: ['falsifier'], maxSources: 1, priority: 'high', status: 'done' }]
      },
      hypotheses: [{
        id: 'h1', statement: '缓存验证依赖实体标签。', explains: ['central'], assumptions: [], predictions: [], falsifiers: [], discriminatingQuestions: [], supportingClaims: [], opposingClaims: [], uncertainty: [], status: 'leading', confidence: 'medium'
      }],
      tests: [{
        id: 'test_falsifier', hypothesisId: 'h1', questionIds: ['central'], testQuestion: 'falsifier', expectedEvidenceIfTrue: 'evidence', evidenceThatWouldWeakenIt: 'counter evidence', preferredSources: ['web'], priority: 'high',
        valueOfInformation: { uncertaintyImportance: 1, discriminativePower: 1, decisionImpact: 1, sourceFeasibility: 1, estimatedCost: 0.2, score: 0.9, decisionRelevanceQuestion: 'falsifier' }
      }],
      sources: [{}],
      evidenceSpans: [{ id: 'span_falsifier', sourceId: 'source_falsifier', text: 'falsifier result', textHash: 'falsifier', location: {}, extractedAt: '2026-07-10T00:00:00.000Z', extractorRunId: 'rr_completed_test' }],
      claims: [{ id: 'claim_falsifier', text: 'falsifier result', entities: [], claimType: 'fact', supportSpanIds: ['span_falsifier'], confidence: 'high', critical: true }],
      notes: [{ id: 'note_falsifier', taskId: 'task_falsifier', questionIds: ['central'], claimIds: ['claim_falsifier'], summary: 'falsifier result', implicationForBrief: 'test handled', confidence: 'high', limitations: [] }],
      bindings: [],
      updates: [],
      gapVerdict: { status: 'sufficient' },
      nowIso: '2026-07-10T00:00:00.000Z'
    } as never)

    expect(verdict.unresolvedHighValueTestIds).toEqual([])
    expect(verdict.readyToWrite).toBe(true)
  })

  it('runs one standard VOI follow-up per unresolved test and then recognizes an equivalent search dead end', () => {
    const run = {
      id: 'rr_voi',
      budget: resolveResearchBudget({ preset: 'standard', maxSources: 8, maxSubagents: 3 }),
      brief: testBrief(),
      frame: testFrame(),
      plan: { id: 'plan_voi', runId: 'rr_voi', rationale: 'test', tasks: [], createdAt: '2026-07-10T00:00:00.000Z' }
    } as unknown as ResearchRun
    const test = {
      id: 'test_voi', hypothesisId: 'h1', questionIds: ['central'], testQuestion: '寻找反证', expectedEvidenceIfTrue: '反证', evidenceThatWouldWeakenIt: '无反证', preferredSources: ['web'], priority: 'high',
      valueOfInformation: { uncertaintyImportance: 1, discriminativePower: 1, decisionImpact: 1, sourceFeasibility: 1, estimatedCost: 0.2, score: 0.9, decisionRelevanceQuestion: '寻找反证' }
    } as never
    const convergence = {
      wouldFurtherResearchChangeConclusion: true,
      unresolvedHighValueTestIds: ['test_voi']
    } as never

    expect(shouldRunDeepVoiFollowUp(run, convergence, 1, 1)).toBe(true)
    const first = tasksFromHighValueTests({ tests: [test], convergence, run, roundIndex: 1, remainingSources: 7 })
    expect(first).toHaveLength(1)
    run.plan!.tasks.push(...first)
    expect(tasksFromHighValueTests({ tests: [test], convergence, run, roundIndex: 2, remainingSources: 7 })).toEqual([])
  })

  it('serializes concurrent research run index writes without losing mappings', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-research-index-'))
    try {
      const index = new ResearchRunIndex(dataDir)
      await Promise.all(Array.from({ length: 40 }, (_, itemIndex) =>
        index.setAndWrite(`rr_${itemIndex}`, `/workspace/${itemIndex}`)
      ))
      const persisted = JSON.parse(await readFile(join(dataDir, 'research-run-index.json'), 'utf8')) as Record<string, string>
      expect(Object.keys(persisted)).toHaveLength(40)
      expect(persisted.rr_0).toBe('/workspace/0')
      expect(persisted.rr_39).toBe('/workspace/39')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('rechecks the writable gate when repair added evidence before another gap dead-ended', async () => {
    const base = makeSearchInput()
    const sources: Array<ReturnType<EvidenceStore['listSources']>[number]> = []
    const spans: Array<ReturnType<EvidenceStore['listEvidenceSpans']>[number]> = []
    const claims: Array<ReturnType<EvidenceStore['listClaims']>[number]> = []
    const notes: Array<ReturnType<EvidenceStore['listNotes']>[number]> = []
    const evidenceStore = {
      listSources: () => sources,
      listEvidenceSpans: () => spans,
      listClaims: () => claims,
      listNotes: () => notes
    } as unknown as EvidenceStore
    const run = {
      id: 'rr_repair_progress',
      brief: base.brief,
      frame: base.frame,
      budget: resolveResearchBudget({ preset: 'deep', maxSources: 100 }),
      gapVerdicts: []
    } as unknown as ResearchRun
    const plan = {
      id: 'plan_repair_progress',
      runId: run.id,
      rationale: 'Repair one blocking section before another gap dead-ends.',
      tasks: [],
      createdAt: '2026-07-15T00:00:00.000Z'
    }

    const progressed = await runVerificationEvidenceRepair({
      run,
      plan,
      evidenceStore,
      verdict: {
        pass: false,
        scores: {} as never,
        blockingIssues: [`必要问题没有被调研笔记覆盖：${run.frame.coreQuestions[0]!.text}`],
        warnings: [],
        recommendedFixes: [],
        issues: [{ code: 'required_question_uncovered', message: run.frame.coreQuestions[0]!.text, severity: 'blocking' }],
        verifiedAt: '2026-07-15T00:00:00.000Z'
      },
      attempt: 0,
      worker: { hasSearchCapability: () => true } as never,
      coverageEvaluator: {
        evaluate: async () => ({
          id: 'gap_after_partial_repair',
          roundIndex: 1,
          status: 'unanswerable',
          confidence: 'low',
          stopReason: '另一个研究问题的下一步任务与上一轮完全重复。',
          coverageByQuestion: [],
          coverageMatrix: {} as never,
          missingEvidence: ['另一个研究问题仍缺证据。'],
          followUpTasks: [],
          createdAt: '2026-07-15T00:00:00.000Z'
        })
      },
      nowIso: () => '2026-07-15T00:00:00.000Z',
      runTasks: async () => {
        sources.push({
          id: 'source_new',
          sourceType: 'web',
          title: 'ETag header - HTTP | MDN',
          path: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag',
          accessedAt: '2026-07-15T00:00:00.000Z',
          importedAt: '2026-07-15T00:00:00.000Z',
          reliability: 'high',
          reliabilityReason: 'Primary source used by the repair progress test.',
          sourcePolicyTags: ['web_fetch'],
          fingerprint: 'source-new',
          status: 'fetched',
          kind: 'web_strong'
        })
        spans.push({
          id: 'span_new',
          sourceId: 'source_new',
          text: 'ETag identifies a selected representation, and If-None-Match allows validation before a cached response is reused.',
          textHash: 'span-new',
          location: { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/ETag', paragraphIndex: 1 },
          extractedAt: '2026-07-15T00:00:00.000Z',
          extractorRunId: run.id
        })
        claims.push({
          id: 'claim_new',
          text: 'ETag identifies a selected representation, and If-None-Match allows validation before a cached response is reused.',
          entities: ['ETag', 'If-None-Match', 'validation'],
          claimType: 'fact',
          supportSpanIds: ['span_new'],
          confidence: 'high',
          critical: true
        })
        notes.push({
          id: 'note_new',
          taskId: 'repair_task',
          questionIds: [run.frame.coreQuestions[0]!.id],
          claimIds: ['claim_new'],
          summary: 'The repair added direct evidence.',
          implicationForBrief: 'The required question now has support.',
          confidence: 'high',
          limitations: []
        })
      },
      record: async () => undefined,
      writeRun: async () => undefined
    })

    expect(progressed).toEqual({ progress: true, exhaustedQuestionIds: [] })
  })

  it('keeps previously exhausted questions out of verification repair', () => {
    const run = {
      reportBlueprint: {
        sections: [{ id: 'gap', questionIds: ['q_blueprint'], evidenceMode: 'evidence_gap' }]
      },
      gapVerdicts: [{
        status: 'unanswerable',
        exhaustedQuestionIds: ['q_repeated'],
        coverageByQuestion: [{ questionId: 'q_missing', required: true, priority: 'high', covered: false }]
      }]
    } as unknown as ResearchRun

    expect([...exhaustedQuestionIdsForVerificationRepair(run)].sort()).toEqual([
      'q_blueprint',
      'q_missing',
      'q_repeated'
    ])
  })

  it('rehydrates persisted runs and evidence without appending duplicates', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-research-hardening-'))
    try {
      const repository = new ResearchRunRepository({ workspaceRoot })
      const runtime = new ResearchRuntime({
        repository,
        worker: new DefaultResearchTaskWorker(),
        idGenerator: () => 'rr_rehydrate',
        nowIso: () => '2026-07-10T00:00:00.000Z'
      })
      const run = await runtime.createRun({
        scope: testScope(),
        brief: testBrief(),
        frame: testFrame(),
        budget: { preset: 'quick', maxSources: 1 }
      })
      const store = new EvidenceStore(repository, run.artifacts)
      await store.recordWorkerResult({
        taskId: 'task_rehydrate',
        questionIds: ['central'],
        sources: [{
          id: 'source_rehydrate',
          sourceType: 'local_file',
          title: 'Persisted source',
          path: '/tmp/persisted-source.md',
          accessedAt: run.createdAt,
          importedAt: run.createdAt,
          reliability: 'high',
          sourcePolicyTags: ['user_provided'],
          fingerprint: 'source_rehydrate',
          status: 'fetched',
          kind: 'user_file'
        }],
        evidenceSpans: [{
          id: 'span_rehydrate',
          sourceId: 'source_rehydrate',
          text: 'Persisted evidence remains available after runtime restart.',
          textHash: 'span_rehydrate',
          location: { paragraphIndex: 1 },
          extractedAt: run.createdAt,
          extractorRunId: run.id
        }],
        claims: [{
          id: 'claim_rehydrate',
          text: 'Persisted evidence survives restart.',
          entities: ['DeepResearch'],
          claimType: 'fact',
          supportSpanIds: ['span_rehydrate'],
          confidence: 'high',
          critical: true
        }],
        notes: [{
          id: 'note_rehydrate',
          taskId: 'task_rehydrate',
          questionIds: ['central'],
          claimIds: ['claim_rehydrate'],
          summary: 'Evidence was persisted.',
          implicationForBrief: 'A resumed run can continue without repeating completed evidence work.',
          confidence: 'high',
          limitations: []
        }],
        unresolvedQuestions: [],
        conflicts: [],
        suggestedNextQueries: []
      })
      await repository.writeRun(run)

      const restoredRuntime = new ResearchRuntime({ repository, worker: new DefaultResearchTaskWorker() })
      const restoredRuns = await restoredRuntime.restorePersistedRuns()
      const restoredStore = new EvidenceStore(repository, run.artifacts)
      await restoredStore.hydrate()

      expect(restoredRuns.map((candidate) => candidate.id)).toContain(run.id)
      expect(restoredStore.listSources()).toHaveLength(1)
      expect(restoredStore.listEvidenceSpans()).toHaveLength(1)
      expect(restoredStore.listClaims()).toHaveLength(1)
      expect(restoredStore.listNotes()).toHaveLength(1)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('recovers the last terminal event instead of any historical success event', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-research-terminal-recovery-'))
    try {
      const repository = new ResearchRunRepository({ workspaceRoot })
      const runtime = new ResearchRuntime({
        repository,
        worker: new DefaultResearchTaskWorker(),
        idGenerator: () => 'rr_terminal_recovery',
        nowIso: () => '2026-07-10T00:00:00.000Z'
      })
      const run = await runtime.createRun({
        scope: testScope(),
        brief: testBrief(),
        frame: testFrame(),
        budget: { preset: 'quick', maxSources: 1 }
      })
      await repository.appendEvent(run.artifacts, {
        id: 'event_report_written',
        runId: run.id,
        type: 'REPORT_WRITTEN',
        timestamp: '2026-07-10T00:01:00.000Z',
        reportPath: run.artifacts.reportPath,
        artifactPaths: [run.artifacts.reportPath]
      })
      await repository.appendEvent(run.artifacts, {
        id: 'event_run_failed',
        runId: run.id,
        type: 'RUN_FAILED',
        timestamp: '2026-07-10T00:02:00.000Z',
        reason: 'post-write verification failed'
      })

      const restored = await repository.loadRuns()
      expect(restored.find((candidate) => candidate.id === run.id)?.status).toBe('failed')
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

function testScope(): ResearchScopeAssessment {
  return {
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    summary: 'Verify DeepResearch persistence.',
    mainContradiction: 'Avoid repeating completed research after restart.',
    assumptions: [],
    clarificationQuestions: [],
    confirmationChecklist: ['Persistence is required.'],
    createdAt: '2026-07-10T00:00:00.000Z'
  }
}

function testBrief(): ResearchBrief {
  return {
    id: 'brief_rehydrate',
    version: 1,
    topic: 'DeepResearch persistence',
    userIntent: 'Verify restart recovery.',
    outputFormat: 'Markdown',
    sourcePolicy: { allowedSourceTypes: ['local_file'], requireCitations: true },
    successCriteria: ['Evidence survives restart.'],
    constraints: [],
    createdAt: '2026-07-10T00:00:00.000Z'
  }
}

function testFrame(): ResearchFrame {
  return {
    coreResearchThread: 'Persist completed evidence and resume only unfinished work.',
    centralQuestion: 'Can DeepResearch recover after restart?',
    coreQuestions: [{ id: 'central', text: 'Can DeepResearch recover after restart?', priority: 'high', required: true }],
    investigationPath: ['persist', 'restart', 'hydrate'],
    evidenceNeeded: ['Persisted run and evidence ledgers.'],
    disconfirmingEvidenceNeeded: [],
    nonGoals: []
  }
}

function makeDimensionWorkerInput(): ResearchTaskWorkerInput {
  const input = makeSearchInput()
  input.frame.coreQuestions = [
    {
      id: 'q1',
      text: 'ETag、If-None-Match、Cache-Control、freshness 与 validation 如何协同？',
      priority: 'high',
      required: true
    },
    {
      id: 'q2',
      text: '在「强弱验证器」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    },
    {
      id: 'q3',
      text: '在「freshness 与 validation」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    },
    {
      id: 'q4',
      text: '在「no-cache 与 no-store」维度上，关键事实、作用机制、风险和适用边界是什么？',
      priority: 'high',
      required: true
    }
  ]
  input.frame.coreResearchThread = '解释 freshness（新鲜度）与 validation（验证），以及强弱验证器和 Cache-Control 指令。'
  input.task.questionIds = ['q2']
  input.task.objective = '负责报告章节「强弱验证器」并只收集该章节的独立证据。'
  return input
}

function makeSearchInput(): ResearchTaskWorkerInput {
  const frame: ResearchFrame = {
    coreResearchThread: '解释 Cache-Control 如何控制 freshness，以及 ETag 与 If-None-Match 如何完成缓存 validation。',
    centralQuestion: 'ETag、If-None-Match、Cache-Control、freshness 与 validation 如何协同？',
    coreQuestions: [{
      id: 'q1',
      text: 'ETag、If-None-Match、Cache-Control、freshness 与 validation 如何协同？',
      priority: 'high',
      required: true
    }],
    investigationPath: ['search'],
    evidenceNeeded: ['MDN HTTP cache documentation.'],
    disconfirmingEvidenceNeeded: [],
    nonGoals: []
  }
  return {
    runId: 'rr_search_relevance',
    task: {
      id: 'task_search_relevance',
      questionIds: ['q1'],
      objective: frame.centralQuestion,
      expectedEvidence: ['MDN HTTP cache documentation.'],
      sourceTypes: ['web'],
      searchHints: ['ETag If-None-Match Cache-Control freshness validation'],
      maxSources: 2,
      priority: 'high',
      status: 'pending'
    },
    brief: {
      id: 'brief_search_relevance',
      version: 1,
      topic: '仅基于 MDN 解释 HTTP 缓存验证。',
      userIntent: '解释 HTTP 缓存验证。',
      outputFormat: 'Markdown',
      sourcePolicy: {
        allowedSourceTypes: ['web'],
        allowedDomains: ['developer.mozilla.org'],
        requireCitations: true
      },
      successCriteria: ['准确解释缓存验证。'],
      constraints: [],
      createdAt: '2026-07-11T00:00:00.000Z'
    },
    frame,
    budget: resolveResearchBudget({ preset: 'standard', maxSources: 4 })
  }
}

function makeTextPdf(pageTexts: string[]): Uint8Array {
  const fontObjectId = 3 + pageTexts.length * 2
  const pageObjectIds = pageTexts.map((_, index) => 3 + index * 2)
  const objects = new Map<number, string>()
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>')
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`)
  pageTexts.forEach((text, index) => {
    const pageObjectId = pageObjectIds[index]!
    const contentObjectId = pageObjectId + 1
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`
    objects.set(pageObjectId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`)
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`)
  })
  objects.set(fontObjectId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let pdf = '%PDF-1.4\n'
  const offsets = new Array<number>(fontObjectId + 1).fill(0)
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    offsets[objectId] = Buffer.byteLength(pdf, 'utf8')
    pdf += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${fontObjectId + 1}\n0000000000 65535 f \n`
  for (let objectId = 1; objectId <= fontObjectId; objectId += 1) {
    pdf += `${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${fontObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'utf8'))
}
