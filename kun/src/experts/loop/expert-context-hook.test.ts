import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ExpertService } from '../services/expert-service.js'
import { createExpertContextHook } from './expert-context-hook.js'
import type { LoopHookContext } from '../../seam/types.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('expert-context-hook', () => {
  let expertService: ExpertService
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'expert-hook-test-'))

    expertService = new ExpertService({
      pluginRoots: [],
      customExpertsDir: tempDir
    })

    await expertService.initialize()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should inject expert systemPrompt when expertId is set', async () => {
    // Create a mock expert
    const mockExpert = await expertService.createCustomExpert({
      name: 'Test Expert',
      description: 'A test expert',
      domainTags: ['testing'],
      profession: 'Testing',
      roleDefinition: 'You are a test expert. Always respond with "test".',
      skillRefs: [],
      quickPrompts: []
    })

    const hook = createExpertContextHook({ expertService })
    const ctx: LoopHookContext = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      expertId: mockExpert.id
    }

    await hook(ctx)

    expect(ctx.systemPrompt).toBe('You are a test expert. Always respond with "test".')
    expect(ctx.expertDisplayName).toBe('Test Expert')
    expect(ctx.expertProfession).toBe('Testing')
  })

  it('should skip injection when expertId is not set', async () => {
    const hook = createExpertContextHook({ expertService })
    const ctx: LoopHookContext = {
      threadId: 'thread-1',
      turnId: 'turn-1'
    }

    await hook(ctx)

    expect(ctx.systemPrompt).toBeUndefined()
  })

  it('should skip injection when expert is not found', async () => {
    const hook = createExpertContextHook({ expertService })
    const ctx: LoopHookContext = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      expertId: 'non-existent'
    }

    await hook(ctx)

    expect(ctx.systemPrompt).toBeUndefined()
  })

  it('should skip injection when expert is disabled', async () => {
    const mockExpert = await expertService.createCustomExpert({
      name: 'Disabled Expert',
      description: 'A disabled expert',
      domainTags: ['testing'],
      profession: 'Testing',
      roleDefinition: 'You are disabled.',
      skillRefs: [],
      quickPrompts: []
    })

    // Disable the expert
    await expertService.setEnabled(mockExpert.id, false)

    const hook = createExpertContextHook({ expertService })
    const ctx: LoopHookContext = {
      threadId: 'thread-1',
      turnId: 'turn-1',
      expertId: mockExpert.id
    }

    await hook(ctx)

    expect(ctx.systemPrompt).toBeUndefined()
  })

  it('uses the immutable execution snapshot after the source expert changes', async () => {
    const expert = await expertService.createCustomExpert({
      name: 'Snapshot Expert',
      description: 'A snapshot expert',
      domainTags: ['testing'],
      profession: 'Testing',
      roleDefinition: 'Original immutable rules.',
      behaviorRules: 'Cite evidence.',
      skillRefs: [],
      quickPrompts: []
    })
    await expertService.activate(expert.id)
    const executionProfile = expertService.createExecutionProfile(expert.id)
    if (!executionProfile) throw new Error('expected execution profile')
    expert.roleDefinition = 'Changed mutable rules.'

    const ctx: LoopHookContext = {
      threadId: 'thread-snapshot',
      turnId: 'turn-snapshot',
      executionProfile
    }
    await createExpertContextHook({ expertService })(ctx)

    expect(ctx.systemPrompt).toContain('Original immutable rules.')
    expect(ctx.systemPrompt).toContain('Cite evidence.')
    expect(ctx.systemPrompt).not.toContain('Changed mutable rules.')
  })

  it('rejects a tampered expert snapshot', async () => {
    const expert = await expertService.createCustomExpert({
      name: 'Tamper Expert',
      description: 'A tamper expert',
      domainTags: ['testing'],
      profession: 'Testing',
      roleDefinition: 'Trusted rules.',
      skillRefs: [],
      quickPrompts: []
    })
    await expertService.activate(expert.id)
    const executionProfile = expertService.createExecutionProfile(expert.id)
    if (!executionProfile || executionProfile.kind !== 'expert') throw new Error('expected expert profile')

    const ctx: LoopHookContext = {
      threadId: 'thread-tampered',
      turnId: 'turn-tampered',
      executionProfile: {
        ...executionProfile,
        snapshot: { ...executionProfile.snapshot, roleDefinition: 'Tampered rules.' }
      }
    }
    await createExpertContextHook({ expertService })(ctx)

    expect(ctx.systemPrompt).toBeUndefined()
  })
})
