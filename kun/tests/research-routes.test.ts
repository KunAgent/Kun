import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ResearchRuntimeService,
  type QualityJudge,
  type QualityJudgeInput,
  type QualityJudgeVerdict,
  type ResearchRunApiResponse
} from '../src/research/index.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('research HTTP routes', () => {
  let workspaceRoot = ''
  let dataDir = ''

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-research-workspace-'))
    dataDir = await mkdtemp(join(tmpdir(), 'kun-research-data-'))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  it('requires auth for creating research runs', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({ dataDir })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        body: JSON.stringify({ topic: 'runtime integration' })
      })
    )

    expect(response.status).toBe(401)
  })

  it('creates a run, waits for approval, then writes report artifacts', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_route')
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '如何验证 runtime integration 的报告生成链路是否可靠',
          workspaceRoot,
          reasoningEffort: 'medium',
          budget: {
            minSources: 1,
            targetSources: 2,
            maxSources: 4,
            maxResearchRounds: 1
          }
        })
      })
    )

    expect(createdResponse.status).toBe(200)
    const created = await readJson(createdResponse) as ResearchRunApiResponse
    expect(created.run.status).toBe('scoping')
    expect(created.run.budget.preset).toBe('quick')
    expect(created.run.budget.reasoningEffort).toBe('medium')
    expect(created.run.scope.readyForBrief).toBe(true)
    expect(created.reportPath).toBeNull()

    const scopedResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/confirm`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )
    expect(scopedResponse.status).toBe(200)
    const scoped = await readJson(scopedResponse) as ResearchRunApiResponse
    expect(scoped.run.status).toBe('awaiting_brief_confirm')

    const statusResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(statusResponse.status).toBe(200)
    expect((await readJson(statusResponse) as ResearchRunApiResponse).run.status).toBe('awaiting_brief_confirm')

    const approvedResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/approve`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          briefHash: scoped.run.briefHash
        })
      })
    )

    expect(approvedResponse.status).toBe(200)
    const approvedStarted = await readJson(approvedResponse) as ResearchRunApiResponse
    expect(approvedStarted.run.status).toBe('planning')
    expect(approvedStarted.completed).toBe(false)
    const approved = await waitForResearchSettled(h, created.run.id)
    expect(approved.run.status).toBe('done')
    expect(approved.reportPath).toBe(approved.artifactPaths.reportPath)
    expect(approved.artifactPaths.reportPath.startsWith(workspaceRoot)).toBe(true)
    expect(approved.artifactPaths.reportPath).not.toMatch(/\/report\.md$/)
    expect(approved.artifactPaths.reportPath).toContain('如何验证-runtime-integration')

    await expect(stat(approved.artifactPaths.reportPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.briefPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.planPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.sourcesPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.notesPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.runJsonPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.evidenceJsonlPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.claimsJsonlPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.citationsJsonlPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.artifactPaths.eventsJsonlPath)).resolves.toMatchObject({ isFile: expect.any(Function) })

    const brief = await readFile(approved.artifactPaths.briefPath, 'utf-8')
    expect(brief).toContain('## 请确认')
    expect(brief).toContain('需求理解')

    const report = await readFile(approved.artifactPaths.reportPath, 'utf-8')
    expect(report).not.toMatch(/^---\n/)
    expect(report).not.toContain('> 校验状态：通过')
    expect(report).toContain('## 摘要')
    expect(report).toContain('## 调研范围与方法')
    expect(report).toContain('## 主要发现')
  })

  it('keeps ambiguous research requests in scope instead of proposing a brief', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_scope')
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '帮我研究一下',
          workspaceRoot,
          reasoningEffort: 'medium',
          budget: {
            minSources: 1,
            targetSources: 2,
            maxSources: 4,
            maxResearchRounds: 1
          }
        })
      })
    )

    expect(createdResponse.status).toBe(200)
    const created = await readJson(createdResponse) as ResearchRunApiResponse
    expect(created.run.status).toBe('scoping')
    expect(created.run.scope.readyForBrief).toBe(false)
    expect(created.run.scope.clarificationQuestions.map((question) => question.id)).toContain('scope_target')

    const scopedResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/confirm`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )
    expect(scopedResponse.status).toBe(400)
    expect(await scopedResponse.text()).toContain('requires clarification')

    const answeredResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: '调研 Cursor 与 Windsurf 的定价差异、用户核心路径和产品选型风险，输出中文完整报告。'
        })
      })
    )
    expect(answeredResponse.status).toBe(200)
    const answered = await readJson(answeredResponse) as ResearchRunApiResponse
    expect(answered.run.id).toBe(created.run.id)
    expect(answered.run.status).toBe('scoping')
    expect(answered.run.scope.readyForBrief).toBe(true)
    expect(answered.run.scopeClarifications).toHaveLength(1)
    expect(answered.run.brief.topic).toContain('Cursor')
    expect(answered.run.brief.userClarifications).toEqual([
      '调研 Cursor 与 Windsurf 的定价差异、用户核心路径和产品选型风险，输出中文完整报告。'
    ])
    expect(answered.run.brief.successCriteria.join('\n')).toContain('用户在 scope 阶段补充')

    const autoRunResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: '补充：重点比较企业付费场景和个人开发者选型。',
          autoApprove: true
        })
      })
    )
    expect(autoRunResponse.status).toBe(200)
    const autoRunStarted = await readJson(autoRunResponse) as ResearchRunApiResponse
    expect(autoRunStarted.run.status).toBe('planning')
    expect(autoRunStarted.completed).toBe(false)
    const autoRun = await waitForResearchSettled(h, created.run.id)
    expect(autoRun.run.status).toBe('done')
    expect(autoRun.completed).toBe(true)
    expect(autoRun.reportPath).toBe(autoRun.artifactPaths.reportPath)
    expect(autoRun.artifactPaths.reportPath).not.toMatch(/\/report\.md$/)
    expect(autoRun.artifactPaths.reportPath).toContain('Cursor')
    expect(autoRun.artifactPaths.reportPath).toContain('Windsurf')
    await expect(stat(autoRun.artifactPaths.reportPath)).resolves.toMatchObject({ isFile: expect.any(Function) })

    const broadResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '研究 AI',
          workspaceRoot
        })
      })
    )
    expect(broadResponse.status).toBe(200)
    const broad = await readJson(broadResponse) as ResearchRunApiResponse
    expect(broad.run.status).toBe('scoping')
    expect(broad.run.scope.readyForBrief).toBe(false)
    expect(broad.run.scope.clarificationQuestions.map((question) => question.id)).toContain('scope_boundary')
  })

  it('still allows manual approval after answering scope without auto-approve', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_scope_manual')
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '帮我研究一下',
          workspaceRoot,
          reasoningEffort: 'medium',
          budget: {
            minSources: 1,
            targetSources: 2,
            maxSources: 4,
            maxResearchRounds: 1
          }
        })
      })
    )
    const created = await readJson(createdResponse) as ResearchRunApiResponse

    const answeredResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: '调研 Cursor 与 Windsurf 的定价差异、用户核心路径和产品选型风险，输出中文完整报告。'
        })
      })
    )
    const answered = await readJson(answeredResponse) as ResearchRunApiResponse
    expect(answered.run.status).toBe('scoping')
    expect(answered.run.scope.readyForBrief).toBe(true)

    const confirmedAfterAnswerResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/confirm`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )
    expect(confirmedAfterAnswerResponse.status).toBe(200)
    const confirmedAfterAnswer = await readJson(confirmedAfterAnswerResponse) as ResearchRunApiResponse
    expect(confirmedAfterAnswer.run.status).toBe('awaiting_brief_confirm')

    const approvedAfterAnswerResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/approve`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          briefHash: confirmedAfterAnswer.run.briefHash
        })
      })
    )
    expect(approvedAfterAnswerResponse.status).toBe(200)
    const approvedAfterAnswerStarted = await readJson(approvedAfterAnswerResponse) as ResearchRunApiResponse
    expect(approvedAfterAnswerStarted.run.status).toBe('planning')
    expect(approvedAfterAnswerStarted.completed).toBe(false)
    const approvedAfterAnswer = await waitForResearchSettled(h, created.run.id)
    expect(approvedAfterAnswer.run.status).toBe('done')
    expect(approvedAfterAnswer.completed).toBe(true)
    expect(approvedAfterAnswer.reportPath).toBe(approvedAfterAnswer.artifactPaths.reportPath)
    expect(approvedAfterAnswer.artifactPaths.reportPath).toContain('Cursor')
    expect(approvedAfterAnswer.artifactPaths.reportPath).toContain('Windsurf')
    expect(approvedAfterAnswer.run.verification?.pass).toBe(true)
    expect(approvedAfterAnswer.run.verification?.llmJudge?.source).toBe('heuristic_fallback')
    expect(approvedAfterAnswer.run.verification?.scores.requirementsAlignment).toBeGreaterThan(0)
    const completedReport = await readFile(approvedAfterAnswer.artifactPaths.reportPath, 'utf-8')
    expect(completedReport).not.toContain('> 模型评审：通过 · 来源：启发式兜底')
    expect(completedReport).not.toContain('## 核心问题与回答')
    expect(completedReport).not.toContain('## 证据链')
    expect(completedReport).toContain('## 主要发现')

  })

  it('returns a structured failed run when verification blocks the report', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_failed_quality'),
      qualityJudge: new FailingRouteQualityJudge()
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '如何验证 runtime integration 的报告生成链路是否可靠',
          workspaceRoot,
          reasoningEffort: 'medium',
          budget: {
            minSources: 1,
            maxSources: 4,
            maxResearchRounds: 1,
            maxSynthesisRetries: 1
          }
        })
      })
    )
    expect(createdResponse.status).toBe(200)
    const created = await readJson(createdResponse) as ResearchRunApiResponse
    const scopedResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/confirm`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
    )
    expect(scopedResponse.status).toBe(200)
    const scoped = await readJson(scopedResponse) as ResearchRunApiResponse

    const approvedResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/approve`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ briefHash: scoped.run.briefHash })
      })
    )

    expect(approvedResponse.status).toBe(200)
    const approvedStarted = await readJson(approvedResponse) as ResearchRunApiResponse
    expect(approvedStarted.run.status).toBe('planning')
    const approved = await waitForResearchSettled(h, created.run.id)
    expect(approved.completed).toBe(false)
    expect(approved.reportPath).toBe(approved.run.artifacts.reportPath)
    expect(approved.run.status).toBe('failed')
    expect(approved.run.verification?.pass).toBe(false)
    expect(approved.run.verification?.blockingIssues).toContain('报告没有满足已确认需求')
  })

  it('auto-approves and completes in one request for test/dev wiring', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_auto')
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '如何自动验收 research runtime 的完整报告链路',
          workspaceRoot,
          reasoningEffort: 'medium',
          autoApprove: true,
          budget: {
            minSources: 1,
            targetSources: 2,
            maxSources: 4,
            maxResearchRounds: 1
          }
        })
      })
    )

    expect(response.status).toBe(200)
    const started = await readJson(response) as ResearchRunApiResponse
    expect(started.run.status).toBe('planning')
    expect(started.completed).toBe(false)
    const body = await waitForResearchSettled(h, started.run.id)
    expect(body.completed).toBe(true)
    expect(body.run.status).toBe('done')
    expect(body.reportPath).toBe(body.artifactPaths.reportPath)
    await expect(stat(body.artifactPaths.reportPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('cancels an awaiting research run', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_cancel')
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: 'cancel me',
          workspaceRoot
        })
      })
    )
    const created = await readJson(createdResponse) as ResearchRunApiResponse

    const cancelledResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'test cancel' })
      })
    )

    expect(cancelledResponse.status).toBe(200)
    const cancelled = await readJson(cancelledResponse) as ResearchRunApiResponse
    expect(cancelled.run.status).toBe('cancelled')
    expect(cancelled.reportPath).toBeNull()
  })
})

async function waitForResearchSettled(
  h: ReturnType<typeof buildHarness>,
  runId: string
): Promise<ResearchRunApiResponse> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${runId}`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const body = await readJson(response) as ResearchRunApiResponse
    if (body.run.status === 'done' || body.run.status === 'failed' || body.run.status === 'cancelled') {
      return body
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`research run ${runId} did not settle`)
}

class FailingRouteQualityJudge implements QualityJudge {
  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    return {
      source: 'llm_judge',
      model: 'fake-route-judge',
      pass: false,
      scores: {
        requirementsAlignment: 0.2,
        answersConfirmedScope: 0.2,
        followsResearchFrame: 0.4,
        reportCompleteness: 0.3,
        evidenceUse: 0.4,
        citationFaithfulness: 0.6,
        uncertaintyCalibration: 0.5,
        writingQuality: 0.5,
        overall: 0.3
      },
      rationale: `报告没有满足已确认需求：${input.brief.topic}`,
      blockingIssues: ['报告没有满足已确认需求'],
      warnings: [],
      recommendedFixes: ['补齐核心问题和证据后重新生成。'],
      judgedAt: input.nowIso
    }
  }
}

function sequenceIds(prefix: string): () => string {
  let index = 0
  return () => `${prefix}_${++index}`
}

function sequenceTimes(): () => string {
  let index = 0
  return () => new Date(Date.UTC(2026, 5, 29, 2, 0, index++)).toISOString()
}
