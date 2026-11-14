#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ARTIFACT_CHECKS = [
  ...Array.from({ length: 6 }, (_, i) => `NPM-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 9 }, (_, i) => `RUN-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `LIFE-${String(i + 1).padStart(2, '0')}`),
  'DATA-01', 'DATA-02', 'GUI-01', 'DOC-01'
]
const NATIVE_CHECKS = ['NPM-01', 'NPM-02', 'NPM-03', 'NPM-04', 'NPM-05',
  'RUN-01', 'RUN-04', 'RUN-05', 'LIFE-01']
const GLOBAL_CHECKS = ['NPM-06', 'GUI-01', 'DOC-01']
const SMOKE_CHECKS = [
  'NPM-01.project-install', 'NPM-01.global-install', 'NPM-02.payload',
  'NPM-03.locked-bundle', 'NPM-04.sqlite-native', 'NPM-05.help-version-update',
  'RUN-01.run-jsonl', 'RUN-05.http-thread-lifecycle', 'LIFE-01.owned-serve-exit',
  'NPM-04.runtime-index', 'RUN-04.pty-tui', 'RUN-04.pty-bare', 'RUN-04.pty-cancel'
]

export function checkMatrix(receipts, release, { complete = true } = {}) {
  const errors = []
  const slots = new Map()
  const candidates = new Set()
  for (const receipt of receipts) {
    const key = `${receipt.platform}-${receipt.arch}/${receipt.nodeVersion}`
    if (slots.has(key)) errors.push(`Duplicate receipt: ${key}`)
    slots.set(key, receipt)
    if (receipt.schemaVersion !== 1) errors.push(`Unsupported receipt schema: ${key}`)
    if (!/^[a-f0-9]{64}$/.test(receipt.tarballSha256 ?? '')) errors.push(`Invalid artifact digest: ${key}`)
    if (receipt.success !== true) errors.push(`Smoke did not succeed: ${key}`)
    if (!receipt.isolation?.sourceCheckoutRemoved || receipt.isolation.gitHistoryAvailable !== false ||
      !receipt.isolation.exportedDriverVerified) errors.push(`Source isolation was not certified: ${key}`)
    candidates.add(`${receipt.packageName}@${receipt.packageVersion}:${receipt.tarballSha256}`)
    const checks = new Map()
    for (const check of receipt.checks ?? []) {
      if (checks.has(check.id)) errors.push(`Duplicate check ${check.id}: ${key}`)
      checks.set(check.id, check.status)
      if (check.status === 'fail') errors.push(`Failed ${check.id}: ${key}`)
    }
    for (const id of SMOKE_CHECKS) {
      if (checks.get(id) !== 'pass') errors.push(`Incomplete ${id}: ${key}`)
    }
    if (receipt.platform === 'win32') {
      for (const id of ['NPM-04.windows-native-job', 'NPM-04.windows-helper-missing', 'NPM-04.windows-helper-corrupt'])
        if (checks.get(id) !== 'pass') errors.push(`Incomplete ${id}: ${key}`)
      for (const id of ['RUN-04.pty-tui', 'RUN-04.pty-bare']) {
        const check = receipt.checks?.find(value => value.id === id)
        if (check?.detail?.terminalKind !== 'windows-conpty' || check.detail.forcedExit !== false)
          errors.push(`No real ConPTY evidence ${id}: ${key}`)
      }
    }
    if (complete) {
      for (const id of NATIVE_CHECKS) {
        if (checks.get(id) !== 'pass') errors.push(`Incomplete ${id}: ${key}`)
      }
    }
  }
  if (candidates.size !== 1) errors.push('Receipts must verify one identical main tarball and package version')
  for (const target of release.targets) {
    for (const version of release.testNodeVersions) {
      if (!slots.has(`${target}/${version}`)) errors.push(`Missing target: ${target}/${version}`)
    }
  }
  const expected = new Set(release.targets.flatMap(t => release.testNodeVersions.map(v => `${t}/${v}`)))
  for (const key of slots.keys()) if (!expected.has(key)) errors.push(`Unexpected target: ${key}`)
  if (complete) {
    const passed = (values, id) => values.some(value => value.checks?.some(c => c.id === id && c.status === 'pass'))
    for (const id of GLOBAL_CHECKS) if (!passed(receipts, id)) errors.push(`Incomplete ${id}: matrix`)
    for (const platform of new Set(release.targets.map(t => t.split('-')[0]))) {
      const family = receipts.filter(r => r.platform === platform)
      for (const id of ARTIFACT_CHECKS.filter(id => !NATIVE_CHECKS.includes(id) && !GLOBAL_CHECKS.includes(id))) {
        if (!passed(family, id)) errors.push(`Incomplete ${id}: ${platform} family`)
      }
    }
  }
  return { schemaVersion: 1, complete, success: errors.length === 0, receipts: receipts.length, errors }
}

async function readReceipts(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...await readReceipts(path))
    else if (entry.name.endsWith('.json')) {
      const value = JSON.parse(await readFile(path, 'utf8'))
      if (value.schemaVersion === 1 && Array.isArray(value.checks)) result.push(value)
    }
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, mode, ...extra] = process.argv.slice(2)
  assert(directory && !extra.length && (!mode || ['--smoke-only', '--report-only'].includes(mode)),
    'Usage: node scripts/check-kun-npm-matrix.mjs RECEIPT_DIRECTORY [--smoke-only|--report-only]')
  const release = JSON.parse(await readFile(new URL('../kun/npm/release.json', import.meta.url), 'utf8'))
  const result = checkMatrix(await readReceipts(resolve(directory)), release, { complete: mode !== '--smoke-only' })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (mode === '--report-only') await writeFile('artifact-readiness.json', JSON.stringify(result, null, 2) + '\n')
  else if (!result.success) process.exitCode = 1
}
