/**
 * [INPUT]: 依赖 rendererRuntimeClient 和 shared/kun-endpoints 的 research HTTP 路径
 * [OUTPUT]: 对外提供 DeepResearch runtime client、feature flag helper 和状态格式化函数
 * [POS]: renderer/research 的 API glue，把 /research UI 操作转成结构化 runtime 请求
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  KUN_RESEARCH_RUNS_PATH,
  kunResearchRunPath,
  kunResearchRunApprovePath,
  kunResearchRunCancelPath,
  kunResearchRunScopeAnswerPath,
  kunResearchRunScopeConfirmPath
} from '../../../shared/kun-endpoints'

export const DEEP_RESEARCH_RUNTIME_FLAG_KEY = 'kun.deepResearch.runtime'
export const DEEP_RESEARCH_AUTO_APPROVE_FLAG_KEY = 'kun.deepResearch.autoApprove'

export type DeepResearchRuntimeEnv = Record<string, string | boolean | undefined>
export type DeepResearchRuntimeStorage = Pick<Storage, 'getItem'> | null

export type DeepResearchRuntimeRunRequest = {
  topic: string
  workspaceRoot?: string
  autoApprove?: boolean
  reasoningEffort?: string
}

export type DeepResearchRuntimeScopeAnswerOptions = {
  autoApprove?: boolean
}

export type DeepResearchRuntimeScopeConfirmOptions = {
  autoApprove?: boolean
}

export type DeepResearchRuntimeRunResponse = {
  run: {
    id: string
    status: string
    briefHash: string
    scope: {
      understood: boolean
      coreQuestionsConfirmed: boolean
      readyForBrief: boolean
      summary: string
      mainContradiction: string
      assumptions: string[]
      clarificationQuestions: Array<{
        id: string
        question: string
        why: string
        options: string[]
        required: boolean
      }>
      confirmationChecklist: string[]
    }
    scopeClarifications: Array<{ id: string; message: string; createdAt: string }>
    brief: {
      topic: string
      userIntent: string
      userClarifications?: string[]
      successCriteria: string[]
      constraints: string[]
    }
    frame: {
      coreResearchThread: string
      centralQuestion: string
      coreQuestions: Array<{ id: string; text: string; priority: string; required: boolean }>
      investigationPath: string[]
    }
    plan?: {
      id: string
      rationale: string
      tasks: Array<{
        id: string
        objective: string
        questionIds: string[]
        expectedEvidence: string[]
        searchHints: string[]
        maxSources: number
        priority: string
        status: string
      }>
      createdAt: string
    }
    verification?: {
      pass: boolean
      scores: {
        requirementsAlignment?: number
        answersCoreQuestions?: number
        followsCoreResearchThread?: number
        reportCompleteness?: number
        citationAccuracy?: number
        evidenceCoverage?: number
        sourceQuality?: number
        conflictHandling?: number
        uncertaintyCalibration?: number
        writingQuality?: number
        llmJudgeOverall?: number
      }
      llmJudge?: {
        source: string
        model?: string
        pass: boolean
        scores: {
          requirementsAlignment: number
          answersConfirmedScope: number
          followsResearchFrame: number
          reportCompleteness: number
          evidenceUse: number
          citationFaithfulness: number
          uncertaintyCalibration: number
          writingQuality: number
          overall: number
        }
        rationale: string
        blockingIssues: string[]
        warnings: string[]
        recommendedFixes: string[]
        judgedAt: string
      }
      blockingIssues: string[]
      warnings: string[]
      recommendedFixes: string[]
      verifiedAt: string
    }
  }
  reportPath: string | null
  artifactPaths: {
    rootDir: string
    reportPath: string
    briefPath: string
    planPath: string
    sourcesPath: string
    notesPath: string
    machineDir: string
    runJsonPath: string
    evidenceJsonlPath: string
    claimsJsonlPath: string
    citationsJsonlPath: string
    eventsJsonlPath: string
  }
  completed: boolean
}

export function deepResearchRuntimeEnabled(options: {
  env?: DeepResearchRuntimeEnv
  storage?: DeepResearchRuntimeStorage
} = {}): boolean {
  return flagEnabled({
    envValue: readEnv(options.env, 'VITE_KUN_DEEP_RESEARCH_RUNTIME'),
    storageValue: readStorage(options.storage, DEEP_RESEARCH_RUNTIME_FLAG_KEY)
  })
}

export function deepResearchAutoApproveEnabled(options: {
  env?: DeepResearchRuntimeEnv
  storage?: DeepResearchRuntimeStorage
} = {}): boolean {
  return flagEnabled({
    envValue: readEnv(options.env, 'VITE_KUN_DEEP_RESEARCH_AUTO_APPROVE'),
    storageValue: readStorage(options.storage, DEEP_RESEARCH_AUTO_APPROVE_FLAG_KEY)
  })
}

export async function startDeepResearchRuntimeRun(
  request: DeepResearchRuntimeRunRequest
): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    KUN_RESEARCH_RUNS_PATH,
    'POST',
    JSON.stringify({
      topic: request.topic,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
      ...(typeof request.autoApprove === 'boolean' ? { autoApprove: request.autoApprove } : {}),
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {})
    })
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究运行请求失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export async function getDeepResearchRuntimeRun(runId: string): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunResearchRunPath(runId),
    'GET'
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究状态读取失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export async function confirmDeepResearchRuntimeScope(
  runId: string,
  options: DeepResearchRuntimeScopeConfirmOptions = {}
): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunResearchRunScopeConfirmPath(runId),
    'POST',
    JSON.stringify({
      ...(typeof options.autoApprove === 'boolean' ? { autoApprove: options.autoApprove } : {})
    })
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究需求确认失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export async function answerDeepResearchRuntimeScope(
  runId: string,
  message: string,
  options: DeepResearchRuntimeScopeAnswerOptions = {}
): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunResearchRunScopeAnswerPath(runId),
    'POST',
    JSON.stringify({
      message,
      ...(typeof options.autoApprove === 'boolean' ? { autoApprove: options.autoApprove } : {})
    })
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究需求补充失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export async function approveDeepResearchRuntimeRun(
  runId: string,
  briefHash: string
): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunResearchRunApprovePath(runId),
    'POST',
    JSON.stringify({ briefHash })
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究简报确认失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export async function cancelDeepResearchRuntimeRun(runId: string): Promise<DeepResearchRuntimeRunResponse> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunResearchRunCancelPath(runId),
    'POST',
    JSON.stringify({ reason: '用户在深度研究简报界面取消。' })
  )
  if (!response.ok) {
    throw new Error(readRuntimeMessage(response.body, `深度研究取消失败（${response.status}）`))
  }
  return JSON.parse(response.body) as DeepResearchRuntimeRunResponse
}

export function formatDeepResearchRunStatus(status: string | null | undefined): string {
  if (!status) return '创建中'
  return {
    scoping: '确认需求中',
    creating_run: '创建研究任务',
    approving: '启动深度研究',
    awaiting_brief_confirm: '等待确认简报',
    awaiting_confirm: '等待确认简报',
    planning: '生成计划中',
    researching: '调研中',
    gap_checking: '检查缺口中',
    synthesizing: '写作合成中',
    resolving_citations: '解析引用中',
    verifying: '校验中',
    writing: '写入报告中',
    done: '已完成',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    paused: '已暂停',
    research_unavailable: '无法继续',
    running: '运行中'
  }[status] ?? '未知状态'
}

export function formatDeepResearchRuntimeResult(result: DeepResearchRuntimeRunResponse): string {
  if (result.completed && result.reportPath) {
    return [
      `深度研究已完成：${result.run.brief.topic}`,
      '',
      `运行 ID：${result.run.id}`,
      `状态：${formatDeepResearchRunStatus(result.run.status)}`,
      `报告：${result.reportPath}`,
      `产物目录：${result.artifactPaths.rootDir}`
    ].join('\n')
  }
  if (result.run.status === 'scoping') {
    const questions = result.run.scope.clarificationQuestions.map((question) => `- ${question.question}`)
    return [
      `深度研究需求等待确认：${result.run.brief.topic}`,
      '',
      `运行 ID：${result.run.id}`,
      `状态：${formatDeepResearchRunStatus(result.run.status)}`,
      `产物目录：${result.artifactPaths.rootDir}`,
      '',
      result.run.scope.readyForBrief
        ? '确认需求后将生成调研简报。'
        : '需要先补充以下信息：',
      ...(questions.length > 0 ? questions : [])
    ].join('\n')
  }
  if (result.run.status === 'failed') {
    const verification = result.run.verification
    const primaryReason = verification?.blockingIssues?.[0]
      ?? verification?.llmJudge?.rationale
      ?? '报告没有满足已确认需求。'
    return [
      `深度研究未通过质量校验：${result.run.brief.topic}`,
      '',
      `运行 ID：${result.run.id}`,
      `状态：${formatDeepResearchRunStatus(result.run.status)}`,
      `产物目录：${result.artifactPaths.rootDir}`,
      '',
      primaryReason,
      ...(verification?.blockingIssues?.length
        ? ['', '阻塞问题：', ...verification.blockingIssues.map((issue) => `- ${issue}`)]
        : []),
      ...(verification?.recommendedFixes?.length
        ? ['', '建议修复：', ...verification.recommendedFixes.map((fix) => `- ${fix}`)]
        : [])
    ].join('\n')
  }
  return [
    `深度研究简报等待确认：${result.run.brief.topic}`,
    '',
    `运行 ID：${result.run.id}`,
    `状态：${formatDeepResearchRunStatus(result.run.status)}`,
    `简报哈希：${result.run.briefHash}`,
    `产物目录：${result.artifactPaths.rootDir}`,
    '',
    '确认简报后将继续运行调研并生成报告。'
  ].join('\n')
}

function flagEnabled(input: { envValue?: string | boolean; storageValue?: string | null }): boolean {
  return normalizeFlag(input.envValue) === true || normalizeFlag(input.storageValue) === true
}

function normalizeFlag(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function readEnv(env: DeepResearchRuntimeEnv | undefined, key: string): string | boolean | undefined {
  if (env) return env[key]
  return (import.meta as unknown as { env?: DeepResearchRuntimeEnv }).env?.[key]
}

function readStorage(storage: DeepResearchRuntimeStorage | undefined, key: string): string | null {
  const resolved = storage !== undefined
    ? storage
    : typeof window === 'undefined'
      ? null
      : window.localStorage
  try {
    return resolved?.getItem(key) ?? null
  } catch {
    return null
  }
}

function readRuntimeMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : fallback
  } catch {
    return fallback
  }
}
