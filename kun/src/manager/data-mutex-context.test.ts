import { describe, expect, it } from 'vitest'
import {
  currentManagerDataCommitId, currentManagerDataMutexContext, runWithManagerDataCommitId,
  runWithManagerDataMutexContext, runWithoutManagerDataMutexContext,
  type ManagerDataMutexOperationContext
} from './data-mutex-context.js'

function context(resource: string): ManagerDataMutexOperationContext {
  return { resource, signal: new AbortController().signal, assertCurrent: async () => undefined,
    withCommit: async (operation) => operation() }
}

describe('Manager data mutex reservation scope', () => {
  it('does not reuse a thread reservation for a nested follow-up resource', async () => {
    await runWithManagerDataMutexContext(context('thread:one'), () =>
      runWithManagerDataCommitId('thread-commit', async () => {
        expect(currentManagerDataCommitId()).toBe('thread-commit')
        await runWithManagerDataMutexContext(context('followup'), async () => {
          expect(currentManagerDataCommitId()).toBeUndefined()
          await runWithManagerDataCommitId('followup-commit', async () => {
            expect(currentManagerDataCommitId()).toBe('followup-commit')
          })
          expect(currentManagerDataCommitId()).toBeUndefined()
        })
        expect(currentManagerDataCommitId()).toBe('thread-commit')
      }))
  })

  it('retains reentrant reservations of the same resource and strips both scopes on wake', async () => {
    await runWithManagerDataMutexContext(context('followup'), () =>
      runWithManagerDataCommitId('commit', async () => {
        await runWithManagerDataMutexContext(context('followup'), async () => {
          expect(currentManagerDataCommitId()).toBe('commit')
          await runWithoutManagerDataMutexContext(async () => {
            expect(currentManagerDataMutexContext()).toBeUndefined()
            expect(currentManagerDataCommitId()).toBeUndefined()
          })
          expect(currentManagerDataCommitId()).toBe('commit')
        })
      }))
    expect(currentManagerDataMutexContext()).toBeUndefined()
    expect(currentManagerDataCommitId()).toBeUndefined()
  })
})
