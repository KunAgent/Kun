import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DeepResearchRuntimePanel,
  buildScopeAnswerMessage,
  buildSubmittableScopeAnswerMessage,
  type DeepResearchRuntimePanelState
} from './DeepResearchRuntimePanel'

describe('DeepResearchRuntimePanel', () => {
  it('renders scope confirmation before the brief', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('scoping'),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('需求理解')
    expect(html).toContain('主要矛盾')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('max-height:min(820px, calc(100vh - 9rem))')
    expect(html).not.toContain('运行状态')
    expect(html).not.toContain('确认项')
    expect(html).not.toContain('默认假设')
    expect(html).toContain('确认需求，生成简报')
    expect(html).not.toContain('补充说明，或直接写完整回答')
    expect(html).not.toContain('确认并开始')
  })

  it('renders interactive scope questions with multi-select options and direct text input', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('scoping', {
        readyForBrief: false,
        clarificationQuestions: [{
          id: 'scope_target',
          question: '您希望对比中美两国的哪个具体领域或维度？',
          why: '领域决定调研的数据来源、分析框架和结论方向。',
          options: ['经济与贸易', '科技与创新', '军事与国防', '教育体系'],
          required: true
        }],
        confirmationChecklist: ['需求理解：等待用户补充后再确认。']
      }),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('问题 1 · 必答')
    expect(html).toContain('第 1 步：补充信息')
    expect(html).toContain('选项可多选')
    expect(html).toContain('也可以不选选项，直接填写答案')
    expect(html).toContain('必答 0/1')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('data-selected="false"')
    expect(html).toContain('经济与贸易')
    expect(html).toContain('科技与创新')
    expect(html).toContain('也可以不选上面的选项，直接输入你的答案')
    expect(html).not.toContain('还有其他边界、用途、受众或限制')
    expect(html).toContain('提交补充给模型')
    expect(html).toContain('还剩 1 个必答问题未补充')
    expect(html).not.toContain('也可以先提交')
    expect(html).not.toContain('确认需求，生成简报')
  })

  it('combines selected required options and skips unanswered optional questions', () => {
    const message = buildScopeAnswerMessage({
      questions: [
        {
          id: 'scope_target',
          question: '您希望对比中美两国的哪个具体领域或维度？',
          why: '领域决定调研的数据来源、分析框架和结论方向。',
          options: ['经济与贸易', '科技与创新', '军事与国防', '教育体系'],
          required: true
        },
        {
          id: 'scope_extra',
          question: '是否还有额外边界？',
          why: '额外边界可以进一步收窄报告。',
          options: ['重点看最近三年', '不限时间'],
          required: false
        }
      ],
      selectedOptions: {
        scope_target: ['经济与贸易', '科技与创新']
      },
      customAnswers: {},
      note: '重点看最近三年。'
    })

    expect(message).toContain('回答：经济与贸易；科技与创新')
    expect(message).toContain('补充说明：重点看最近三年。')
    expect(message).not.toContain('是否还有额外边界')
  })

  it('does not submit until required questions are answered, but can skip optional-only questions', () => {
    const requiredQuestions = [{
      id: 'scope_target',
      question: '您希望对比中美两国的哪个具体领域或维度？',
      why: '领域决定调研的数据来源、分析框架和结论方向。',
      options: ['经济与贸易', '科技与创新'],
      required: true
    }]
    expect(buildSubmittableScopeAnswerMessage({
      questions: requiredQuestions,
      selectedOptions: {},
      customAnswers: {},
      note: ''
    })).toBe('')

    expect(buildSubmittableScopeAnswerMessage({
      questions: [{
        id: 'scope_optional',
        question: '是否还有可选补充？',
        why: '这只影响报告边界细化。',
        options: ['重点看最近三年', '不限时间'],
        required: false
      }],
      selectedOptions: {},
      customAnswers: {},
      note: ''
    })).toBe('未选择可选补充，使用默认边界继续。')
  })

  it('renders a free-form field when the scope question has no options', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('scoping', {
        readyForBrief: false,
        clarificationQuestions: [{
          id: 'scope_target',
          question: '请补充这次调研的具体边界。',
          why: '边界决定报告是否可执行。',
          options: [],
          required: true
        }],
        confirmationChecklist: ['需求理解：等待用户补充后再确认。']
      }),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('请补充这次调研的具体边界')
    expect(html).toContain('直接输入你的答案')
    expect(html).toContain('提交补充给模型')
  })

  it('renders the brief confirmation fields and actions', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('awaiting_brief_confirm'),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('深度研究')
    expect(html).toContain('runtime integration')
    expect(html).toContain('确认研究计划')
    expect(html).toContain('研究主题')
    expect(html).toContain('交付标准')
    expect(html).not.toContain('用户意图')
    expect(html).not.toContain('核心调研主线')
    expect(html).not.toContain('中心问题')
    expect(html).not.toContain('核心问题')
    expect(html).not.toContain('调研路径')
    expect(html).not.toContain('约束')
    expect(html).toContain('状态：等待确认简报')
    expect(html).toContain('确认并开始')
    expect(html).toContain('取消')
  })

  it('renders failed verification details instead of a generic error only', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('failed'),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('状态：失败')
    expect(html).toContain('报告质量还没达标')
    expect(html).toContain('模型端点不可用')
    expect(html).toContain('建议：补齐核心问题后重新生成。')
    expect(html).toContain('打开当前草稿')
    expect(html).toContain('aria-label="关闭深度研究"')
    expect(html).not.toContain('目标任务')
    expect(html).not.toContain('max-h-[17.75rem]')
  })

  it('renders report and artifact paths when done', () => {
    const html = renderToStaticMarkup(createElement(DeepResearchRuntimePanel, {
      state: state('completed'),
      onConfirmScope: () => undefined,
      onAnswerScope: () => undefined,
      onApprove: () => undefined,
      onCancel: () => undefined,
      onOpenReport: () => undefined
    }))

    expect(html).toContain('报告已生成')
    expect(html).not.toContain('/workspace/Research/run/report.md')
    expect(html).not.toContain('/workspace/Research/run/brief.md')
    expect(html).not.toContain('/workspace/Research/run/plan.md')
    expect(html).not.toContain('/workspace/Research/run/sources.md')
    expect(html).not.toContain('/workspace/Research/run/notes.md')
    expect(html).toContain('状态：已完成')
    expect(html).toContain('模型 4 次 · 1,234 tokens · 搜索 2 次')
    expect(html).toContain('打开报告')
    expect(html).toContain('aria-label="关闭深度研究"')
    expect(html).not.toContain('评估')
    expect(html).not.toContain('需求匹配')
    expect(html).not.toContain('模型评审')
    expect(html).not.toContain('fake-judge')
  })
})

