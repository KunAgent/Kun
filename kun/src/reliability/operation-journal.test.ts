import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FileOperationJournal,
  hashOperationInput,
  operationIdFor,
  type OperationIdentity
} from './operation-journal.js'

describe('FileOperationJournal', () => {
  let rootDir = ''
  let now = '2026-07-01T00:00:00.000Z'

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-operation-journal-'))
    now = '2026-07-01T00:00:00.000Z'
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('reuses only a completed result from the same call identity', async () => {
    const journal = new FileOperationJournal(rootDir, () => now)
    const input = operation()
    expect(await journal.inspect(input)).toEqual({
      kind: 'new',
      operationId: operationIdFor(input.threadId, input.callId)
    })
    const started = await journal.start(input)
    now = '2026-07-01T00:00:01.000Z'
    await journal.complete(started.operationId, { output: { deployed: true } })

    expect(await journal.inspect(input)).toMatchObject({
      kind: 'reuse',
      result: { output: { deployed: true } }
    })
    expect(await journal.inspect({ ...input, arguments: { target: 'other' } })).toMatchObject({
      kind: 'collision'
    })
  })

  it('requires confirmation for uncertain mutating calls but permits declared safe replay', async () => {
    const journal = new FileOperationJournal(rootDir, () => now)
    const input = operation()
    await journal.start(input)

    expect(await journal.inspect(input)).toMatchObject({ kind: 'uncertain' })
    expect(await journal.inspect({ ...input, replaySafe: true })).toMatchObject({ kind: 'replay-safe' })
  })

  it('does not persist oversized results for implicit replay', async () => {
    const journal = new FileOperationJournal(rootDir, () => now)
    const input = operation()
    const started = await journal.start(input)
    await journal.complete(started.operationId, { output: 'x'.repeat(70 * 1024) })

    expect(await journal.inspect(input)).toMatchObject({
      kind: 'uncertain',
      record: { status: 'completed', resultStored: false }
    })
  })

  it('hashes equivalent argument objects canonically', () => {
    expect(hashOperationInput('deploy', { b: 2, a: { y: 2, x: 1 } })).toBe(
      hashOperationInput('deploy', { a: { x: 1, y: 2 }, b: 2 })
    )
  })
})

function operation(): OperationIdentity {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    callId: 'call_1',
    toolName: 'deploy',
    arguments: { target: 'production' },
    replaySafe: false
  }
}
