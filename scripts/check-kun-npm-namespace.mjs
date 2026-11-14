#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { auditNamespace } from './lib/kun-npm-registry.mjs'

const [flag, output, ...extra] = process.argv.slice(2)
assert(flag === '--output' && output && !extra.length, 'Usage: check-kun-npm-namespace.mjs --output REPORT')
const path = resolve(output)
await mkdir(dirname(path), { recursive: true })
await writeFile(path, JSON.stringify({ schemaVersion: 1, kind: 'kun-npm-namespace-audit',
  readOnly: true, rightsVerified: false, state: 'running', registryWrites: false, distTagsChanged: false }) + '\n')
try {
  const release = JSON.parse(await readFile('kun/npm/release.json', 'utf8'))
  const report = await auditNamespace(release)
  await writeFile(path, JSON.stringify({ ...report, state: 'finished' }, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile(path, JSON.stringify({ schemaVersion: 1, kind: 'kun-npm-namespace-audit',
    readOnly: true, rightsVerified: false, state: 'failed', registryWrites: false, distTagsChanged: false,
    error: error.message }, null, 2) + '\n')
  throw error
}
