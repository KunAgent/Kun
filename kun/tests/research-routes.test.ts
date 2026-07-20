import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  ModelScopeAgent,
  ResearchRuntimeService,
  type DraftReport,
  type QualityJudge,
  type QualityJudgeInput,
  type QualityJudgeVerdict,
  type ResearchRunApiResponse,
  type ResearchTaskWorker,
  type ResearchTaskWorkerInput,
  type SynthesisWriter,
  type SynthesisWriterInput,
  type WorkerResult
} from '../src/research/index.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
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
    h.runtime.research = new ResearchRuntimeService({ dataDir, allowedWorkspaceRoots: [workspaceRoot] })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        body: JSON.stringify({ topic: 'runtime integration' })
      })
    )

    expect(response.status).toBe(401)
  })

  it('rejects unapproved workspace roots and malformed or oversized create requests', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({ dataDir, allowedWorkspaceRoots: [] })

    const unapproved = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'boundary test', workspaceRoot })
      })
    )
    expect(unapproved.status).toBe(400)
    expect(await readJson(unapproved)).toMatchObject({ message: expect.stringContaining('research_workspace_not_allowed') })
    await expect(stat(join(workspaceRoot, 'Research'))).rejects.toThrow()

    const invalidBudget = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'budget test', budget: { maxWorkers: 4, maxSubagents: 2 } })
      })
    )
    expect(invalidBudget.status).toBe(400)
    expect(await readJson(invalidBudget)).toMatchObject({ message: expect.stringContaining('maxWorkers') })

    const unknownField = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'unknown field test', unexpected: true })
      })
    )
    expect(unknownField.status).toBe(400)

    const oversized = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'x'.repeat(140_000) })
      })
    )
    expect(oversized.status).toBe(413)
  })

  it('rejects sibling-prefix, traversal and symlink workspace escapes without writing artifacts', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot]
    })
    const siblingRoot = `${workspaceRoot}-sibling`
    const outsideRoot = await mkdtemp(join(tmpdir(), 'kun-research-outside-'))
    const symlinkRoot = join(workspaceRoot, 'linked-outside')
    await mkdir(siblingRoot, { recursive: true })
    await symlink(outsideRoot, symlinkRoot)

    try {
      const attemptedRoots = [
        siblingRoot,
        join(workspaceRoot, '..', basename(siblingRoot)),
        symlinkRoot
      ]
      for (const attemptedRoot of attemptedRoots) {
        const response = await dispatchRequest(
          h.router,
          new Request('http://localhost/v1/research/runs', {
            method: 'POST',
            headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
            body: JSON.stringify({ topic: 'workspace escape probe', workspaceRoot: attemptedRoot })
          })
        )
        expect(response.status).toBe(400)
        expect(await readJson(response)).toMatchObject({
          message: expect.stringContaining('research_workspace_not_allowed')
        })
      }

      await expect(stat(join(siblingRoot, 'Research'))).rejects.toThrow()
      await expect(stat(join(outsideRoot, 'Research'))).rejects.toThrow()
    } finally {
      await rm(siblingRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it('creates a run, waits for approval, then writes report artifacts', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
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
    expect(approved.run.status, approved.run.terminalReason).toBe('done')
    expect(approved.reportPath).toBe(approved.artifactPaths.reportPath)
    expect(approved.artifactPaths.reportPath.startsWith(await realpath(workspaceRoot))).toBe(true)
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

    const listedResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs?limit=1', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(listedResponse.status).toBe(200)
    const listed = await readJson(listedResponse) as { runs: ResearchRunApiResponse[] }
    expect(listed.runs).toHaveLength(1)
    expect(listed.runs[0]?.run.id).toBe(created.run.id)
    expect(listed.runs[0]?.workspaceRoot).toBe(await realpath(workspaceRoot))
  })

  it('does not inject a fixed word count into concise report requests', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({ dataDir, allowedWorkspaceRoots: [workspaceRoot] })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '解释 ETag 与 If-None-Match 的缓存验证关系，输出简洁中文报告',
          workspaceRoot,
          brief: { outputFormat: '简洁中文 Markdown 报告' }
        })
      })
    )

    expect(response.status).toBe(200)
    const created = await readJson(response) as ResearchRunApiResponse
    expect(created.run.brief.outputFormat).toBe('简洁中文 Markdown 报告')
    expect(created.run.brief.userIntent).not.toContain('2000')
    expect(created.run.brief.successCriteria.join('\n')).not.toContain('2000')
  })

  it('does not promote model-invented scope claims into report obligations', async () => {
    const h = buildHarness()
    const scopeModel = new QueuedScopeModelClient([JSON.stringify({
      understood: true,
      coreQuestionsConfirmed: true,
      readyForBrief: true,
      summary: '解释 HTTP 缓存并评估最佳策略。',
      mainContradiction: '缓存新鲜度与验证之间的权衡，以及 ETag 强度对验证行为的影响。',
      assumptions: [],
      clarificationQuestions: [],
      confirmationChecklist: [
        '需求理解：解释 HTTP 缓存。',
        '核心问题：ETag 强度如何影响验证效率？',
        '调研主线：评估 API 与静态资源的最佳缓存策略。',
        '输出边界：同时使用 MDN 与 IETF 官方文档。'
      ]
    })])
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      scopeAgent: new ModelScopeAgent({ modelClient: scopeModel, model: 'fake-scope-model', timeoutMs: 1_000 })
    })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '仅基于 developer.mozilla.org（MDN）官方文档，解释强 ETag 与弱 ETag、freshness 与 validation，并分析 API 响应缓存场景。',
          workspaceRoot
        })
      })
    )

    expect(response.status).toBe(200)
    const created = await readJson(response) as ResearchRunApiResponse
    const obligations = [
      created.run.brief.userIntent,
      ...created.run.brief.successCriteria,
      created.run.frame.centralQuestion,
      created.run.frame.coreResearchThread,
      ...created.run.frame.coreQuestions.map((question) => question.text)
    ].join('\n')
    expect(obligations).not.toMatch(/权衡|影响验证|验证效率|最佳缓存策略/u)
    expect(created.run.brief.sourcePolicy.allowedDomains).toEqual(['developer.mozilla.org'])
  })

  it('shrinks the default source budget for a concise single-domain report', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({ dataDir, allowedWorkspaceRoots: [workspaceRoot] })
    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '仅基于 developer.mozilla.org（MDN）官方网页简洁解释 HTTP 缓存验证',
          workspaceRoot,
          reasoningEffort: 'high'
        })
      })
    )

    expect(response.status).toBe(200)
    const created = await readJson(response) as ResearchRunApiResponse
    expect(created.run.brief.sourcePolicy.allowedDomains).toEqual(['developer.mozilla.org'])
    expect(created.run.budget).toMatchObject({ minSources: 1, targetSources: 4, maxSources: 8 })
    expect(created.run.brief.sourcePolicy).toMatchObject({ minSourceCount: 1, maxSourceCount: 8 })
  })

  it('keeps ambiguous research requests in scope instead of proposing a brief', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
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
          model: 'deepseek-v4-pro',
          providerId: 'deepseek',
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
    expect(created.run.model).toBe('deepseek-v4-pro')
    expect(created.run.providerId).toBe('deepseek')
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
    expect(answered.run.brief.topic).toBe('Cursor 与 Windsurf 的定价差异、用户核心路径和产品选型风险')
    expect(answered.run.brief.topic).not.toContain('我理解你要围绕')
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
    expect(autoRun.run.status, autoRun.run.terminalReason).toBe('done')
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
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
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
    expect(approvedAfterAnswer.run.status, approvedAfterAnswer.run.terminalReason).toBe('done')
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

  it('preserves explicit brief and frame overrides after a scope answer', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_scope_overrides')
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '帮我研究一下',
          workspaceRoot,
          brief: {
            userIntent: '只使用 MDN 官方网页解释三个 HTTP 头部。',
            targetAudience: 'Web 开发者',
            outputFormat: '中文 Markdown 研究报告',
            sourcePolicy: {
              allowedSourceTypes: ['web'],
              allowedDomains: ['developer.mozilla.org'],
              minSourceCount: 2,
              maxSourceCount: 2,
              requireCitations: true
            },
            successCriteria: ['至少引用两个独立 MDN 页面。'],
            constraints: ['不得使用非 MDN 来源。']
          },
          frame: {
            coreResearchThread: '区分三个 HTTP 头部的职责。',
            centralQuestion: '三个 HTTP 头部如何配合？',
            coreQuestions: [{ id: 'q_http', text: '三个 HTTP 头部如何配合？', priority: 'high', required: true }],
            investigationPath: ['检索', '抽取', '校验'],
            evidenceNeeded: ['MDN 原文'],
            disconfirmingEvidenceNeeded: ['文档未支持的边界'],
            nonGoals: ['不扩展其他头部']
          },
          budget: {
            preset: 'standard',
            minSources: 2,
            targetSources: 2,
            maxSources: 2,
            maxResearchRounds: 1
          }
        })
      })
    )
    const created = await readJson(createdResponse) as ResearchRunApiResponse
    expect(created.run.scope.readyForBrief).toBe(false)

    const answeredResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: '仅限 MDN，面向 Web 开发者，只回答三个 HTTP 头部的职责与协同。'
        })
      })
    )
    const answered = await readJson(answeredResponse) as ResearchRunApiResponse

    expect(answered.run.brief.userIntent).toBe('只使用 MDN 官方网页解释三个 HTTP 头部。')
    expect(answered.run.brief.targetAudience).toBe('Web 开发者')
    expect(answered.run.brief.sourcePolicy.allowedSourceTypes).toEqual(['web'])
    expect(answered.run.brief.sourcePolicy.allowedDomains).toEqual(['developer.mozilla.org'])
    expect(answered.run.brief.successCriteria).toEqual(['至少引用两个独立 MDN 页面。'])
    expect(answered.run.brief.constraints).toEqual(['不得使用非 MDN 来源。'])
    expect(answered.run.frame.centralQuestion).toBe('三个 HTTP 头部如何配合？')
    expect(answered.run.frame.coreQuestions).toEqual([
      { id: 'q_http', text: '三个 HTTP 头部如何配合？', priority: 'high', required: true }
    ])
    expect(answered.run.frame.alternativesToCompare).toBeUndefined()
  })

  it('returns a structured failed run when verification blocks the report', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
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
    expect(approved.reportPath).toBeNull()
    expect(approved.run.status).toBe('failed')
    expect(approved.run.terminalReason).toContain('报告没有满足已确认需求')
    expect(approved.draftPath).toBe(join(approved.run.artifacts.machineDir, 'report-draft.md'))
    expect(approved.run.verification?.pass).toBe(false)
    expect(approved.run.verification?.blockingIssues).toContain('报告没有满足已确认需求')
    await expect(stat(join(approved.run.artifacts.machineDir, 'report-draft.md'))).resolves.toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(approved.run.artifacts.reportPath)).rejects.toThrow()

    const evidenceBeforeRetry = await readFile(approved.run.artifacts.evidenceJsonlPath, 'utf8')
    const retryResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/retry`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    expect(retryResponse.status).toBe(200)
    const retried = await readJson(retryResponse) as ResearchRunApiResponse
    expect(retried.run.status).toBe('planning')
    expect(retried.run.terminalReason).toBeUndefined()

    const retriedFailure = await waitForResearchSettled(h, created.run.id)
    expect(retriedFailure.run.status).toBe('failed')
    expect(await readFile(approved.run.artifacts.evidenceJsonlPath, 'utf8')).toBe(evidenceBeforeRetry)
  })

  it('auto-approves and completes in one request for test/dev wiring', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      worker: new RouteEvidenceWorker(),
      synthesisWriter: new RouteSynthesisWriter(),
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
    expect(body.completed, body.run.terminalReason).toBe(true)
    expect(body.run.status).toBe('done')
    expect(body.reportPath).toBe(body.artifactPaths.reportPath)
    await expect(stat(body.artifactPaths.reportPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('does not loop back to scope when only optional clarification questions remain', async () => {
    const h = buildHarness()
    const scopeModel = new QueuedScopeModelClient([
      JSON.stringify({
        understood: false,
        coreQuestionsConfirmed: false,
        readyForBrief: false,
        summary: '用户只说想研究一下，还没有说明具体对象。',
        mainContradiction: '当前主要矛盾是调研对象和核心问题不明确。',
        assumptions: ['不会直接进入简报。'],
        clarificationQuestions: [{
          id: 'scope_target',
          question: '你想调研的具体对象是什么？',
          why: '没有对象就无法设计搜索路径和报告结构。',
          options: ['产品', '公司', '行业', '技术方案'],
          required: true
        }]
      }),
      JSON.stringify({
        understood: true,
        coreQuestionsConfirmed: true,
        readyForBrief: false,
        summary: '用户已经说明要研究 Cursor 的定价和用户选择。',
        mainContradiction: 'Cursor 的定价差异如何影响个人开发者选型。',
        assumptions: ['未选择可选补充时使用默认时间边界。'],
        clarificationQuestions: [{
          id: 'scope_optional_boundary',
          question: '是否还要额外限定时间范围？',
          why: '时间范围只用于细化报告边界，不应阻塞简报。',
          options: ['最近三年', '不限时间'],
          required: false
        }]
      })
    ])
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_optional_scope'),
      scopeAgent: new ModelScopeAgent({
        modelClient: scopeModel,
        model: 'fake-scope-model',
        timeoutMs: 1_000
      })
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
          model: 'deepseek-v4-pro',
          providerId: 'deepseek',
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
    expect(created.run.scope.clarificationQuestions.map((question) => question.id)).toEqual(['scope_target'])

    const answerResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: [
            '1. 你想调研的具体对象是什么？',
            '回答：Cursor 定价、个人开发者用户路径和选型风险。',
            '',
            '未选择可选补充，使用默认边界继续。'
          ].join('\n'),
          autoApprove: true
        })
      })
    )
    expect(answerResponse.status).toBe(200)
    const answered = await readJson(answerResponse) as ResearchRunApiResponse
    expect(answered.run.scope.readyForBrief).toBe(true)
    expect(answered.run.scope.clarificationQuestions).toEqual([])
    expect(answered.run.status).not.toBe('scoping')
    expect(answered.run.status).not.toBe('awaiting_brief_confirm')
    expect(scopeModel.requests).toHaveLength(2)
    expect(scopeModel.requests.every((request) => request.model === 'deepseek-v4-pro')).toBe(true)
    expect(scopeModel.requests.every((request) => request.providerId === 'deepseek')).toBe(true)
    await waitForResearchSettled(h, created.run.id)
  })

  it('cleans model-repeated clarification prompts after scope answer submission', async () => {
    const h = buildHarness()
    const scopeModel = new QueuedScopeModelClient([
      JSON.stringify({
        understood: false,
        coreQuestionsConfirmed: false,
        readyForBrief: false,
        summary: '用户要对比 Cursor 和 Windsurf，但还没有确认具体定价方案。',
        mainContradiction: '当前主要矛盾是定价方案和个人开发者场景尚未明确。',
        assumptions: [],
        clarificationQuestions: [
          {
            id: 'pricing_plan',
            question: '您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？',
            why: '定价方案会影响证据搜索和结论。',
            options: ['免费版', 'Pro 档', '团队版'],
            required: true
          },
          {
            id: 'optional_angle',
            question: '是否有特定的比较角度？例如：哪个性价比更高？',
            why: '这是可选边界，不应阻塞提交。',
            options: ['性价比', '功能限制'],
            required: false
          }
        ]
      }),
      JSON.stringify({
        understood: true,
        coreQuestionsConfirmed: true,
        readyForBrief: true,
        summary: [
          '对比 Cursor 和 Windsurf 的官方定价差异。',
          '补充：1. 您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？请补充。',
          '回答：个人开发者免费版、Pro 档和更高档套餐。'
        ].join('\n'),
        mainContradiction: '围绕「对比 Cursor 和 Windsurf；补充：1. 您希望对比的是哪些具体定价方案？」，什么？例如：哪个性价比更高？',
        assumptions: ['最后一题是选答，未选择时使用默认比较角度。'],
        clarificationQuestions: [],
        confirmationChecklist: [
          '需求理解：对比 Cursor 和 Windsurf 官方定价。',
          '核心问题：围绕「对比 Cursor 和 Windsurf；补充：1. 您希望对比的是哪些具体定价方案？」，什么？例如：哪个性价比更高？',
          '调研主线：官方定价、套餐限制和个人开发者选型。',
          '输出边界：中文完整报告。'
        ]
      })
    ])
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
      nowIso: sequenceTimes(),
      idGenerator: sequenceIds('rr_prompt_clean'),
      scopeAgent: new ModelScopeAgent({
        modelClient: scopeModel,
        model: 'fake-scope-model',
        timeoutMs: 1_000
      })
    })

    const createdResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/research/runs', {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: '帮我研究一下 Cursor 和 Windsurf',
          workspaceRoot,
          reasoningEffort: 'medium'
        })
      })
    )
    expect(createdResponse.status).toBe(200)
    const created = await readJson(createdResponse) as ResearchRunApiResponse
    expect(created.run.scope.readyForBrief).toBe(false)

    const answeredResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/research/runs/${created.run.id}/scope/answer`, {
        method: 'POST',
        headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
        body: JSON.stringify({
          message: [
            '1. 您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？',
            '回答：个人开发者免费版、Pro 档和更高档套餐。',
            '',
            '最后一题是选答，我不选，按默认角度继续。'
          ].join('\n')
        })
      })
    )
    expect(answeredResponse.status).toBe(200)
    const answered = await readJson(answeredResponse) as ResearchRunApiResponse
    const frameText = [
      answered.run.frame.centralQuestion,
      answered.run.frame.coreResearchThread,
      ...answered.run.frame.coreQuestions.map((question) => question.text)
    ].join('\n')

    expect(answered.run.scope.readyForBrief).toBe(true)
    expect(answered.run.frame.centralQuestion).toContain('Cursor')
    expect(answered.run.frame.centralQuestion).toContain('Windsurf')
    expect(frameText).not.toMatch(/您希望|请补充|例如[:：]|选答/)
  })

  it('cancels an awaiting research run', async () => {
    const h = buildHarness()
    h.runtime.research = new ResearchRuntimeService({
      dataDir,
      allowedWorkspaceRoots: [workspaceRoot],
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

class RouteSynthesisWriter implements SynthesisWriter {
  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    const usedClaimIds = new Set<string>()
    const sectionLines = (input.reportContract?.requiredSections ?? [])
      .map((section) => {
        const mappedClaimIds = input.sectionEvidenceMap
          ?.find((entry) => entry.sectionId === section.id)?.claimIds ?? []
        const fallbackClaimId = input.claims.find((candidate) => candidate.critical)?.id
          ?? input.claims[0]?.id
          ?? 'claim_1'
        const claimIds = mappedClaimIds.length > 0 ? mappedClaimIds : [fallbackClaimId]
        claimIds.forEach((claimId) => usedClaimIds.add(claimId))
        const evidenceSentences = claimIds.map((claimId) => {
          const claimText = input.claims.find((claim) => claim.id === claimId)?.text ?? '当前测试证据覆盖本章。'
          const citation = input.brief.sourcePolicy.requireCitations === false ? '' : ` [claim:${claimId}]`
          return `${claimText}${citation}`
        }).join(' ')
        return [
          `### ${section.title}`,
          '',
          `${evidenceSentences} ${'本地路由测试使用确定性 writer 验证批准、证据绑定、引用解析、质量校验和报告落盘的完整控制流。'.repeat(28)}`,
          '',
          '这一判断的适用边界是：当前内容只验证测试夹具覆盖的控制流，不能外推为真实研究结论。'
        ].join('\n')
      })
    const conclusionClaimIds = [...usedClaimIds].slice(0, 2)
    const conclusionCitations = input.brief.sourcePolicy.requireCitations === false
      ? ''
      : conclusionClaimIds.map((claimId) => `[claim:${claimId}]`).join('')
    return {
      markdown: [
        `# ${input.brief.topic}`,
        '',
        '## 主要发现',
        '',
        ...sectionLines,
        '',
        '## 结论与建议',
        '',
        `${input.frame.coreResearchThread}。这份确定性测试报告只验证 runtime 控制流，不代表真实研究结论。${conclusionCitations}`,
        '',
        '## 局限与不确定性',
        '',
        '现有证据仅覆盖合成测试控制流，未覆盖真实网页研究。当前材料未验证 LLM Judge 的实际输出，因此不能外推为真实研究结论。',
        '',
        '## 后续研究建议',
        '',
        '使用真实来源运行有界端到端测试。'
      ].join('\n'),
      claimIds: input.brief.sourcePolicy.requireCitations === false
        ? []
        : [...usedClaimIds],
      generatedAt: input.nowIso
    }
  }
}

class RouteEvidenceWorker implements ResearchTaskWorker {
  async runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult> {
    const questionIds = input.task.questionIds.length > 0 ? input.task.questionIds : ['central']
    const evidenceQuestionIds = (input.task.reportQuestionIds?.length ?? 0) > 0
      ? input.task.reportQuestionIds!
      : questionIds
    const sourceId = `${input.task.id}_route_fixture_source`
    const source = {
      id: sourceId,
      sourceType: 'web' as const,
      title: `Route evidence fixture for ${input.task.objective}`,
      canonicalUrl: `https://fixture.test/research/${encodeURIComponent(input.task.id)}`,
      accessedAt: input.brief.createdAt,
      importedAt: input.brief.createdAt,
      reliability: 'high' as const,
      reliabilityReason: 'Deterministic fetched Web fixture for HTTP route integration tests.',
      sourcePolicyTags: ['web_fetch', 'official'],
      fingerprint: `fixture_${input.task.id}`,
      status: 'fetched' as const,
      kind: 'web_strong' as const
    }
    const questions = evidenceQuestionIds.map((questionId, index) => {
      const suffix = `${input.task.id}_${questionId}_${index + 1}`
      const question = input.frame.coreQuestions.find((candidate) => candidate.id === questionId)?.text
        ?? input.frame.centralQuestion
      const spanId = `${suffix}_span`
      const claimId = `${suffix}_claim`
      const evidenceQuestion = question.replace(/\.{3}|…/gu, '已确认主题')
      const comparedTargets = input.frame.alternativesToCompare?.join('与') ?? '研究对象'
      const claimText = `${comparedTargets}在问题“${evidenceQuestion}”所述维度采用不同安排；这种差异会影响该维度下的比较判断，但当前证据只支持这一问题范围内的结论。`
      const evidenceText = [
        claimText,
        '该测试网页片段仅用于验证 Runtime 是否保持问题级证据归属、引用解析和报告落盘控制流。'
      ].join(' ')
      return {
        span: {
          id: spanId,
          sourceId,
          text: evidenceText,
          textHash: `hash_${suffix}`,
          location: { url: source.canonicalUrl, paragraphIndex: index + 1 },
          extractedAt: input.brief.createdAt,
          extractorRunId: input.runId
        },
        claim: {
          id: claimId,
          text: claimText,
          entities: [input.brief.topic],
          claimType: 'fact' as const,
          supportSpanIds: [spanId],
          confidence: 'high' as const,
          critical: index === 0
        },
        note: {
          id: `${suffix}_note`,
          taskId: input.task.id,
          questionIds: [questionId],
          claimIds: [claimId],
          summary: `确定性路由证据覆盖问题：${question}`,
          implicationForBrief: `报告必须在对应章节回答：${question}`,
          confidence: 'high' as const,
          limitations: ['这是 HTTP 路由集成测试夹具，不代表真实研究结论。']
        }
      }
    })
    return {
      taskId: input.task.id,
      questionIds,
      sources: [source],
      evidenceSpans: questions.map((item) => item.span),
      claims: questions.map((item) => item.claim),
      notes: questions.map((item) => item.note),
      unresolvedQuestions: [],
      conflicts: [],
      suggestedNextQueries: []
    }
  }

  hasSearchCapability(): boolean {
    return true
  }
}

class QueuedScopeModelClient implements ModelClient {
  readonly provider = 'fake'
  readonly model = 'fake'
  readonly requests: ModelRequest[] = []

  constructor(private readonly responses: string[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    const response = this.responses.shift()
    if (!response) throw new Error('QueuedScopeModelClient response queue exhausted')
    yield { kind: 'assistant_text_delta', text: response }
    yield { kind: 'completed', stopReason: 'stop' }
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
