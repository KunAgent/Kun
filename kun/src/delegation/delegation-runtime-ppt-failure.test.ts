import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChildResultExecutionError } from './child-result-materializer.js'
import { validPptDirectionBundle, validPptReviewBundle } from './child-ppt-test-fixtures.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

const config = {
  enabled: true,
  useExistingAgents: true,
  maxParallel: 1,
  proactiveRetry: { enabled: true, maxAttempts: 3 },
  defaultToolPolicy: 'readOnly' as const,
  profiles: {}
}

describe('DelegationRuntime PPT failure projection', () => {
  it('persists schema-verified structured results and their parent-turn fences on failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-ppt-failure-projection-'))
    try {
      const direction = validPptDirectionBundle('child_ppt_failure')
      const review = validPptReviewBundle('child_ppt_failure')
      const runtime = new DelegationRuntime({
        config, store: new FileDelegationStore(dir), idGenerator: () => 'child_ppt_failure',
        executor: async () => {
          throw new ChildResultExecutionError('failed after producing PPT state', {
            summary: 'direction and review tools completed before the fatal error',
            directionBundle: direction,
            reviewBundle: review,
            deckArtifact: {
              output: 'presentations/deck.pptx', slides: 1, editableSlides: 1, validated: true
            }
          })
        }
      })
      const record = await runtime.runChild({
        parentThreadId: 'parent', parentTurnId: 'turn_failure', prompt: 'build directions',
        signal: new AbortController().signal
      })

      expect(record).toMatchObject({
        status: 'failed', directionBundle: direction, directionBundleParentTurnId: 'turn_failure',
        reviewBundle: review, reviewBundleParentTurnId: 'turn_failure',
        deckArtifact: { validated: true }, deckArtifactParentTurnId: 'turn_failure'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not persist ordinary errors or forged structured failure payloads', async () => {
    for (const forged of [false, true]) {
      const dir = await mkdtemp(join(tmpdir(), 'kun-ppt-failure-reject-'))
      try {
        const runtime = new DelegationRuntime({
          config, store: new FileDelegationStore(dir), idGenerator: () => 'child_ppt_failure',
          executor: async () => {
            if (!forged) throw new Error('ordinary provider failure')
            throw new ChildResultExecutionError('forged payload', {
              summary: 'untrusted',
              directionBundle: { ...validPptDirectionBundle(), childId: 'foreign_child' },
              reviewBundle: { ...validPptReviewBundle(), childId: 'foreign_child' },
              deckArtifact: { output: 'deck.pptx', validated: true }
            })
          }
        })
        const record = await runtime.runChild({
          parentThreadId: 'parent', parentTurnId: 'turn_failure', prompt: 'build directions',
          signal: new AbortController().signal
        })
        expect(record).not.toHaveProperty('directionBundle')
        expect(record).not.toHaveProperty('reviewBundle')
        expect(record).not.toHaveProperty('deckArtifact')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })
})
