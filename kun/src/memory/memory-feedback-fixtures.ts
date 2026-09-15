import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import { MemoryRecord, type MemoryRecord as MemoryRecordValue } from '../contracts/memory.js'

export const MEMORY_FEEDBACK_FIXTURE_DATASET_ID = 'kun-memory-feedback-anonymous-v1'

const FixtureCase = z.object({
  id: z.string().regex(/^case_[a-z0-9_]+$/u),
  query: z.string().min(1),
  workspace: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).min(1),
  expectedIds: z.array(z.string().min(1)).min(1),
  forbiddenIds: z.array(z.string().min(1)).min(1),
  limit: z.number().int().positive().max(64)
}).strict()
export type MemoryFeedbackFixtureCase = z.infer<typeof FixtureCase>

const FixtureFile = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal(MEMORY_FEEDBACK_FIXTURE_DATASET_ID),
  status: z.literal('frozen'),
  evaluationNow: z.string().datetime(),
  records: z.array(MemoryRecord).min(1),
  events: z.array(MemoryFeedbackEvent).min(1),
  cases: z.array(FixtureCase).min(1)
}).strict()

const ChecksumFile = z.object({
  schemaVersion: z.literal(1),
  datasetId: z.literal(MEMORY_FEEDBACK_FIXTURE_DATASET_ID),
  algorithm: z.literal('sha256'),
  fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict()

export type MemoryFeedbackFixtureDataset = {
  evaluationNow: string
  records: MemoryRecordValue[]
  events: MemoryFeedbackEvent[]
  cases: MemoryFeedbackFixtureCase[]
  fixtureSha256: string
}

export const DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS = Object.freeze({
  fixture: fileURLToPath(new URL('./fixtures/memory-feedback-fixtures.v1.json', import.meta.url)),
  checksum: fileURLToPath(new URL('./fixtures/memory-feedback-checksums.v1.json', import.meta.url))
})

export async function loadMemoryFeedbackFixtures(
  paths = DEFAULT_MEMORY_FEEDBACK_FIXTURE_PATHS
): Promise<MemoryFeedbackFixtureDataset> {
  const [fixtureText, checksumText] = await Promise.all([
    readFile(paths.fixture, 'utf8'),
    readFile(paths.checksum, 'utf8')
  ])
  const fixture = FixtureFile.parse(parseJson(fixtureText, 'fixture'))
  const checksum = ChecksumFile.parse(parseJson(checksumText, 'checksum'))
  const actualHash = memoryFeedbackFixtureSha256(fixtureText)
  if (actualHash !== checksum.fixtureSha256) throw new Error('memory feedback fixture checksum mismatch')
  validateFixtureReferences(fixture)
  return { ...fixture, fixtureSha256: actualHash }
}

export function memoryFeedbackFixtureSha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex')
}

function validateFixtureReferences(fixture: z.infer<typeof FixtureFile>): void {
  const records = new Map(fixture.records.map((record) => [record.id, record]))
  requireUnique(fixture.records.map((record) => record.id), 'record ids')
  requireUnique(fixture.events.map((event) => event.id), 'event ids')
  requireUnique(fixture.cases.map((item) => item.id), 'case ids')

  for (const event of fixture.events) {
    if (!records.has(event.memoryId)) throw new Error(`feedback event references unknown memory: ${event.memoryId}`)
    if (event.kind === 'corrected') {
      const replacement = records.get(event.replacementMemoryId)
      if (!replacement || replacement.supersedes !== event.memoryId) {
        throw new Error(`correction event has invalid replacement: ${event.id}`)
      }
    }
  }
  for (const item of fixture.cases) {
    const ids = [...item.candidateIds, ...item.expectedIds, ...item.forbiddenIds]
    for (const id of ids) {
      if (!records.has(id)) throw new Error(`feedback case references unknown memory: ${id}`)
    }
    requireUnique(item.candidateIds, `${item.id} candidate ids`)
    requireUnique(item.expectedIds, `${item.id} expected ids`)
    requireUnique(item.forbiddenIds, `${item.id} forbidden ids`)
  }
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid memory feedback ${name} JSON`)
  }
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`memory feedback ${label} must be unique`)
}
