import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryArtifactStore } from '../artifacts/artifact-store.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'
import { childResultOwnerIds } from './child-result-materializer.js'

describe('delegation result retention', () => {
  it('preserves structured outputs while publishing only the bounded result projection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-child-result-record-'))
    try {
      const events: unknown[] = []
      const runtime = new DelegationRuntime({
        config: {
          enabled: true,
          useExistingAgents: true,
          maxParallel: 1,
          proactiveRetry: { enabled: true, maxAttempts: 3 },
          defaultToolPolicy: 'readOnly',
          profiles: {}
        },
        store: new FileDelegationStore(dir),
        events: { record: async (event: unknown) => { events.push(event) } } as never,
        executor: async () => ({
          summary: 'bounded preview',
          summaryTruncated: true,
          resultRef: {
            artifactId: 'art_result',
            byteSize: 100_000,
            lineCount: 3_000,
            mimeType: 'text/markdown'
          },
          evidence: ['read source.ts: completed'],
          reviewBundle: { verdict: 'pass' },
          deckArtifact: { output: 'deck.pptx', validated: true }
        })
      })
      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'inspect',
        returnFormat: 'evidence',
        signal: new AbortController().signal
      })

      expect(record).toMatchObject({
        status: 'completed',
        summary: 'bounded preview',
        summaryTruncated: true,
        resultRef: { artifactId: 'art_result' },
        evidence: ['read source.ts: completed'],
        reviewBundle: { verdict: 'pass' },
        deckArtifact: { output: 'deck.pptx', validated: true }
      })
      expect(events.at(-1)).toMatchObject({
        text: 'bounded preview',
        child: {
          summaryTruncated: true,
          resultRef: { artifactId: 'art_result' }
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('releases deduplicated artifacts after the parent and all child owners are deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-child-result-retention-'))
    try {
      const artifacts = new InMemoryArtifactStore()
      let nextId = 0
      const runtime = new DelegationRuntime({
        config: {
          enabled: true,
          useExistingAgents: true,
          maxParallel: 2,
          proactiveRetry: { enabled: true, maxAttempts: 3 },
          defaultToolPolicy: 'readOnly',
          profiles: {}
        },
        store: new FileDelegationStore(dir),
        artifactStore: artifacts,
        idGenerator: () => `child_${++nextId}`,
        executor: async (input) => {
          const stored = await artifacts.put({
            content: 'same oversized result',
            linkedOwners: childResultOwnerIds(input.parentThreadId, input.childId)
          })
          return {
            summary: 'preview',
            summaryTruncated: true,
            resultRef: {
              artifactId: stored.meta.id,
              byteSize: stored.meta.byteSize,
              lineCount: stored.meta.lineCount,
              mimeType: 'text/markdown'
            }
          }
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent', parentTurnId: 'turn', prompt: 'one',
        signal: new AbortController().signal
      })
      const second = await runtime.runChild({
        parentThreadId: 'parent', parentTurnId: 'turn', prompt: 'two',
        signal: new AbortController().signal
      })
      expect(first.resultRef?.artifactId).toBe(second.resultRef?.artifactId)
      expect((await artifacts.stat(first.resultRef!.artifactId))?.linkedOwners).toEqual([
        'thread:parent', 'child:child_1', 'child:child_2'
      ])

      const deletedSideThreads: string[] = []
      await runtime.cleanupThreadDeletion('parent', async (childId) => {
        deletedSideThreads.push(childId)
        return true
      })
      expect(deletedSideThreads).toEqual(['child_1', 'child_2'])
      expect(await artifacts.get(first.resultRef!.artifactId)).toBeNull()
      expect((await runtime.diagnostics('parent')).childRuns).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
