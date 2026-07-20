/**
 * [INPUT]: 依赖 DeepResearch runtime client 类型和 lucide-react 图标
 * [OUTPUT]: 对外提供 DeepResearchRuntimePanel、面板状态类型和 scope 回答消息构造器
 * [POS]: components/research 的结果导向卡，承载 scope 交互、简洁状态和报告打开动作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { CheckCircle2, FileText, Loader2, SendHorizontal, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  formatDeepResearchRunStatus,
  type DeepResearchRuntimeRunResponse
} from '../../research/deep-research-runtime-client'

export type DeepResearchRuntimePanelState = {
  phase: 'creating_run' | 'scoping' | 'awaiting_brief_confirm' | 'approving' | 'running' | 'completed' | 'cancelled' | 'failed'
  topic: string
  workspaceRoot?: string
  result?: DeepResearchRuntimeRunResponse
  error?: string
}

export type DeepResearchRuntimePanelProps = {
  state: DeepResearchRuntimePanelState
  busy?: boolean
  onApprove: () => void
  onConfirmScope: () => void
  onAnswerScope: (message: string) => void
  onCancel: () => void
  onOpenReport: () => void
}

export function DeepResearchRuntimePanel({
  state,
  busy = false,
  onApprove,
  onConfirmScope,
  onAnswerScope,
  onCancel,
  onOpenReport
}: DeepResearchRuntimePanelProps): ReactElement {
  const run = state.result?.run
  const brief = run?.brief
  const scope = run?.scope
  const rawRunStatus = run?.status ?? state.phase
  const runStatus = visibleRunStatus(rawRunStatus, state.phase)
  const canConfirmScope = state.phase === 'scoping' && scope?.readyForBrief === true && Boolean(run) && !busy
  const canApprove = state.phase === 'awaiting_brief_confirm' && Boolean(run) && !busy
  const canCancel = (state.phase === 'scoping' || state.phase === 'awaiting_brief_confirm' || state.phase === 'running') && Boolean(run) && !busy
  const canOpenReport = (state.phase === 'completed' || state.phase === 'failed') && Boolean(state.result?.reportPath) && !busy
  const [scopeAnswer, setScopeAnswer] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const clarificationQuestions = useMemo(
    () => scope?.clarificationQuestions ?? [],
    [scope?.clarificationQuestions]
  )
  const questionSignature = clarificationQuestions.map((question) => `${question.id}:${question.question}`).join('|')
  const composedScopeAnswer = useMemo(
    () => buildScopeAnswerMessage({
      questions: clarificationQuestions,
      selectedOptions,
      customAnswers,
      note: scopeAnswer
    }),
    [clarificationQuestions, selectedOptions, customAnswers, scopeAnswer]
  )
  const hasClarificationQuestions = clarificationQuestions.length > 0
  const canAnswerScope = state.phase === 'scoping' && Boolean(run) && composedScopeAnswer.trim().length > 0 && !busy

  useEffect(() => {
    setScopeAnswer('')
    setSelectedOptions({})
    setCustomAnswers({})
  }, [run?.id, questionSignature])

  const submitScopeAnswer = (): void => {
    const message = composedScopeAnswer.trim()
    if (!message) return
    onAnswerScope(message)
  }
  const selectQuestionOption = (questionId: string, option: string): void => {
    const currentOptions = selectedOptions[questionId] ?? []
    const nextOptions = currentOptions.includes(option)
      ? currentOptions.filter((candidate) => candidate !== option)
      : [...currentOptions, option]
    setSelectedOptions((current) => ({
      ...current,
      [questionId]: nextOptions
    }))
  }
  const updateCustomAnswer = (questionId: string, value: string): void => {
    setCustomAnswers((current) => ({
      ...current,
      [questionId]: value
    }))
  }

  return (
    <section
      className="min-h-0 w-full max-w-5xl overflow-y-auto overscroll-contain rounded-lg border border-ds-border-muted bg-ds-card px-6 py-5 pr-5 text-base shadow-sm"
      style={{ maxHeight: 'min(820px, calc(100vh - 9rem))' }}
      aria-label="深度研究"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium tracking-wide text-ds-text-muted">深度研究</div>
          <h2 className="mt-1 break-words text-2xl font-semibold leading-8 text-ds-text">{brief?.topic ?? state.topic}</h2>
          <div className="mt-1 text-sm text-ds-text-muted">
            状态：{formatDeepResearchRunStatus(runStatus)}
          </div>
        </div>
        <RuntimeBadge status={runStatus} phase={state.phase} />
      </div>

      {state.error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
          {state.error}
        </div>
      ) : null}

      <ResearchProgress
        phase={state.phase}
        status={runStatus}
        verification={run?.verification}
      />

      {state.phase === 'scoping' && scope ? (
        <div className="mt-4 space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="需求理解" value={scope.summary} />
            <Field label="主要矛盾" value={scope.mainContradiction} />
            {run?.scopeClarifications && run.scopeClarifications.length > 0 ? (
              <ListField label="已补充" values={run.scopeClarifications.map((item) => item.message)} />
            ) : null}
          </div>
          {scope.clarificationQuestions.length > 0 ? (
            <ClarificationField
              questions={scope.clarificationQuestions}
              selectedOptions={selectedOptions}
              customAnswers={customAnswers}
              disabled={busy}
              canSubmit={canAnswerScope}
              onSelectOption={selectQuestionOption}
              onCustomAnswerChange={updateCustomAnswer}
              onSubmit={submitScopeAnswer}
            />
          ) : null}
        </div>
      ) : state.phase === 'awaiting_brief_confirm' && brief ? (
        <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 px-4 py-4">
          <div className="text-base font-semibold text-ds-text">确认研究计划</div>
          <div className="mt-1 text-sm leading-6 text-ds-text-muted">
            确认后将开始联网收集证据、合成完整中文报告，并在完成后写入写作区可打开的 Markdown 文档。
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="研究主题" value={brief.topic} />
            <ListField label="交付标准" values={brief.successCriteria} />
          </div>
        </div>
      ) : state.phase === 'creating_run' ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-ds-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          正在生成调研简报...
        </div>
      ) : null}

      {state.phase === 'approving' ? (
        <div className="mt-4 rounded-md border border-accent/35 bg-accent/10 px-4 py-3 text-base font-medium text-ds-text">
          正在启动深度研究，马上进入任务拆解和联网收集证据。
        </div>
      ) : null}

      {state.phase === 'running' ? (
        <div className="mt-4 rounded-md border border-accent/35 bg-accent/10 px-4 py-3 text-base font-medium text-ds-text">
          正在生成完整报告。系统会自动补充检索和修订，完成后直接展示结果。
        </div>
      ) : null}

      {state.phase === 'failed' ? (
        <FailureSummary status={run?.status} verification={run?.verification} error={state.error} />
      ) : null}

      {state.phase === 'completed' && state.result?.reportPath ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="font-semibold">报告已生成</div>
          <div className="mt-1 leading-6">点击下方按钮打开 Markdown 报告，继续阅读或编辑。</div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {state.phase === 'scoping' && scope && !scope.readyForBrief && !hasClarificationQuestions && !busy ? (
          <div className="flex w-full flex-col gap-2">
            <textarea
              value={scopeAnswer}
              onChange={(event) => setScopeAnswer(event.target.value)}
              className="min-h-24 w-full resize-y rounded-md border border-ds-border-muted bg-ds-bg px-3 py-2 text-[14px] leading-6 text-ds-text outline-none placeholder:text-ds-text-muted focus:border-accent"
              placeholder="补充说明，或直接写完整回答..."
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canAnswerScope}
                onClick={submitScopeAnswer}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-bg px-3 text-[14px] font-medium text-ds-text transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <SendHorizontal className="h-4 w-4" aria-hidden="true" />}
                提交补充
              </button>
              {composedScopeAnswer.trim() ? (
                <span className="text-[13px] text-ds-text-muted">已选择/填写的内容会合并提交</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {state.phase === 'scoping' && scope?.readyForBrief ? (
          <button
            type="button"
            disabled={!canConfirmScope}
            onClick={onConfirmScope}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            确认需求，生成简报
          </button>
        ) : null}
        {state.phase === 'awaiting_brief_confirm' ? (
          <button
            type="button"
            disabled={!canApprove}
            onClick={onApprove}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            确认并开始
          </button>
        ) : null}
        {state.phase === 'completed' ? (
          <button
            type="button"
            disabled={!canOpenReport}
            onClick={onOpenReport}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-bg px-3 text-[14px] font-medium text-ds-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            打开报告
          </button>
        ) : null}
        {state.phase === 'failed' && state.result?.reportPath ? (
          <button
            type="button"
            disabled={!canOpenReport}
            onClick={onOpenReport}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-bg px-3 text-[14px] font-medium text-ds-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            打开当前草稿
          </button>
        ) : null}
        {state.phase !== 'completed' && state.phase !== 'failed' && state.phase !== 'cancelled' ? (
          <button
            type="button"
            disabled={!canCancel}
            onClick={onCancel}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-bg px-3 text-[14px] font-medium text-ds-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            取消
          </button>
        ) : null}
      </div>
    </section>
  )
}

function RuntimeBadge({
  status,
  phase
}: {
  status: string
  phase: DeepResearchRuntimePanelState['phase']
}): ReactElement {
  const failed = phase === 'failed' || status === 'failed'
  const running = phase === 'creating_run' || phase === 'approving' || phase === 'running'
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold ${
      failed
        ? 'border-red-200 bg-red-50 text-red-700'
        : running
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-ds-border-muted bg-ds-bg text-ds-text-muted'
    }`}>
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {failed ? <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {formatDeepResearchRunStatus(status)}
    </span>
  )
}

function visibleRunStatus(status: string, phase: DeepResearchRuntimePanelState['phase']): string {
  if (phase === 'creating_run') return 'creating_run'
  if (phase === 'approving') return 'approving'
  if (phase === 'completed') return 'done'
  if (phase === 'running' && (status === 'awaiting_brief_confirm' || status === 'awaiting_confirm' || status === 'scoping')) {
    return 'planning'
  }
  return status
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-ds-text-muted">{label}</div>
      <div className="mt-1 break-words text-base leading-7 text-ds-text">{value}</div>
    </div>
  )
}

function ListField({
  label,
  values,
  ordered = false
}: {
  label: string
  values: string[]
  ordered?: boolean
}): ReactElement {
  const ListTag = ordered ? 'ol' : 'ul'
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-ds-text-muted">{label}</div>
      <ListTag className={`mt-1 space-y-1 text-[15px] leading-7 text-ds-text ${ordered ? 'list-decimal pl-5' : ''}`}>
        {values.length > 0 ? values.map((value) => (
          <li key={value} className="break-words">{ordered ? value : `- ${value}`}</li>
        )) : <li>暂无</li>}
      </ListTag>
    </div>
  )
}

type ResearchVerification = NonNullable<DeepResearchRuntimeRunResponse['run']['verification']>

function ResearchProgress({
  phase,
  status,
  verification
}: {
  phase: DeepResearchRuntimePanelState['phase']
  status: string
  verification?: ResearchVerification
}): ReactElement {
  if (phase === 'scoping' || phase === 'awaiting_brief_confirm' || phase === 'completed' || phase === 'cancelled') {
    return <></>
  }
  return (
    <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-ds-text">{progressTitle(status, phase, verification)}</div>
          <div className="mt-0.5 text-sm leading-6 text-ds-text-muted">{progressDescription(status, phase, verification)}</div>
        </div>
      </div>
    </div>
  )
}

function FailureSummary({
  status,
  verification,
  error
}: {
  status?: string
  verification?: ResearchVerification
  error?: string
}): ReactElement {
  const blockingIssues = verification?.blockingIssues ?? []
  const fixes = verification?.recommendedFixes ?? []
  const hasVerification = Boolean(verification)
  const unavailable = status === 'research_unavailable'
  const reason = verification?.llmJudge?.rationale
    ?? blockingIssues[0]
    ?? error
    ?? (unavailable ? '当前环境缺少可核验资料，系统没有进入完整深度研究。' : undefined)
    ?? (hasVerification ? '报告没有达到完成标准，系统已停止提交结果。' : '研究任务未能完成。')
  const next = fixes[0] ?? (unavailable ? '开启联网或上传资料后重新开始。' : undefined)
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">
      <div className="font-semibold">{unavailable ? '当前无法开始深度研究' : hasVerification ? '报告质量还没达标' : '研究运行失败'}</div>
      <div className="mt-1 leading-5">
        {reason}
      </div>
      {next ? (
        <div className="mt-2 leading-5">建议：{next}</div>
      ) : null}
    </div>
  )
}

function progressTitle(
  status: string,
  phase: DeepResearchRuntimePanelState['phase'],
  verification?: ResearchVerification
): string {
  if (phase === 'failed') return verification ? '报告质量还没达标' : '研究运行失败'
  if (phase === 'creating_run') return '正在理解需求'
  if (phase === 'approving') return '正在启动研究'
  if (status === 'synthesizing' || status === 'resolving_citations' || status === 'verifying' || status === 'writing') {
    return '正在打磨报告'
  }
  return '正在生成完整报告'
}

function progressDescription(
  status: string,
  phase: DeepResearchRuntimePanelState['phase'],
  verification?: ResearchVerification
): string {
  if (phase === 'failed') {
    return verification ? '当前结果没有达到完成标准。' : '这次研究没有完成。'
  }
  if (phase === 'creating_run') return '正在整理主题和需要确认的信息。'
  if (phase === 'approving') return '确认后会直接进入报告生成，不需要你盯过程。'
  if (status === 'synthesizing' || status === 'resolving_citations' || status === 'verifying' || status === 'writing') {
    return '正在把调研材料组织成可阅读的中文报告。'
  }
  return '系统会在后台完成检索、分析和修订；你只需要看最终报告。'
}

function ClarificationField({
  questions,
  selectedOptions,
  customAnswers,
  disabled,
  canSubmit,
  onSelectOption,
  onCustomAnswerChange,
  onSubmit
}: {
  questions: DeepResearchRuntimeRunResponse['run']['scope']['clarificationQuestions']
  selectedOptions: Record<string, string[]>
  customAnswers: Record<string, string>
  disabled: boolean
  canSubmit: boolean
  onSelectOption: (questionId: string, option: string) => void
  onCustomAnswerChange: (questionId: string, value: string) => void
  onSubmit: () => void
}): ReactElement {
  const requiredQuestions = questions.filter((question) => question.required)
  const answeredQuestions = questions.filter((question) => hasQuestionAnswer(question.id, selectedOptions, customAnswers))
  const answeredRequiredQuestions = requiredQuestions.filter((question) => hasQuestionAnswer(question.id, selectedOptions, customAnswers))
  const remainingRequiredCount = Math.max(requiredQuestions.length - answeredRequiredQuestions.length, 0)

  return (
    <div className="min-w-0 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ds-text">第 1 步：补充信息</div>
          <div className="mt-0.5 text-[13px] text-ds-text-muted">选项可多选；也可以不选选项，直接填写答案。</div>
        </div>
        <div className="shrink-0 rounded-full border border-ds-border-muted bg-ds-card px-3 py-1 text-[13px] font-medium text-ds-text">
          已完成 {answeredQuestions.length}/{questions.length}
        </div>
      </div>
      <div className="mt-3 space-y-3 text-[15px] text-ds-text">
        {questions.map((question, index) => (
          <fieldset key={question.id} className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-bg/70 px-4 py-3 shadow-sm">
            <legend className="px-1 text-[13px] font-semibold text-ds-text-muted">
              问题 {index + 1}{question.required ? ' · 必答' : ' · 可选'}
            </legend>
            <div className="text-[15px] font-semibold leading-6 text-ds-text">{question.question}</div>
            <div className="mt-1 text-[13px] leading-5 text-ds-text-muted">{question.why}</div>
            {question.options.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {question.options.map((option) => {
                  const selected = selectedOptions[question.id]?.includes(option) ?? false
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      data-selected={selected ? 'true' : 'false'}
                      disabled={disabled}
                      onClick={() => onSelectOption(question.id, option)}
                      className={`flex min-h-12 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-semibold leading-5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-accent bg-accent/12 text-ds-text shadow-sm ring-2 ring-accent/25'
                          : 'border-ds-border-muted bg-ds-card text-ds-text hover:border-accent/60 hover:bg-ds-hover'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {selected ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                        ) : (
                          <span className="h-4 w-4 shrink-0 rounded border border-ds-border-muted bg-ds-bg" aria-hidden="true" />
                        )}
                        <span className="min-w-0 break-words">{option}</span>
                      </span>
                      {selected ? (
                        <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[12px] text-white">
                          已选
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {hasQuestionAnswer(question.id, selectedOptions, customAnswers) ? (
              <div className="mt-2 text-[13px] font-medium text-accent">
                已记录这个问题的回答
              </div>
            ) : null}
            <textarea
              value={customAnswers[question.id] ?? ''}
              disabled={disabled}
              onChange={(event) => onCustomAnswerChange(question.id, event.target.value)}
              className="mt-3 min-h-16 w-full resize-y rounded-md border border-ds-border-muted bg-ds-card px-3 py-2 text-[14px] leading-5 text-ds-text outline-none placeholder:text-ds-text-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
              placeholder={question.options.length > 0 ? '也可以不选上面的选项，直接输入你的答案...' : '直接输入你的答案...'}
            />
          </fieldset>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-accent/30 bg-ds-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] leading-5 text-ds-text-muted">
            {remainingRequiredCount > 0
              ? `还剩 ${remainingRequiredCount} 个必答问题未补充；也可以先提交，让模型继续追问。`
              : '必答问题已补充，提交后模型会重新判断是否可以生成简报。'}
          </div>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-[14px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {disabled ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <SendHorizontal className="h-4 w-4" aria-hidden="true" />}
            {disabled ? '正在提交给模型' : '提交补充给模型'}
          </button>
        </div>
      </div>
    </div>
  )
}

function hasQuestionAnswer(
  questionId: string,
  selectedOptions: Record<string, string[]>,
  customAnswers: Record<string, string>
): boolean {
  const selected = selectedOptions[questionId] ?? []
  const custom = customAnswers[questionId]?.trim() ?? ''
  const nonCustomSelected = selected.some((option) => !isCustomAnswerOption(option))
  const customSelected = selected.some(isCustomAnswerOption)
  if (customSelected && !nonCustomSelected) return Boolean(custom)
  return Boolean(nonCustomSelected || custom)
}

function isCustomAnswerOption(option: string): boolean {
  return /其他|请说明|自定义|补充|手动|填写/.test(option)
}

export function buildScopeAnswerMessage(input: {
  questions: DeepResearchRuntimeRunResponse['run']['scope']['clarificationQuestions']
  selectedOptions: Record<string, string[]>
  customAnswers: Record<string, string>
  note: string
}): string {
  const answers = input.questions
    .map((question, index) => {
      const selected = input.selectedOptions[question.id] ?? []
      const custom = input.customAnswers[question.id]?.trim()
      const parts = [...selected, custom].filter(Boolean)
      if (parts.length === 0) return ''
      return `${index + 1}. ${question.question}\n回答：${parts.join('；')}`
    })
    .filter(Boolean)
  const note = input.note.trim()
  if (note) answers.push(`补充说明：${note}`)
  return answers.join('\n\n')
}
