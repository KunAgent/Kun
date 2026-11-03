import { describe, expect, it, vi } from 'vitest'
import { GoogleWorkspaceModelPolicyError } from '../src/domain/google-workspace-model-policy.js'
import { GoogleWorkspaceModelClient } from '../src/gmail/model-data-policy.js'
import { withModelTiming } from '../src/loop/model-timing-decorator.js'
import { bootstrapThread, makeHarness, makeSilentModel } from './loop-test-harness.js'

describe('Gmail delegated history dispatch boundary', () => {
  it('rejects a sensitive turn before a delegated SDK receives the prompt or history', async () => {
    const inner = makeSilentModel()
    const wrapped = new GoogleWorkspaceModelClient(inner, {
      selection: async () => ({ model: 'model' }),
      dataState: async () => ({ sensitive: true, sharingAllowed: true })
    })
    const model = withModelTiming(wrapped)
    const runTurn = vi.fn(async () => 'completed' as const)
    const h = makeHarness(model, { sdkRuntime: { handlesProvider: () => true, runTurn } as never })
    await bootstrapThread(h)
    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')
    expect(runTurn).not.toHaveBeenCalled()
    expect((await h.threadStore.get(h.threadId))!.turns[0].status).toBe('failed')
  })

  it('preserves ordinary SDK conversations while refusing Google-data history even after consent changes', async () => {
    let sensitive = false
    const wrapped = new GoogleWorkspaceModelClient(makeSilentModel(), {
      selection: async () => ({ model: 'model' }),
      dataState: async () => ({ sensitive, sharingAllowed: false })
    })
    const model = withModelTiming(wrapped)
    await expect(model.assertGoogleWorkspaceDelegatedHistory!('thread')).resolves.toBeUndefined()
    sensitive = true
    await expect(model.assertGoogleWorkspaceDelegatedHistory!('thread')).rejects.toBeInstanceOf(GoogleWorkspaceModelPolicyError)
  })
})
