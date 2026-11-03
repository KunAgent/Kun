import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubagentsCapabilityConfig } from '../../contracts/capabilities.js'
import { ChildRunRecord, DelegationRuntime, FileDelegationStore } from '../../delegation/delegation-runtime.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDelegationToolProviders } from './delegation-tool-provider.js'

describe('delegate_task resume compatibility', () => {
  let directory: string
  let store: FileDelegationStore
  const executor = vi.fn(async () => ({
    summary: 'Finished the existing task.', evidence: ['Checked the changed implementation.']
  }))
  const context: ToolHostContext = {
    threadId: 'parent', turnId: 'resume-turn', workspace: '/workspace',
    approvalPolicy: 'auto', sandboxMode: 'workspace-write', clientSurface: 'gui',
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow'
  }
  const resumeArgs = {
    prompt: 'Continue the interrupted review.', resumeChildId: 'child_review', expectedResumeCount: 0
  }

  beforeEach(async () => {
    executor.mockClear()
    directory = await mkdtemp(join(tmpdir(), 'kun-tool-resume-'))
    store = new FileDelegationStore(directory)
    await store.upsert(ChildRunRecord.parse({
      id: 'child_review', parentThreadId: 'parent', parentTurnId: 'original-turn',
      launcher: 'delegate_task', label: 'Original review', prompt: 'Review the change.',
      workspace: '/workspace', profile: 'code-reviewer', toolPolicy: 'readOnly',
      profileSnapshot: { name: 'Code Reviewer', mode: 'subagent', toolPolicy: 'readOnly' },
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      status: 'failed', terminationReason: 'child_error', resumable: true, resumeCount: 0,
      returnFormat: 'evidence', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:01.000Z'
    }))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function tool(useExistingAgents = true) {
    const runtime = new DelegationRuntime({
      config: SubagentsCapabilityConfig.parse({ enabled: true, useExistingAgents }),
      store, executor, proactiveRetryWait: async () => false
    })
    return buildDelegationToolProviders(runtime)[0]!.tools[0]!
  }

  it.each([true, false])('resumes the same child with echoed creation fields (existing agents: %s)', async (existing) => {
    const delegate = tool(existing)
    const result = await delegate.execute({
      ...resumeArgs, label: 'Review continuation', profile: 'code-reviewer',
      detach: false, returnFormat: 'summary'
    }, context)

    expect(result).toMatchObject({
      isError: false,
      output: { childId: 'child_review', status: 'completed', resumeCount: 1, returnFormat: 'evidence' }
    })
    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({
      childId: 'child_review', resumeChild: true, profile: 'code-reviewer',
      toolPolicy: 'readOnly', returnFormat: 'evidence'
    }))
    expect(await store.get('child_review')).toMatchObject({
      label: 'Original review', profile: 'code-reviewer', returnFormat: 'evidence', resumeCount: 1
    })

    await expect(delegate.execute(resumeArgs, context)).resolves.toMatchObject({
      isError: true, output: { error: expect.stringContaining('resume count changed') }
    })
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: '', profile: '', detach: false, returnFormat: 'summary' },
    { label: null, profile: null, custom_agent: null, detach: null, returnFormat: null }
  ])('accepts neutral placeholders during a user-requested resume: %j', async (placeholders) => {
    await expect(tool().execute({ ...resumeArgs, ...placeholders }, {
      ...context, subagentResume: { childId: 'child_review', expectedResumeCount: 0 }
    })).resolves.toMatchObject({ isError: false, output: { childId: 'child_review', resumeCount: 1 } })
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('rejects a different profile without changing or launching the child', async () => {
    await expect(tool().execute({ ...resumeArgs, profile: 'general' }, context)).resolves.toMatchObject({
      isError: true, output: { error: expect.stringContaining('is not a general child') }
    })
    expect(executor).not.toHaveBeenCalled()
    expect(await store.get('child_review')).toMatchObject({ profile: 'code-reviewer', resumeCount: 0 })
  })

  it('still enforces parent ownership with echoed fields', async () => {
    await expect(tool().execute({ ...resumeArgs, label: 'Review', detach: false }, {
      ...context, threadId: 'another-parent'
    })).resolves.toMatchObject({
      isError: true, output: { error: expect.stringContaining('does not belong to this parent thread') }
    })
    expect(executor).not.toHaveBeenCalled()
  })

  it.each([
    ['custom_agent', { custom_agent: { name: 'Replacement', system_prompt: 'Replace the role.' } }],
    ['detach', { detach: true }]
  ])('rejects %s changes with instructions to keep the resume target', async (field, override) => {
    const result = await tool().execute({ ...resumeArgs, ...override }, context)
    expect(result).toMatchObject({
      isError: true,
      output: { error: expect.stringContaining(`omit ${field}`) }
    })
    expect(result.output).toMatchObject({ error: expect.stringContaining('keep resumeChildId and expectedResumeCount') })
    expect(executor).not.toHaveBeenCalled()
  })
})
