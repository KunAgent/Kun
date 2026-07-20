import { describe, expect, it } from 'vitest'
import {
  deepResearchAutoApproveEnabled,
  deepResearchRuntimeEnabled,
  formatDeepResearchRunStatus,
  formatDeepResearchRuntimeResult,
  type DeepResearchRuntimeRunResponse
} from './deep-research-runtime-client'

describe('deep research runtime client helpers', () => {
  it('reads runtime feature flags from env or local storage', () => {
    expect(deepResearchRuntimeEnabled({ env: { VITE_KUN_DEEP_RESEARCH_RUNTIME: '1' }, storage: null })).toBe(true)
    expect(deepResearchRuntimeEnabled({ env: {}, storage: fakeStorage('kun.deepResearch.runtime', 'true') })).toBe(true)
    expect(deepResearchRuntimeEnabled({ env: {}, storage: fakeStorage('kun.deepResearch.runtime', '0') })).toBe(false)
  })

  it('reads auto-approve feature flag separately', () => {
    expect(deepResearchAutoApproveEnabled({ env: { VITE_KUN_DEEP_RESEARCH_AUTO_APPROVE: 'on' }, storage: null })).toBe(true)
    expect(deepResearchAutoApproveEnabled({ env: {}, storage: fakeStorage('kun.deepResearch.autoApprove', 'yes') })).toBe(true)
    expect(deepResearchAutoApproveEnabled({ env: {}, storage: null })).toBe(false)
  })

  it('formats completed and awaiting runtime results for the existing composer surface', () => {
    const completed = result({ completed: true, status: 'done', reportPath: '/workspace/Research/report.md' })
    expect(formatDeepResearchRuntimeResult(completed)).toContain('报告：/workspace/Research/report.md')
    expect(formatDeepResearchRuntimeResult(completed)).toContain('状态：已完成')
    const awaiting = result({ completed: false, status: 'awaiting_brief_confirm', reportPath: null })
    expect(formatDeepResearchRuntimeResult(awaiting)).toContain('等待确认')
    expect(formatDeepResearchRuntimeResult(awaiting)).toContain('状态：等待确认简报')
    expect(formatDeepResearchRuntimeResult(awaiting)).toContain('简报哈希：')
  })

  it('formats research_unavailable without exposing the internal status name', () => {
    expect(formatDeepResearchRunStatus('research_unavailable')).toBe('无法继续')
  })
})

function fakeStorage(key: string, value: string): Pick<Storage, 'getItem'> {
  return {
    getItem: (candidate) => candidate === key ? value : null
  }
}

function result(input: { completed: boolean; status: string; reportPath: string | null }): DeepResearchRuntimeRunResponse {
  return {
    run: {
      id: 'rr_1',
      status: input.status,
      briefHash: 'sha256:test',
      scope: {
        understood: true,
        coreQuestionsConfirmed: true,
        readyForBrief: true,
        summary: '需求已理解。',
        mainContradiction: '抓住核心问题。',
        assumptions: ['默认中文完整报告。'],
        clarificationQuestions: [],
        confirmationChecklist: ['需求理解已确认。']
      },
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
    reportPath: input.reportPath,
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
    completed: input.completed
  }
}
