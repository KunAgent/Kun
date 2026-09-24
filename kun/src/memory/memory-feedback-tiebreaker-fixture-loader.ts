import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { type MemoryRecord } from '../contracts/memory.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import {
  MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION,
  MemoryFeedbackTiebreakerFixtureFile,
  MemoryFeedbackTiebreakerManifest,
  type MemoryFeedbackTiebreakerFixture,
  type MemoryFeedbackTiebreakerManifestValue
} from './memory-feedback-tiebreaker-contracts.js'

const Hash = z.string().regex(/^[a-f0-9]{64}$/u)

const ChecksumsFile = z.object({
  schemaVersion: z.literal(1),
  evaluationVersion: z.literal(MEMORY_FEEDBACK_TIEBREAKER_EVALUATION_VERSION),
  algorithm: z.literal('sha256'),
  files: z.object({ fixture: Hash, manifest: Hash }).strict()
}).strict()

export type MemoryFeedbackTiebreakerDataset = {
  fixture: MemoryFeedbackTiebreakerFixture
  manifest: MemoryFeedbackTiebreakerManifestValue
  sourceHashes: z.infer<typeof ChecksumsFile>['files']
}

export const DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS = Object.freeze({
  fixture: fileURLToPath(new URL('./fixtures/memory-feedback-tiebreaker-fixtures.v1.json', import.meta.url)),
  manifest: fileURLToPath(new URL('./fixtures/memory-feedback-tiebreaker-manifest.v1.json', import.meta.url)),
  checksums: fileURLToPath(new URL('./fixtures/memory-feedback-tiebreaker-checksums.v1.json', import.meta.url))
})

export async function loadMemoryFeedbackTiebreakerDataset(
  paths = DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS
): Promise<MemoryFeedbackTiebreakerDataset> {
  const [fixtureText, manifestText, checksumsText] = await Promise.all([
    readFile(paths.fixture, 'utf8'),
    readFile(paths.manifest, 'utf8'),
    readFile(paths.checksums, 'utf8')
  ])
  return parseMemoryFeedbackTiebreakerDataset({ fixtureText, manifestText, checksumsText })
}

export function parseMemoryFeedbackTiebreakerDataset(input: {
  fixtureText: string
  manifestText: string
  checksumsText: string
}): MemoryFeedbackTiebreakerDataset {
  const fixture = MemoryFeedbackTiebreakerFixtureFile.parse(parseJson(input.fixtureText, 'fixture'))
  const manifest = MemoryFeedbackTiebreakerManifest.parse(parseJson(input.manifestText, 'manifest'))
  const checksums = ChecksumsFile.parse(parseJson(input.checksumsText, 'checksums'))
  const sourceHashes = {
    fixture: memoryFeedbackTiebreakerFileSha256(input.fixtureText),
    manifest: memoryFeedbackTiebreakerFileSha256(input.manifestText)
  }
  const errors: string[] = []

  requireEqual(sourceHashes.fixture, checksums.files.fixture, 'fixture checksum', errors)
  requireEqual(sourceHashes.manifest, checksums.files.manifest, 'manifest checksum', errors)
  requireEqual(sourceHashes.fixture, manifest.fixtureSha256, 'fixture manifest hash', errors)
  requireEqual(fixture.evaluationNow, manifest.evaluationNow, 'evaluationNow', errors)
  validateCounts(fixture, manifest, errors)
  validateLabels(fixture, errors)
  validateSplitIsolation(fixture, manifest, errors)
  validateAnonymousContent(fixture, errors)

  if (errors.length > 0) {
    throw new Error(`invalid memory feedback tiebreaker dataset: ${errors.join('; ')}`)
  }
  return { fixture, manifest, sourceHashes }
}

export function memoryFeedbackTiebreakerFileSha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/gu, '\n')).digest('hex')
}

