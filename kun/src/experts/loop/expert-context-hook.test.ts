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
})
