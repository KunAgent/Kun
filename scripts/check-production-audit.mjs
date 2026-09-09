#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://registry.npmjs.org'
const npmCliPath = process.env.npm_execpath
const npmCommand = npmCliPath ? process.execPath : 'npm'
const npmPrefixArgs = npmCliPath ? [npmCliPath] : []
const allowedModeratePackages = new Set([
  '@computer-use/default-clipboard-provider',
  '@computer-use/libnut',
  '@computer-use/nut-js',
  '@computer-use/provider-interfaces',
  '@computer-use/shared',
  '@jimp/core',
  '@jimp/custom',
  'adm-zip',
  'file-type',
  'jimp',
  'onnxruntime-node'
])
const allowedAdvisories = new Set([
  'https://github.com/advisories/GHSA-5v7r-6r5c-r473',
  'https://github.com/advisories/GHSA-vwc7-r8mq-g2x9'
])

// nut-js still pins Jimp 0.22 and has no compatible upstream update. Kun only
// uses nut-js for native screen pixels/input and converts captures through its
// separate Jimp 1.6 dependency; it never sends untrusted files through the old
// Jimp/file-type loader. Keep this exact advisory visible while failing closed
// on any new moderate advisory or any high/critical production vulnerability.
//
// onnxruntime-node 1.23.2 is the newest release that still ships both macOS
// arm64 and x64 binaries. Its adm-zip dependency is loaded only by the package
// install script; Kun sets onnxruntime-node-install=skip, so no archive is
// extracted, and neither adm-zip nor that script ships in a runtime execution
// path. Pin 0.6.0 to remove the allocation advisory and track the remaining
// symlink-extraction advisory exactly until upstream publishes a fixed release
// with macOS x64 support.

for (const target of [
  { name: 'root', cwd: repositoryRoot },
  { name: 'kun', cwd: join(repositoryRoot, 'kun') }
]) {
  const report = audit(target)
  assertNoUnacceptedVulnerabilities(target.name, report)
}

console.log(
  'Production dependency audit OK: no high/critical or unexpected moderate vulnerabilities; ' +
  'the bounded nut-js/Jimp and ONNX install-only advisories remain explicitly tracked.'
)

function audit(target) {
  const result = spawnSync(
    npmCommand,
    [...npmPrefixArgs, 'audit', '--omit=dev', '--json', `--registry=${registry}`],
    {
      cwd: target.cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      shell: false
    }
  )
  if (result.error) throw result.error
  const output = result.stdout.trim()
  if (!output) {
    throw new Error(`npm audit returned no JSON for ${target.name}: ${result.stderr.trim()}`)
  }
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON for ${target.name}`, { cause: error })
  }
}

function assertNoUnacceptedVulnerabilities(target, report) {
  if (report.auditReportVersion !== 2 || !isRecord(report.metadata)) {
    throw new Error(`Production audit failed for ${target}: npm returned no audit report`)
  }
  const vulnerabilities = isRecord(report.vulnerabilities) ? report.vulnerabilities : {}
  const rejected = []
  for (const [name, raw] of Object.entries(vulnerabilities)) {
    if (!isRecord(raw)) {
      rejected.push(`${name}: malformed audit entry`)
      continue
    }
    const severity = typeof raw.severity === 'string' ? raw.severity : 'unknown'
    if (severity === 'critical' || severity === 'high') {
      rejected.push(`${name}: ${severity}`)
      continue
    }
    if (severity === 'moderate' && !allowedModeratePackages.has(name)) {
      rejected.push(`${name}: unexpected moderate vulnerability`)
    }
    if (Array.isArray(raw.via)) {
      for (const via of raw.via) {
        if (isRecord(via) && typeof via.url === 'string' && !allowedAdvisories.has(via.url)) {
          rejected.push(`${name}: unexpected advisory ${via.url}`)
        }
      }
    }
  }

  const fileType = vulnerabilities['file-type']
  if (fileType !== undefined && !hasAllowedAdvisory(fileType)) {
    rejected.push('file-type: the advisory no longer matches the reviewed allowlist')
  }
  if (rejected.length > 0) {
    throw new Error(`Production audit failed for ${target}:\n- ${rejected.join('\n- ')}`)
  }
}

function hasAllowedAdvisory(value) {
  if (!isRecord(value) || !Array.isArray(value.via)) return false
  return value.via.some((entry) => isRecord(entry) && typeof entry.url === 'string' && allowedAdvisories.has(entry.url))
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
