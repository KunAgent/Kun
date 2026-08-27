#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_MAX_LINES = 700

const PACKAGE_MANAGER_LOCKFILES = new Set([
  '.terraform.lock.hcl',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'Package.resolved',
  'Pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'uv.lock',
  'yarn.lock'
])

function asBuffer(contents) {
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
}

export function countPhysicalLines(contents) {
  const buffer = asBuffer(contents)
  if (buffer.length === 0) return 0

  let lines = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index]
    if (byte === 0x0a) {
      lines += 1
      continue
    }
    if (byte === 0x0d && buffer[index + 1] !== 0x0a) lines += 1
  }

  const finalByte = buffer[buffer.length - 1]
  if (finalByte !== 0x0a && finalByte !== 0x0d) lines += 1
  return lines
}

export function isBinaryContent(contents) {
  const buffer = asBuffer(contents)
  if (buffer.length === 0) return false

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  let controlBytes = 0
  for (const byte of sample) {
    if (byte === 0) return true
    const allowedControl = byte === 0x08 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d
    if ((byte < 0x20 && !allowedControl) || byte === 0x7f) controlBytes += 1
  }
  if (controlBytes / sample.length > 0.1) return true

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: sample.length < buffer.length })
    return false
  } catch {
    return true
  }
}

export function isPackageManagerLockfile(filePath) {
  return PACKAGE_MANAGER_LOCKFILES.has(basename(filePath))
}

export function listTrackedPaths(root) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024
  })
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim()
    throw new Error(`Unable to enumerate tracked files${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, 'en'))
}

export async function inspectTrackedFiles({ root, maxLines = DEFAULT_MAX_LINES, paths } = {}) {
  if (!root) throw new Error('inspectTrackedFiles requires a repository root')
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) throw new Error('maxLines must be a positive integer')

  const trackedPaths = paths ? [...paths].sort((left, right) => left.localeCompare(right, 'en')) : listTrackedPaths(root)
  const violations = []
  let checkedTextFiles = 0
  let excludedBinaryFiles = 0
  let excludedLockfiles = 0
  let missingTrackedFiles = 0

  for (const trackedPath of trackedPaths) {
    if (isPackageManagerLockfile(trackedPath)) {
      excludedLockfiles += 1
      continue
    }

    let contents
    try {
      contents = await readFile(resolve(root, trackedPath))
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        missingTrackedFiles += 1
        continue
      }
      // Tracked symlinks can point at directories (skill aliases). They have
      // no physical lines of their own, so skip them instead of failing.
      if (error && typeof error === 'object' && error.code === 'EISDIR') {
        continue
      }
      throw error
    }

    if (isBinaryContent(contents)) {
      excludedBinaryFiles += 1
      continue
    }

    checkedTextFiles += 1
    const lineCount = countPhysicalLines(contents)
    if (lineCount > maxLines) violations.push({ lineCount, path: trackedPath })
  }

  return {
    checkedTextFiles,
    excludedBinaryFiles,
    excludedLockfiles,
    maxLines,
    missingTrackedFiles,
    violations
  }
}

export function formatAuditResult(result) {
  if (result.violations.length === 0) {
    return `File line limit passed: ${result.checkedTextFiles} tracked text files are at or below ${result.maxLines} lines.`
  }

  const diagnostics = result.violations.map(
    ({ lineCount, path }) => `${path}: ${lineCount} lines (maximum ${result.maxLines})`
  )
  return [
    `File line limit failed: ${result.violations.length} tracked text file(s) exceed ${result.maxLines} lines.`,
    ...diagnostics
  ].join('\n')
}

export async function runFileLineCheck({ root, maxLines = DEFAULT_MAX_LINES, stdout = process.stdout } = {}) {
  const result = await inspectTrackedFiles({ root, maxLines })
  stdout.write(`${formatAuditResult(result)}\n`)
  return result.violations.length === 0 ? 0 : 1
}

function parseMaximumLineArgument(arguments_) {
  const maximumIndex = arguments_.indexOf('--max-lines')
  if (maximumIndex < 0) return DEFAULT_MAX_LINES
  const parsed = Number(arguments_[maximumIndex + 1])
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('--max-lines requires a positive integer')
  return parsed
}

const scriptPath = fileURLToPath(import.meta.url)
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === scriptPath) {
  const repositoryRoot = resolve(dirname(scriptPath), '..')
  try {
    process.exitCode = await runFileLineCheck({
      root: repositoryRoot,
      maxLines: parseMaximumLineArgument(process.argv.slice(2))
    })
  } catch (error) {
    process.stderr.write(`File line limit check failed to run: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
