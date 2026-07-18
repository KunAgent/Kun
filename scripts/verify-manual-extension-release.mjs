#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyVideoEditorArchive } from './pack-kun-video-editor.mjs'
import { verifyNativeEvidenceBundle } from './verify-extension-native-evidence.mjs'

const FULL_COMMIT = /^[a-f0-9]{40}$/i
const RELEASE_TAG = /^v([0-9A-Za-z][0-9A-Za-z._-]*)$/u

export function createReleaseDownloadInvocation({ tag, directory }) {
  assertReleaseTag(tag)
  return {
    command: 'gh',
    args: ['release', 'download', tag, '--dir', resolve(directory)],
    options: {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30 * 60_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  }
}

export function assertTagMatchesCheckout({ tag, checkedOutCommit, tagCommit }) {
  assertReleaseTag(tag)
  const checkout = normalizeCommit(checkedOutCommit, 'checked-out commit')
  const tagged = normalizeCommit(tagCommit, 'release tag commit')
  if (checkout !== tagged) {
    throw new Error(`Release tag ${tag} points at ${tagged}, but local HEAD is ${checkout}`)
  }
  return checkout
}

export function assertCleanReleaseCheckout(status) {
  if (typeof status !== 'string') {
    throw new Error('Release checkout status must be text')
  }
  const changes = status.split(/\r?\n/u).filter((line) => line.trim().length > 0)
  if (changes.length > 0) {
    throw new Error(
      `Manual release checkout is dirty (${changes.length} tracked or untracked change(s)); ` +
      'commit or remove them before building'
    )
  }
}

export async function verifyManualReleaseDirectory({
  directory,
  tag,
  expectedVersion,
  checkedOutCommit,
  tagCommit,
  verifyPackage = verifyVideoEditorArchive
}) {
  const commit = assertTagMatchesCheckout({ tag, checkedOutCommit, tagCommit })
  const native = await verifyNativeEvidenceBundle({
    directory,
    expectedCommit: commit,
    checkedOutCommit: commit,
    tagCommit,
    expectedVersion
  })
  const extension = await verifyPackage({ input: directory })
  return { commit, version: native.version, native, extension }
}

export function fetchReleaseTag({ tag, run = runRequired } = {}) {
  assertReleaseTag(tag)
  assertCleanReleaseCheckout(releaseCheckoutStatus())
  run('git', [
    'fetch',
    '--force',
    'origin',
    `+refs/tags/${tag}:refs/tags/${tag}`
  ])
  const checkedOutCommit = gitOutput(['rev-parse', 'HEAD'])
  const tagCommit = gitOutput(['rev-list', '-n', '1', tag])
  return {
    checkedOutCommit,
    tagCommit,
    commit: assertTagMatchesCheckout({ tag, checkedOutCommit, tagCommit })
  }
}

export function releaseCheckoutStatus() {
  return gitOutput([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none'
  ])
}

function runRequired(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    shell: false,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    timeout: options.timeout ?? 30 * 60_000,
    windowsHide: true,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe']
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim()
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.signal ?? result.status ?? 'unknown exit'})` +
      `${output ? `:\n${output.slice(-16_000)}` : ''}`
    )
  }
  return String(result.stdout ?? '')
}

function runInvocation(invocation) {
  return runRequired(invocation.command, invocation.args, invocation.options)
}

function gitOutput(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

function assertReleaseTag(tag) {
  if (typeof tag !== 'string' || !RELEASE_TAG.test(tag)) {
    throw new Error(`Manual Extension release requires a version tag, got: ${String(tag)}`)
  }
}

function normalizeCommit(value, label) {
  if (typeof value !== 'string' || !FULL_COMMIT.test(value)) {
    throw new Error(`${label} must be a full 40-character commit SHA`)
  }
  return value.toLowerCase()
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  if (process.argv.includes('--clean-only')) {
    assertCleanReleaseCheckout(releaseCheckoutStatus())
    process.stdout.write('Manual Extension release checkout OK: tracked and untracked worktree is clean\n')
    return
  }
  const tag = argumentValue('--tag')
  if (!tag) throw new Error('--tag is required')
  const match = RELEASE_TAG.exec(tag)
  if (!match) throw new Error(`Manual Extension release requires a version tag, got: ${tag}`)
  const expectedVersion = argumentValue('--version') ?? match[1]
  if (expectedVersion !== match[1]) {
    throw new Error(`Release version ${expectedVersion} does not match tag ${tag}`)
  }

  const commits = fetchReleaseTag({ tag })
  if (process.argv.includes('--tag-only')) {
    process.stdout.write(`Manual Extension release tag OK: ${tag} -> ${commits.commit}\n`)
    return
  }

  const directory = await mkdtemp(join(tmpdir(), 'kun-manual-extension-release-'))
  try {
    runInvocation(createReleaseDownloadInvocation({ tag, directory }))
    const result = await verifyManualReleaseDirectory({
      directory,
      tag,
      expectedVersion,
      checkedOutCommit: commits.checkedOutCommit,
      tagCommit: commits.tagCommit
    })
    process.stdout.write(
      `Manual Extension release bundle OK: ${tag}, commit ${result.commit}, ` +
      `${result.native.artifacts.length} native artifacts, ` +
      `Kun Video Editor sha256 ${result.extension.sha256}\n`
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
