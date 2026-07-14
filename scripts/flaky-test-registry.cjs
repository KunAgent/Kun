'use strict'

const { readFile } = require('node:fs/promises')

const REGISTRY_VERSION = 1
const MAX_RECORDS = 512
const MAX_TEST_LENGTH = 256
const MAX_OWNER_LENGTH = 128
const MAX_ISSUE = 1_000_000
const PLATFORMS = new Set(['linux', 'windows', 'macos'])
const REQUIRED_KEYS = new Set(['test', 'owner', 'firstSeenAt', 'expiresAt'])
const OPTIONAL_KEYS = new Set(['platform', 'issue', 'failureRate'])

function validateFlakyTestRegistry(value, now = new Date()) {
  const errors = []
  if (!isRecord(value)) {
    return { valid: false, errors: ['registry must be an object'], records: [] }
  }
  if (value.version !== REGISTRY_VERSION) {
    errors.push(`version must be ${REGISTRY_VERSION}`)
  }
  if (!Array.isArray(value.records)) {
    errors.push('records must be an array')
    return { valid: false, errors, records: [] }
  }
  if (value.records.length > MAX_RECORDS) {
    errors.push(`records must contain at most ${MAX_RECORDS} entries`)
  }

  const seen = new Set()
  const records = []
  for (const [index, record] of value.records.entries()) {
    const prefix = `records[${index}]`
    if (!isRecord(record)) {
      errors.push(`${prefix} must be an object`)
      continue
    }
    for (const key of Object.keys(record)) {
      if (!REQUIRED_KEYS.has(key) && !OPTIONAL_KEYS.has(key)) {
        errors.push(`${prefix}.${key} is not supported`)
      }
    }
    const test = typeof record.test === 'string' ? record.test.trim() : ''
    const owner = typeof record.owner === 'string' ? record.owner.trim() : ''
    if (!test || test.length > MAX_TEST_LENGTH) errors.push(`${prefix}.test must be 1-${MAX_TEST_LENGTH} characters`)
    if (!owner || owner.length > MAX_OWNER_LENGTH) errors.push(`${prefix}.owner must be 1-${MAX_OWNER_LENGTH} characters`)

    const platform = record.platform
    if (platform !== undefined && (typeof platform !== 'string' || !PLATFORMS.has(platform))) {
      errors.push(`${prefix}.platform must be linux, windows, or macos`)
    }
    if (record.issue !== undefined && (!Number.isSafeInteger(record.issue) || record.issue < 1 || record.issue > MAX_ISSUE)) {
      errors.push(`${prefix}.issue must be a positive issue number`)
    }
    if (record.failureRate !== undefined && (typeof record.failureRate !== 'number' || !Number.isFinite(record.failureRate) || record.failureRate < 0 || record.failureRate > 1)) {
      errors.push(`${prefix}.failureRate must be between 0 and 1`)
    }
    if (record.issue === undefined) errors.push(`${prefix}.issue is required`)

    const firstSeen = parseDate(record.firstSeenAt)
    const expires = parseDate(record.expiresAt)
    if (!firstSeen) errors.push(`${prefix}.firstSeenAt must be an ISO date`)
    if (!expires) errors.push(`${prefix}.expiresAt must be an ISO date`)
    if (expires && expires <= now.getTime()) errors.push(`${prefix}.expiresAt must be in the future`)
    if (firstSeen && expires && firstSeen > expires) errors.push(`${prefix}.firstSeenAt must not be after expiresAt`)

    const key = `${test}\u0000${platform ?? '*'}`
    if (seen.has(key)) errors.push(`${prefix} duplicates ${test}${platform ? ` on ${platform}` : ''}`)
    seen.add(key)
    records.push({ ...record, test, owner })
  }
  return { valid: errors.length === 0, errors, records }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

async function main(argv = process.argv.slice(2)) {
  const fileIndex = argv.indexOf('--file')
  const filePath = fileIndex >= 0 ? argv[fileIndex + 1] : undefined
  if (!filePath || argv.some((arg, index) => arg === '--file' && !argv[index + 1])) {
    throw new Error('Usage: node scripts/flaky-test-registry.cjs --file <registry.json>')
  }
  const parsed = JSON.parse(await readFile(filePath, 'utf8'))
  const result = validateFlakyTestRegistry(parsed)
  if (!result.valid) {
    process.stderr.write(`Flaky test registry invalid:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Flaky test registry valid: ${result.records.length} record(s)\n`)
}

module.exports = {
  MAX_RECORDS,
  REGISTRY_VERSION,
  validateFlakyTestRegistry
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
