'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { validateFlakyTestRegistry } = require('./flaky-test-registry.cjs')

const future = '2099-01-01T00:00:00.000Z'
const firstSeen = '2026-07-01T00:00:00.000Z'

function record(overrides = {}) {
  return {
    test: 'PR Checks / Typecheck and test',
    owner: 'runtime',
    issue: 885,
    firstSeenAt: firstSeen,
    expiresAt: future,
    ...overrides
  }
}

test('accepts a bounded record with issue and expiry', () => {
  const result = validateFlakyTestRegistry({ version: 1, records: [record()] })
  assert.equal(result.valid, true)
  assert.equal(result.records[0].owner, 'runtime')
})

test('requires issue and future expiry so quarantine cannot become permanent', () => {
  const result = validateFlakyTestRegistry({ version: 1, records: [
    record({ issue: undefined, expiresAt: '2020-01-01T00:00:00.000Z' })
  ] })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /issue is required/)
  assert.match(result.errors.join('\n'), /expiresAt must be in the future/)
})

test('requires timestamps with an explicit ISO timezone', () => {
  const result = validateFlakyTestRegistry({ version: 1, records: [
    record({ firstSeenAt: '2026-07-01', expiresAt: '2099-01-01' })
  ] })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /firstSeenAt must be an ISO date/)
  assert.match(result.errors.join('\n'), /expiresAt must be an ISO date/)
})

test('rejects duplicate tests on one platform but allows separate platforms', () => {
  const duplicate = validateFlakyTestRegistry({ version: 1, records: [
    record({ platform: 'linux' }),
    record({ platform: 'linux' })
  ] })
  assert.equal(duplicate.valid, false)
  const split = validateFlakyTestRegistry({ version: 1, records: [
    record({ platform: 'linux' }),
    record({ platform: 'windows' })
  ] })
  assert.equal(split.valid, true)
})

test('bounds failure rates, platforms, and unknown fields', () => {
  const result = validateFlakyTestRegistry({ version: 1, records: [
    record({ platform: 'darwin', failureRate: 1.2, unexpected: true })
  ] })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /platform must be/)
  assert.match(result.errors.join('\n'), /failureRate must be/)
  assert.match(result.errors.join('\n'), /unexpected is not supported/)
})

test('rejects invalid registry version and oversized record sets', () => {
  const result = validateFlakyTestRegistry({ version: 2, records: Array.from({ length: 513 }, (_, index) => record({ test: `test-${index}` })) })
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /version must be 1/)
  assert.match(result.errors.join('\n'), /at most 512 entries/)
})