function state(
  phase: DeepResearchRuntimePanelState['phase'],
  scopeOverrides: Partial<NonNullable<DeepResearchRuntimePanelState['result']>['run']['scope']> = {}
): DeepResearchRuntimePanelState {
  return {
    phase,
    topic: 'runtime integration',
    workspaceRoot: '/workspace',
    result: {
      run: {
        id: 'rr_1',
        status: phase === 'completed' ? 'done' : phase === 'failed' ? 'failed' : phase === 'scoping' ? 'scoping' : 'awaiting_brief_confirm',
        briefHash: 'sha256:test',
        scope: {
          understood: true,
          coreQuestionsConfirmed: true,
          readyForBrief: true,
          summary: '需求已理解。',
          mainContradiction: '抓住核心问题。',
          assumptions: ['默认中文完整报告。'],
          clarificationQuestions: [],
          confirmationChecklist: ['需求理解已确认。'],
          ...scopeOverrides
        },
        scopeClarifications: phase === 'scoping'
          ? [{ id: 'clarification_1', message: '调研 Cursor 与 Windsurf 的定价差异。', createdAt: '2026-06-29T00:00:00.000Z' }]
          : [],
        brief: {
          topic: 'runtime integration',
          userIntent: 'Understand the runtime UI path.',
          successCriteria: ['The report is generated.'],
          constraints: ['Keep UI minimal.']
        },
        frame: {
          coreResearchThread: 'Can the runtime UI path be tested manually?',
          centralQuestion: 'Does the user see and confirm the brief?',
          coreQuestions: [{ id: 'q1', text: 'Can the user confirm?', priority: 'high', required: true }],
          investigationPath: ['Create run', 'Confirm brief', 'Write report']
        },
        plan: {
          id: 'plan_rr_1',
          rationale: '按主线拆解任务。',
          tasks: [{
            id: 'task_1',
            objective: '调研：Can the user confirm?',
            questionIds: ['q1'],
            expectedEvidence: ['Evidence'],
            searchHints: ['runtime integration'],
            maxSources: 3,
            priority: 'high',
            status: phase === 'completed' || phase === 'failed' ? 'done' : 'pending'
          }],
          createdAt: '2026-06-29T00:00:00.000Z'
        },
        verification: {
          pass: phase !== 'failed',
          scores: {
            requirementsAlignment: 0.92,
            answersCoreQuestions: 0.9,
            followsCoreResearchThread: 0.91,
            reportCompleteness: 0.88,
            citationAccuracy: 0.95,
            evidenceCoverage: 0.9,
            sourceQuality: 0.7,
            conflictHandling: 0.7,
            uncertaintyCalibration: 0.86,
            writingQuality: 0.93,
            llmJudgeOverall: 0.9
          },
          llmJudge: {
            source: 'llm_judge',
            model: 'fake-judge',
            pass: phase !== 'failed',
            scores: {
              requirementsAlignment: 0.92,
              answersConfirmedScope: 0.9,
              followsResearchFrame: 0.91,
              reportCompleteness: 0.88,
              evidenceUse: 0.9,
              citationFaithfulness: 0.95,
              uncertaintyCalibration: 0.86,
              writingQuality: 0.93,
              overall: 0.9
            },
            rationale: phase === 'failed' ? '报告符合已确认需求的程度不足。' : '报告符合已确认需求。',
            blockingIssues: phase === 'failed' ? ['报告符合已确认需求的程度不足。'] : [],
            warnings: [],
            recommendedFixes: phase === 'failed' ? ['补齐核心问题后重新生成。'] : [],
            judgedAt: '2026-06-29T00:00:00.000Z'
          },
          blockingIssues: phase === 'failed' ? ['报告符合已确认需求的程度不足。'] : [],
          warnings: [],
          recommendedFixes: phase === 'failed' ? ['补齐核心问题后重新生成。'] : [],
          verifiedAt: '2026-06-29T00:00:00.000Z'
        },
        modelBudgetUsage: { modelCalls: 4, totalTokens: 1234, costUsd: 0, costCny: 0 },
        webAudit: [
          { phase: 'search', status: 'success' },
          { phase: 'search', status: 'filtered' },
          { phase: 'fetch', status: 'success' }
        ],
        ...(phase === 'failed' ? { terminalReason: '模型端点不可用。' } : {})
      },
      reportPath: phase === 'completed' ? '/workspace/Research/run/report.md' : null,
      draftPath: phase === 'failed' ? '/workspace/Research/run/.kun-research/report-draft.md' : null,
      artifactPaths: {
        rootDir: '/workspace/Research/run',
        reportPath: '/workspace/Research/run/report.md',
        briefPath: '/workspace/Research/run/brief.md',
        planPath: '/workspace/Research/run/plan.md',
        sourcesPath: '/workspace/Research/run/sources.md',
        notesPath: '/workspace/Research/run/notes.md',
        machineDir: '/workspace/Research/run/.kun-research',
        runJsonPath: '/workspace/Research/run/.kun-research/run.json',
        evidenceJsonlPath: '/workspace/Research/run/.kun-research/evidence.jsonl',
        claimsJsonlPath: '/workspace/Research/run/.kun-research/claims.jsonl',
        citationsJsonlPath: '/workspace/Research/run/.kun-research/citations.jsonl',
        eventsJsonlPath: '/workspace/Research/run/.kun-research/events.jsonl'
      },
      completed: phase === 'completed'
    }
  }
}
