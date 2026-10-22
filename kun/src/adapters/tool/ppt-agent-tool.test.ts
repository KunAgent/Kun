import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PPT_AGENT_ALLOWED_TOOLS,
  PPT_AGENT_PROVIDER_ID,
  PPT_AGENT_TOOL_NAME,
  buildPptAgentToolProvider
} from './ppt-agent-tool-provider.js'
import { CapabilityRegistry } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import {
  governedPptWorkflowId as governedWorkflowId,
  makePptSourceReader as makeSourceReader,
  makePptTestRuntime as makeRuntime,
  makePptTool as makeTool,
  pptReviewBundle as reviewBundle,
  pptTestContext as baseContext
} from './ppt-agent-tool-test-support.js'

describe('ppt_agent tool provider', () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('registers the tool and gates advertising from live Lab settings', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const runtime = makeRuntime(dir, async () => ({ summary: 'ok' }))
    expect(buildPptAgentToolProvider(runtime, () => undefined)).toHaveLength(1)
    expect(buildPptAgentToolProvider(runtime, () => ({ enabled: true }))).toHaveLength(1)
    const disabledProvider = buildPptAgentToolProvider(runtime, () => ({ enabled: false }))
    expect(disabledProvider).toHaveLength(1)
    expect(disabledProvider[0].tools[0].shouldAdvertise?.(baseContext)).toBe(false)
    const provider = buildPptAgentToolProvider(runtime, () => ({}))[0]
    expect(provider.id).toBe(PPT_AGENT_PROVIDER_ID)
    expect(provider.kind).toBe('delegation')
    expect(provider.tools[0].name).toBe(PPT_AGENT_TOOL_NAME)
    expect(provider.tools[0].sideEffect).toBe('unknown')
    expect(provider.tools[0].shouldAdvertise?.(baseContext)).toBe(true)
    expect(provider.tools[0].description).toContain('Use `ppt_agent` for any presentation/PPT task')
    expect(provider.tools[0].description).toContain('exact active user turn')
    expect(provider.tools[0].inputSchema).toMatchObject({ required: [] })
    expect((provider.tools[0].inputSchema.properties as Record<string, unknown>)).not.toHaveProperty('query')
    expect((provider.tools[0].inputSchema.properties as Record<string, unknown>)).not.toHaveProperty('workspace')
    expect((provider.tools[0].inputSchema.properties as Record<string, unknown>)).not.toHaveProperty('deliverable')
    expect((provider.tools[0].inputSchema.properties as Record<string, unknown>)).not.toHaveProperty('reviewContext')
    let cfg: { enabled?: boolean } | undefined
    const liveTool = buildPptAgentToolProvider(runtime, () => cfg)[0].tools[0]
    expect(liveTool.shouldAdvertise?.(baseContext)).toBe(true)
    cfg = { enabled: false }
    expect(liveTool.shouldAdvertise?.(baseContext)).toBe(false)
    cfg = { enabled: true }
    expect(liveTool.shouldAdvertise?.(baseContext)).toBe(true)
  })

  it('does not register when delegation is unavailable', () => {
    expect(buildPptAgentToolProvider(undefined, () => ({ enabled: true }))).toHaveLength(0)
  })

  it('is advertised in normal turns but stripped from plan and Graph Lead turns', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const runtime = makeRuntime(dir, async () => ({ summary: 'ok' }))
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildPptAgentToolProvider(runtime, () => ({ enabled: true })))
    })
    const normalTools = await host.listTools(baseContext)
    expect(normalTools.map((tool) => tool.name)).toEqual([PPT_AGENT_TOOL_NAME])
    expect(normalTools[0]?.sideEffect).toBe('unknown')
    // Plan turns restrict this mutation surface.
    expect(await host.listTools({ ...baseContext, threadMode: 'plan' })).toEqual([])
    // Graph Lead turns never race this heavyweight child.
    for (const current of [
      { ...baseContext, orchestration: 'graph' as const },
      { ...baseContext, messageSource: 'graph_runtime' as const }
    ]) {
      expect(await host.listTools(current)).toEqual([])
    }
    const disabledHost = new LocalToolHost({
      registry: new CapabilityRegistry(buildPptAgentToolProvider(runtime, () => ({ enabled: false })))
    })
    expect(await disabledHost.listTools(baseContext)).toEqual([])
  })

  it('fails closed when the active source turn is missing and enforces the Lab gate', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let ran = false
    const runtime = makeRuntime(dir, async () => {
      ran = true
      return { summary: 'ok' }
    })
    const tool = makeTool(runtime, () => ({ enabled: true }), makeSourceReader({ missing: true }))
    const missingSource = await tool.execute({}, baseContext)
    expect(missingSource).toMatchObject({
      isError: true,
      output: { phase: 'source_unavailable', error: expect.stringContaining('was not found') }
    })
    expect(ran).toBe(false)
    const steered = await makeTool(
      runtime, () => ({ enabled: true }), makeSourceReader({ steeringPrompt: 'latest correction' })
    ).execute({}, baseContext)
    expect(steered).toMatchObject({ isError: true, output: {
      phase: 'source_unavailable', error: expect.stringContaining('start a new turn')
    } })
    expect(ran).toBe(false)
    // Execute-time backstop for a gate changed after advertisement.
    let cfg = { enabled: true }
    const mutableTool = makeTool(runtime, () => cfg)
    cfg = { enabled: false }
    expect(mutableTool.shouldAdvertise?.(baseContext)).toBe(false)
    const disabled = await mutableTool.execute({ title: 'Build deck' }, baseContext)
    expect(disabled.isError).toBe(true)
    expect((disabled.output as { error: string }).error).toContain('disabled in Lab settings')
    expect(ran).toBe(false)
  })
  it('requires a short UI title on start', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let ran = false
    const runtime = makeRuntime(dir, async () => {
      ran = true
      return { summary: 'unexpected' }
    })
    const tool = makeTool(runtime, () => ({ enabled: true }))

    const missingTitle = await tool.execute({ action: 'start' }, baseContext)
    expect(missingTitle).toMatchObject({ isError: true, output: {
      error: expect.stringContaining('requires a short UI title')
    } })
    expect(ran).toBe(false)
  })
  it('fails closed before starting a child for a managed-tool-incompatible provider', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let ran = false
    const runtime = makeRuntime(dir, async () => { ran = true; return { summary: 'unexpected' } })
    const tool = makeTool(runtime, () => ({
      enabled: true, toolIncompatibleProviderIds: ['cursor-sdk']
    }))
    const result = await tool.execute({ title: 'Review deck' }, {
      ...baseContext, actingModelRoute: { model: 'cursor-agent', providerId: 'cursor-sdk' }
    })
    expect(result).toMatchObject({ isError: true, output: { phase: 'unavailable', error: 'The selected provider cannot execute Kun managed PPT tools; configure a tool-capable PPT Agent model in Lab settings' } })
    expect(ran).toBe(false)
  })
  it('starts a governed editable-preview child without exporting before review', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let received: Record<string, unknown> | undefined
    const lifecycle: Array<Record<string, unknown>> = []
    const runtime = makeRuntime(dir, async (input) => ({
      summary: 'deck ready',
      toolInvocations: 5,
      reviewBundle: reviewBundle(input.childId, governedWorkflowId(input), 'editable')
    }))
    const originalRunChild = runtime.runChild.bind(runtime)
    runtime.runChild = (async (input) => {
      received = { ...input, signal: undefined }
      return originalRunChild(input)
    }) as typeof runtime.runChild
    const exactPrompt = '帮我给这个文档写个 PPT'
    const fileReferences = [{
      path: '/workspace/brief.md',
      relativePath: 'brief.md',
      name: 'brief.md',
      kind: 'file' as const
    }]
    const tool = makeTool(
      runtime,
      () => ({ enabled: true }),
      makeSourceReader({
        prompt: () => exactPrompt,
        attachmentIds: ['att_111111111111111111111111'],
        fileReferences,
        surface: 'write'
      })
    )
    const result = await tool.execute(
      {
        title: 'Build launch deck',
        // Legacy fields remain ignored if a direct call bypasses schema validation.
        query: 'invent an 11-page neon purple outline',
        workspace: '/outside',
        deliverable: 'pptd-only'
      },
      { ...baseContext, agentSurface: 'write' },
      async (update) => {
        lifecycle.push(update.output as Record<string, unknown>)
      }
    )
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({
      summary: 'deck ready',
      toolInvocations: 5,
      title: 'Build launch deck',
      profile: 'ppt',
      profileName: 'PPT Agent',
      model: 'main-model',
      status: 'completed'
    })
    expect(result.output).toMatchObject({ reviewBundle: { phase: 'awaiting_review' } })
    expect(typeof (result.output as { childId?: string }).childId).toBe('string')
    expect(lifecycle.length).toBeGreaterThanOrEqual(1)
    expect(lifecycle[0]).toMatchObject({
      status: expect.stringMatching(/^(queued|running)$/),
      title: 'Build launch deck',
      profile: 'ppt',
      profileName: 'PPT Agent'
    })
    expect(received).toMatchObject({
      parentThreadId: 'thr_main',
      parentTurnId: 'turn_main',
      workspace: '/workspace',
      label: 'Build launch deck',
      agentSurface: 'write',
      inheritSessionDefaults: true,
      inheritedModel: 'main-model',
      inheritedProviderId: 'deepseek',
      inheritedReasoningEffort: 'high',
      inheritedServiceTier: 'priority',
      executionBlockedTools: ['ppt_export', 'generate_image'],
      returnFormat: 'summary',
      approvalPolicy: 'auto',
      approvalReviewer: 'user'
    })
    expect(received?.prompt).toBe(exactPrompt)
    expect(received?.source).toMatchObject({
      prompt: exactPrompt,
      attachmentIds: ['att_111111111111111111111111'],
      fileReferences,
      agentSurface: 'write'
    })
    expect(received?.pptWorkflowScope).toMatchObject({
      action: 'start',
      stage: 'review',
      sourceReadRequired: true,
      directionGate: { required: false, reason: 'work-document' }
    })
    expect(String(received?.controlPrompt)).toContain('IMAGE SLOTS')
    expect(String(received?.controlPrompt)).toContain('do not call generate_image')
    expect(String(received?.controlPrompt)).toContain('ppt_generate_previews')
    expect(String(received?.controlPrompt)).toContain('<PPT_CORE_DESIGN_POLICY')
    expect(String(received?.controlPrompt)).not.toContain('invent an 11-page neon purple outline')
    expect(received?.security).toMatchObject({
      allowedWritePaths: expect.arrayContaining(['.kun/images', 'presentations']),
      instructionsEnabled: false,
      memoryEnabled: false
    })
    expect(result.output).toMatchObject({
      phase: 'awaiting_review',
      mode: 'native',
      imageAssets: 'unavailable'
    })
    expect(result.output).not.toHaveProperty('fallbackNotice')
    const inline = received?.inlineProfile as { id: string; source: string; profile: Record<string, unknown> }
    expect(inline.id).toBe('ppt')
    expect(inline.source).toBe('builtin')
    expect(inline.profile.toolPolicy).toBe('inherit')
    expect(inline.profile.skillsEnabled).toBe(false)
    expect(inline.profile.allowedTools).toEqual([...PPT_AGENT_ALLOWED_TOOLS])
    expect(inline.profile.blockedTools).toEqual(['delegate_task', 'generate_subagent', 'load_skill'])
    expect(inline.profile.model).toBeUndefined()
    expect(inline.profile.promptPreamble).toBeUndefined()
  })

  it('starts native-first with optional image assets and resumes the same PPT child for revisions', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const calls: Array<Record<string, unknown>> = []
    const runtime = makeRuntime(dir, async (input) => {
      calls.push({ ...input, signal: undefined })
      return {
        summary: 'review ready',
        reviewBundle: reviewBundle(input.childId, governedWorkflowId(input))
      }
    })
    let activeChildId = ''
    let activeWorkflowId = ''
    const sourceReader = makeSourceReader({
      prompt: (turnId) => turnId === 'turn_followup'
        ? '把封面标题放大一些'
        : '创建一个发布会介绍 PPT，直接生成，不需要方向选择',
      review: (turnId) => turnId === 'turn_followup' && activeChildId
        ? [{
            workflowId: activeWorkflowId,
            childId: activeChildId,
            slides: [{ slideId: 'slide-1', revision: 1, annotations: ['larger headline'] }]
          }, { workflowId: 'other-workflow', childId: 'child_other' }]
        : []
    })
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true,
      imageGenSupportsReferenceEdit: true
    }), sourceReader)
    const started = await tool.execute({ title: 'Review deck' }, baseContext)
    expect(started).toMatchObject({
      isError: false,
      output: { phase: 'awaiting_review', workflowId: expect.stringMatching(/^ppt_/), reviewBundle: {} }
    })
    expect(calls[0]?.prompt).toBe('创建一个发布会介绍 PPT，直接生成，不需要方向选择')
    expect(String(calls[0]?.controlPrompt)).not.toContain('Do not create PPTD or PPTX yet')
    expect(String(calls[0]?.controlPrompt)).toContain('ppt_generate_previews')
    expect(String(calls[0]?.controlPrompt)).toContain('supplementary generate_image asset')
    expect(calls[0]?.blockedTools).toContain('ppt_export')
    expect(calls[0]?.blockedTools).not.toContain('generate_image')
    expect(started.output).toMatchObject({ mode: 'native', imageAssets: 'enabled' })
    const childId = (started.output as { childId: string }).childId
    activeWorkflowId = (started.output as { workflowId: string }).workflowId
    activeChildId = childId

    const revised = await tool.execute({
      action: 'revise_previews',
      childId,
      workflowId: activeWorkflowId,
      title: 'Revise deck'
    }, { ...baseContext, turnId: 'turn_followup' })
    expect(revised).toMatchObject({
      isError: false,
      output: { childId, phase: 'awaiting_review', reviewBundle: { workflowId: activeWorkflowId } }
    })
    expect(calls[1]).toMatchObject({ childId, resumeChild: true, parentTurnId: 'turn_followup' })
    expect(calls[1]?.prompt).toBe('把封面标题放大一些')
    expect(calls[1]?.blockedTools).toContain('ppt_export')
    expect(String(calls[1]?.controlPrompt)).toContain(`workflowId=${activeWorkflowId}`)
    expect(String(calls[1]?.controlPrompt)).not.toContain('larger headline')
    expect(calls[1]?.source).toMatchObject({ composerContexts: [] })
    expect(calls[1]?.pptWorkflowScope).toMatchObject({
      action: 'revise_previews',
      workflowId: activeWorkflowId,
      projectDir: `.kun/ppt/${activeWorkflowId}`,
      parentThreadId: 'thr_main',
      previewMode: 'editable',
      reviewContext: {
        childId,
        slides: [{ slideId: 'slide-1', revision: 1, annotations: ['larger headline'] }]
      }
    })
  })

  it('requires the same PPT workflow and a validated export before completing approval', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const calls: Array<Record<string, unknown>> = []
    const runtime = makeRuntime(dir, async (input) => {
      calls.push({ ...input, signal: undefined })
      const workflowId = governedWorkflowId(input)
      if (!input.resumeChild) return { summary: 'review ready', reviewBundle: reviewBundle(input.childId, workflowId) }
      return {
        summary: 'deck exported',
        deckArtifact: {
          output: 'presentations/deck.pptx',
          absolutePath: '/workspace/presentations/deck.pptx',
          workflowId,
          projectDir: `.kun/ppt/${workflowId}`,
          planFingerprint: 'a'.repeat(64),
          slides: 1,
          editableSlides: 1,
          validated: true
        }
      }
    })
    let activeChildId = ''
    let activeWorkflowId = ''
    const sourceReader = makeSourceReader({
      prompt: (turnId) => turnId === 'turn-approved' ? '同意，生成 PPTX' : '创建一个 deck，直接生成，不需要方向选择',
      review: (turnId) => turnId === 'turn_main' || !activeChildId
        ? []
        : [{ workflowId: activeWorkflowId, childId: activeChildId }]
    })
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true
    }), sourceReader)
    const started = await tool.execute({ title: 'Review deck' }, baseContext)
    const childId = (started.output as { childId: string }).childId
    activeWorkflowId = (started.output as { workflowId: string }).workflowId
    activeChildId = childId

    await expect(tool.execute({
      action: 'approve_and_build',
      childId,
      workflowId: 'wrong-workflow',
      title: 'Build deck'
    }, { ...baseContext, turnId: 'turn-wrong' })).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('does not match') }
    })

    const approved = await tool.execute({
      action: 'approve_and_build',
      childId,
      workflowId: activeWorkflowId,
      title: 'Build deck'
    }, { ...baseContext, turnId: 'turn-approved' })
    expect(approved).toMatchObject({
      isError: false,
      output: {
        childId,
        phase: 'completed',
        mode: 'native',
        deckArtifact: { output: 'presentations/deck.pptx', editableSlides: 1, validated: true }
      }
    })
    expect(approved.output).not.toHaveProperty('reviewBundle')
    expect(calls[1]).toMatchObject({
      childId,
      resumeChild: true,
      parentTurnId: 'turn-approved'
    })
    expect(calls[1]?.blockedTools).not.toContain('ppt_export')
  })

  it('does not let a stale review bundle hide a failed revision turn', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let call = 0
    const runtime = makeRuntime(dir, async (input) => {
      call += 1
      if (call === 2) return { summary: 'forgot the bundle' }
      return {
        summary: 'review ready',
        reviewBundle: reviewBundle(input.childId, governedWorkflowId(input))
      }
    })
    let activeChildId = ''
    let activeWorkflowId = ''
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true
    }), makeSourceReader({
      review: (turnId) => turnId === 'turn_main' || !activeChildId
        ? []
        : [{ workflowId: activeWorkflowId, childId: activeChildId }]
    }))
    const started = await tool.execute({ title: 'Review deck' }, baseContext)
    const childId = (started.output as { childId: string }).childId
    activeWorkflowId = (started.output as { workflowId: string }).workflowId
    activeChildId = childId
    const revision = await tool.execute({
      action: 'revise_previews',
      childId,
      workflowId: activeWorkflowId,
      title: 'Revise deck'
    }, { ...baseContext, turnId: 'turn-revise' })
    expect(revision).toMatchObject({
      isError: true,
      output: { phase: 'failed_recoverable', error: 'PPT child completed without the required visual review bundle' }
    })
    expect(revision.output).not.toHaveProperty('reviewBundle')

    await expect(tool.execute({
      action: 'retry_failed',
      childId,
      workflowId: activeWorkflowId,
      title: 'Retry deck'
    }, { ...baseContext, turnId: 'turn-retry' })).resolves.toMatchObject({
      isError: false,
      output: { phase: 'awaiting_review', reviewBundle: { workflowId: activeWorkflowId } }
    })
  })

  it('retries an initial review failure before any review context exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let calls = 0
    const runtime = makeRuntime(dir, async (input) => {
      calls += 1
      return calls === 1
        ? { summary: 'stopped before review bundle' }
        : { summary: 'review ready', reviewBundle: reviewBundle(input.childId, governedWorkflowId(input)) }
    })
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true
    }), makeSourceReader({
      prompt: (turnId) => turnId === 'turn_main'
        ? '创建一个发布会介绍 PPT，直接生成，不需要方向选择'
        : '重试刚才失败的 PPT 子流程'
    }))
    const started = await tool.execute({ title: 'Review deck' }, baseContext)
    const childId = (started.output as { childId: string }).childId
    const workflowId = (started.output as { workflowId: string }).workflowId
    expect(started).toMatchObject({
      isError: true,
      output: { phase: 'failed_recoverable', error: expect.stringContaining('visual review bundle') }
    })

    await expect(tool.execute({
      action: 'retry_failed', childId, workflowId, title: 'Retry deck'
    }, { ...baseContext, turnId: 'turn-retry-initial' })).resolves.toMatchObject({
      isError: false,
      output: { phase: 'awaiting_review', reviewBundle: { workflowId } }
    })
  })

  it('refuses to approve an arbitrary terminal non-PPT child', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const runtime = makeRuntime(dir, async () => ({ summary: 'done' }))
    const general = await runtime.runChild({
      parentThreadId: 'thr_main',
      parentTurnId: 'turn_general',
      profile: 'general',
      prompt: 'general work',
      workspace: '/workspace',
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      signal: new AbortController().signal
    })
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true
    }), makeSourceReader({
      review: () => [{ workflowId: 'ppt_workflow', childId: general.id }]
    }))

    await expect(tool.execute({
      action: 'approve_and_build',
      childId: general.id,
      workflowId: 'ppt_workflow',
      title: 'Build deck'
    }, { ...baseContext, turnId: 'turn_approve_general' })).resolves.toMatchObject({ isError: true, output: { error: expect.stringContaining('no valid persisted review bundle') } })
  })

  it('fails a run that does not return a visual review bundle', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    const runtime = makeRuntime(dir, async () => ({ summary: 'stopped early' }))
    const tool = makeTool(runtime, () => ({
      enabled: true,
      imageAssets: true,
      imageGenAvailable: true
    }))
    const result = await tool.execute({ title: 'Review deck' }, baseContext)
    expect(result).toMatchObject({
      isError: true,
      output: {
        phase: 'failed_recoverable',
        error: 'PPT child completed without the required visual review bundle'
      }
    })
  })

  it('passes guiDesignCanvas into the child when the parent canvas is active', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let received: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async () => ({ summary: 'ok' }))
    const originalRunChild = runtime.runChild.bind(runtime)
    runtime.runChild = (async (input) => {
      received = { ...input, signal: undefined }
      return originalRunChild(input)
    }) as typeof runtime.runChild
    const tool = makeTool(runtime, () => ({ enabled: true }))
    await tool.execute(
      { title: 'Deck to board' },
      { ...baseContext, guiDesignCanvas: true }
    )
    expect(received?.guiDesignCanvas).toBe(true)
  })

  it('applies Lab model/provider/reasoning/fast overrides on top of the profile', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ppt-agent-tool-'))
    let received: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async () => ({ summary: 'ok' }))
    const originalRunChild = runtime.runChild.bind(runtime)
    runtime.runChild = (async (input) => {
      received = { ...input, signal: undefined }
      return originalRunChild(input)
    }) as typeof runtime.runChild
    const tool = makeTool(runtime, () => ({
      enabled: true,
      model: 'gpt-5.4',
      providerId: 'codex-2',
      reasoningEffort: 'medium',
      fast: true
    }))
    await tool.execute({ title: 'Build deck' }, baseContext)
    const inline = received?.inlineProfile as { profile: Record<string, unknown> }
    expect(inline.profile.model).toBe('gpt-5.4')
    expect(inline.profile.providerId).toBe('codex-2')
    expect(inline.profile.reasoningEffort).toBe('medium')
    expect(received?.serviceTier).toBe('priority')
    expect(received?.inheritedModel).toBe('main-model')
  })

  it('keeps the allow-list free of delegation, board and child-inert design tools (verdict B)', () => {
    const forbidden = [
      'delegate_task',
      'generate_subagent',
      'load_skill',
      'task_graph',
      'create_plan',
      // Verdict B: the parent, not this child, replays board tools.
      'ppt_to_board',
      'design_canvas',
      'design_create_screen',
      'design_update_shapes'
    ]
    for (const name of forbidden) {
      expect(PPT_AGENT_ALLOWED_TOOLS).not.toContain(name)
    }
    for (const name of ['write', 'edit', 'generate_image', 'ppt_read_guide', 'ppt_read_review_context', 'ppt_export']) {
      expect(PPT_AGENT_ALLOWED_TOOLS).toContain(name)
    }
    expect(PPT_AGENT_ALLOWED_TOOLS).not.toContain('bash')
  })
})
