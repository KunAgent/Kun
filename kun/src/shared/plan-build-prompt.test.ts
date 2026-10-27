import { describe, expect, it } from 'vitest'
import { buildPlanBuildPrompt } from './plan-build-prompt.js'

const todos = [{ id: 't1', content: 'Add registry', status: 'pending' as const }]

describe('plan build prompt', () => {
  it('tells an external Agent about its task worktree instead of Kun task tools', () => {
    const prompt = buildPlanBuildPrompt('.kunsdd/plan/a.md', '# Plan', 'direct', undefined, todos, {
      agentName: 'Codex', sourceRepositoryRoot: '/repo', baseBranch: 'develop'
    })
    expect(prompt).toContain('<task_worktree_isolation>')
    expect(prompt).toContain('"baseBranch": "develop"')
    expect(prompt).toContain('never push')
    expect(prompt).not.toContain('task_update')
    expect(prompt).not.toContain('<prompt_managed_worktree_protocol>')
  })

  it('keeps Kun task tracking for native builds', () => {
    const prompt = buildPlanBuildPrompt('.kunsdd/plan/a.md', '# Plan', 'direct', undefined, todos)
    expect(prompt).toContain('task_update')
    expect(prompt).not.toContain('<task_worktree_isolation>')
  })
})
