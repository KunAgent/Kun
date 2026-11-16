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
// Native receipts keep granular proof. Derive only criteria actually covered
// by those operations; an explicit not-run remains authoritative.
const EVIDENCE_GROUPS = {
  'NPM-01': ['NPM-01.project-install', 'NPM-01.global-install'],
  'NPM-02': ['NPM-02.payload'], 'NPM-03': ['NPM-03.locked-bundle'],
  'NPM-04': ['NPM-04.sqlite-native', 'NPM-04.runtime-index', 'RUN-04.pty-tui', 'RUN-04.pty-bare'],
  'NPM-05': ['NPM-05.help-version-update', 'NPM-05.exec-file'],
  'NPM-06': ['NPM-06.installed-entry-boundaries'],
  'RUN-01': ['RUN-01.run-jsonl', 'RUN-01.run-json', 'RUN-01.prompt-file', 'RUN-01.stdin-chat'],
  'RUN-02': ['RUN-02.config-env-cli-precedence', 'RUN-02.no-gui-config',
    'RUN-02.missing-credentials', 'RUN-02.invalid-config'],
  'RUN-03': ['RUN-03.endpoint-families'],
  'RUN-04': ['RUN-04.pty-tui', 'RUN-04.pty-bare', 'RUN-04.pty-cancel'],
  'RUN-05': ['RUN-05.http-thread-lifecycle', 'DATA-01.reopen'],
  'RUN-06': ['RUN-06.sse-replay', 'RUN-06.interrupt'],
  'RUN-09': ['RUN-09.non-gui-extension', 'RUN-07.skills-mcp'],
  'LIFE-01': ['LIFE-01.owned-serve-exit', 'LIFE-01.serve-shutdown-order', 'LIFE-01.tui-shutdown-order',
    'LIFE-01.attached-shutdown-order', 'RUN-07.skills-mcp'],
  'LIFE-02': ['LIFE-02.startup-failure', 'LIFE-02.owner-loss-shutdown-order', 'LIFE-02.manager-readiness-failure'],
  'LIFE-03': ['LIFE-03.owner-conflict', 'LIFE-03.isolated-profiles'],
  'LIFE-04': ['LIFE-04.attached-tui', 'LIFE-01.attached-shutdown-order'],
  'DATA-01': ['DATA-01.historical-artifact-origin', 'DATA-01.reopen-npm', 'DATA-01.reopen-replacement-path'],
  'DATA-02': ['DATA-02.old-reader-refuses-unsupported-schema', 'DATA-02.uninstall-preserves-history',
    'NPM-05.help-version-update']
}

function criterionStatus(receipt, id) {
  const explicit = receipt.checks?.find(check => check.id === id)
  if (explicit) return explicit.status
  const group = EVIDENCE_GROUPS[id]
  return group?.every(required => receipt.checks?.some(check => check.id === required && check.status === 'pass'))
    ? 'pass' : undefined
}
const SMOKE_CHECKS = [
  'NPM-01.project-install', 'NPM-01.global-install', 'NPM-02.payload',
  'NPM-03.locked-bundle', 'NPM-04.sqlite-native', 'NPM-05.help-version-update',
  'RUN-01.run-jsonl', 'RUN-05.http-thread-lifecycle', 'LIFE-01.owned-serve-exit',
  'NPM-04.runtime-index', 'RUN-04.pty-tui', 'RUN-04.pty-bare', 'RUN-04.pty-cancel',
  'LIFE-01.serve-shutdown-order', 'LIFE-01.tui-shutdown-order', 'LIFE-01.attached-shutdown-order',
  'LIFE-02.owner-loss-shutdown-order', 'LIFE-02.manager-readiness-failure'
]

export function checkMatrix(receipts, release, { complete = true, supplements = [] } = {}) {
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
    if (release.name && receipt.packageName !== release.name) errors.push(`Unexpected package name: ${key}`)
    if (release.version && receipt.packageVersion !== release.version) errors.push(`Unexpected package version: ${key}`)
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
        if (criterionStatus(receipt, id) !== 'pass') errors.push(`Incomplete ${id}: ${key}`)
      for (const id of ['RUN-04.pty-tui', 'RUN-04.pty-bare']) {
        const check = receipt.checks?.find(value => value.id === id)
        if (check?.detail?.terminalKind !== 'windows-conpty' || check.detail.forcedExit !== false)
          errors.push(`No real ConPTY evidence ${id}: ${key}`)
      }
    }
    if (complete) {
      for (const id of NATIVE_CHECKS) {
        if (criterionStatus(receipt, id) !== 'pass') errors.push(`Incomplete ${id}: ${key}`)
      }
    }
  }
  if (candidates.size !== 1) errors.push('Receipts must verify one identical main tarball and package version')
  for (const receipt of supplements) {
    const identity = receipt.packageName + '@' + receipt.packageVersion + ':' + receipt.tarballSha256
    if (!['kun-npm-global-artifact-evidence', 'kun-npm-supplementary-artifact-acceptance'].includes(receipt.kind) ||
      receipt.schemaVersion !== 1 || receipt.success !== true || !candidates.has(identity) ||
      !receipts.some(native => native.buildId === receipt.buildId))
      errors.push('Supplementary evidence does not verify this candidate: ' + (receipt.kind ?? 'unknown'))
    for (const check of receipt.checks ?? []) {
      if (check.status === 'fail') errors.push('Failed supplementary ' + check.id)
    }
  }
  for (const target of release.targets) {
    for (const version of release.testNodeVersions) {
      if (!slots.has(`${target}/${version}`)) errors.push(`Missing target: ${target}/${version}`)
    }
  }
  const expected = new Set(release.targets.flatMap(t => release.testNodeVersions.map(v => `${t}/${v}`)))
  for (const key of slots.keys()) if (!expected.has(key)) errors.push(`Unexpected target: ${key}`)
  if (complete) {
    const passed = (values, id) => values.some(value => criterionStatus(value, id) === 'pass')
    for (const id of GLOBAL_CHECKS) if (!passed([...receipts, ...supplements], id)) errors.push(`Incomplete ${id}: matrix`)
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
      if (value.schemaVersion === 1 && Array.isArray(value.checks) &&
        (!value.kind || value.kind === 'kun-npm-native-install-receipt')) result.push(value)
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
