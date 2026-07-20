import { describe, expect, it, vi } from 'vitest'

const runtimeRequest = vi.hoisted(() => vi.fn())

vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    runtimeRequest
  }
}))

const {
  approveDeepResearchRuntimeRun,
  cancelDeepResearchRuntimeRun,
  confirmDeepResearchRuntimeScope,
  answerDeepResearchRuntimeScope,
  getDeepResearchRuntimeRun,
  listDeepResearchRuntimeRuns,
  startDeepResearchRuntimeRun
} = await import('./deep-research-runtime-client')

describe('startDeepResearchRuntimeRun', () => {
  it('calls the Kun research runtime endpoint', async () => {
    runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        run: {
          id: 'rr_1',
          status: 'done',
          briefHash: 'sha256:test',
          scope: scopeBody(),
          scopeClarifications: [],
          brief: {
            topic: 'runtime integration',
            userIntent: 'Understand runtime UI wiring.',
            successCriteria: ['Generate a report.'],
            constraints: ['Keep UI minimal.']
          },
          frame: {
            coreResearchThread: 'Can the runtime UI path be tested?',
            centralQuestion: 'Does the user see a brief?',
            coreQuestions: [{ id: 'q1', text: 'Can the user confirm?', priority: 'high', required: true }],
            investigationPath: ['Create', 'Confirm', 'Write']
          }
        },
        reportPath: '/workspace/Research/report.md',
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
        completed: true
      })
    })

    const result = await startDeepResearchRuntimeRun({
      topic: 'runtime integration',
      workspaceRoot: '/workspace',
      autoApprove: true,
      reasoningEffort: 'max',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/research/runs',
      'POST',
      JSON.stringify({
        topic: 'runtime integration',
        workspaceRoot: '/workspace',
        autoApprove: true,
        reasoningEffort: 'max',
        model: 'deepseek-v4-pro',
        providerId: 'deepseek'
      })
    )
    expect(result.completed).toBe(true)
    expect(result.reportPath).toBe('/workspace/Research/report.md')
  })

  it('calls approve and cancel endpoints', async () => {
    runtimeRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify(responseBody('awaiting_brief_confirm'))
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify(responseBody('scoping'))
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify(responseBody('done'))
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify(responseBody('cancelled'))
      })

    await confirmDeepResearchRuntimeScope('rr_1', { autoApprove: true })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/research/runs/rr_1/scope/confirm',
      'POST',
      JSON.stringify({ autoApprove: true })
    )

    await answerDeepResearchRuntimeScope('rr_1', '调研 Cursor 与 Windsurf 的定价差异', { autoApprove: true })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/research/runs/rr_1/scope/answer',
      'POST',
      JSON.stringify({ message: '调研 Cursor 与 Windsurf 的定价差异', autoApprove: true })
    )

    await approveDeepResearchRuntimeRun('rr_1', 'sha256:test')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/research/runs/rr_1/approve',
      'POST',
      JSON.stringify({ briefHash: 'sha256:test' })
    )

    await cancelDeepResearchRuntimeRun('rr_1')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/research/runs/rr_1/cancel',
      'POST',
      JSON.stringify({ reason: '用户在深度研究简报界面取消。' })
    )
  })

  it('reads the current research run for progress polling', async () => {
    runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify(responseBody('researching'))
    })

    const result = await getDeepResearchRuntimeRun('rr_1')

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/research/runs/rr_1', 'GET')
    expect(result.run.status).toBe('researching')
  })

  it('lists recent research runs for restart recovery', async () => {
    runtimeRequest.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ runs: [responseBody('researching')] })
    })

    const runs = await listDeepResearchRuntimeRuns(10)

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/research/runs?limit=10', 'GET')
    expect(runs[0]?.run.status).toBe('researching')
  })
})

function responseBody(status: string): unknown {
  return {
    run: {
      id: 'rr_1',
      status,
      briefHash: 'sha256:test',
      scope: scopeBody(),
      scopeClarifications: [],
      brief: {
        topic: 'runtime integration',
        userIntent: 'Understand runtime UI wiring.',
        successCriteria: ['Generate a report.'],
        constraints: ['Keep UI minimal.']
      },
      frame: {
        coreResearchThread: 'Can the runtime UI path be tested?',
        centralQuestion: 'Does the user see a brief?',
        coreQuestions: [{ id: 'q1', text: 'Can the user confirm?', priority: 'high', required: true }],
        investigationPath: ['Create', 'Confirm', 'Write']
      }
    },
    reportPath: status === 'done' ? '/workspace/Research/report.md' : null,
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
    completed: status === 'done'
  }
}

function scopeBody(): unknown {
  return {
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    summary: '需求已理解。',
    mainContradiction: '抓住核心问题。',
    assumptions: ['默认中文完整报告。'],
    clarificationQuestions: [],
    confirmationChecklist: ['需求理解已确认。']
  }
}