function validateCounts(
  fixture: MemoryFeedbackTiebreakerFixture,
  manifest: MemoryFeedbackTiebreakerManifestValue,
  errors: string[]
): void {
  for (const partition of ['development', 'holdout'] as const) {
    const actual = fixture.cases.filter((item) => item.partition === partition).length
    requireEqual(actual, manifest.splitCounts[partition], `${partition} count`, errors)
  }
  for (const quota of manifest.stratumQuotas) {
    for (const partition of ['development', 'holdout'] as const) {
      const actual = fixture.cases.filter(
        (item) => item.partition === partition && item.stratum === quota.stratum
      ).length
      requireEqual(actual, quota[partition], `${partition} ${quota.stratum} quota`, errors)
    }
  }
}

function validateLabels(fixture: MemoryFeedbackTiebreakerFixture, errors: string[]): void {
  const records = new Map(fixture.records.map((record) => [record.id, record]))
  const nowMs = Date.parse(fixture.evaluationNow)
  for (const item of fixture.cases) {
    const noResult = item.stratum === 'no-result-control'
    if (noResult !== (item.expectedIds.length === 0)) {
      errors.push(`${item.id} no-result label mismatch`)
    }
    if (noResult && item.preferredPairs.length > 0) errors.push(`${item.id} no-result case has a preference`)
    if (!noResult && item.preferredPairs.length === 0) errors.push(`${item.id} lacks a preferred pair`)
    for (const id of item.expectedIds) {
      const record = records.get(id)
      if (record && !isAvailable(record, item.workspace, nowMs)) {
        errors.push(`${item.id} expects unavailable memory ${id}`)
      }
    }
  }
}

function isAvailable(record: MemoryRecord, workspace: string, nowMs: number): boolean {
  return memoryInScope(record, { workspace }) && memoryLifecycleState(record, nowMs) === 'active'
}

function validateSplitIsolation(
  fixture: MemoryFeedbackTiebreakerFixture,
  manifest: MemoryFeedbackTiebreakerManifestValue,
  errors: string[]
): void {
  const development = fixture.cases.filter((item) => item.partition === 'development')
  const holdout = fixture.cases.filter((item) => item.partition === 'holdout')
  for (const left of development) {
    for (const right of holdout) {
      const leftTokens = normalizedTokens(left.query)
      const rightTokens = normalizedTokens(right.query)
      const similarity = tokenJaccard(leftTokens, rightTokens)
      if (similarity >= manifest.normalization.nearDuplicateTokenJaccard) {
        errors.push(`${left.id} and ${right.id} are cross-split near-duplicates (${similarity.toFixed(3)})`)
      }
    }
  }
}

function normalizedTokens(value: string): ReadonlySet<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('und')
  return new Set(normalized.match(/[\p{L}\p{N}_]+/gu) ?? [])
}

function tokenJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const intersection = [...left].filter((token) => right.has(token)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 1 : intersection / union
}

function validateAnonymousContent(fixture: MemoryFeedbackTiebreakerFixture, errors: string[]): void {
  const values = [
    ...fixture.records.map((record) => record.content),
    ...fixture.cases.flatMap((item) => [item.query, item.rationale, ...item.preferredPairs.map((pair) => pair.rationale)])
  ]
  const forbiddenPatterns = [
    /(?:^|\s)[a-z]:[\\/]/iu,
    /\\\\[^\\\s]+\\[^\s]+/u,
    /file:\/\//iu,
    /(?:^|\s)\/(?:users|home|var|tmp|etc)\//iu,
    /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
  ]
  for (const value of values) {
    if (forbiddenPatterns.some((pattern) => pattern.test(value))) {
      errors.push('fixture contains a machine path, credential, or personal identifier')
      return
    }
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`invalid memory feedback tiebreaker ${label} JSON`)
  }
}

function requireEqual(actual: unknown, expected: unknown, label: string, errors: string[]): void {
  if (actual !== expected) errors.push(`${label} mismatch`)
}
