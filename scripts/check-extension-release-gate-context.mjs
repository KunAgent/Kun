import { access, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { validateExtensionDocumentation } from './lib/extension-docs-validation.mjs'
import {
  assertExecutableApiConformance,
  expectedApiMajors,
  runRequiredCompositeCommand,
  runRequiredCommand
} from './lib/extension-release-execution.mjs'

export { access, readFile, readdir }
export { dirname, join, relative, resolve }
export { pathToFileURL, parseYaml }
export { assertExecutableApiConformance, expectedApiMajors, runRequiredCompositeCommand, runRequiredCommand }

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const require = createRequire(import.meta.url)
export const requireKun = createRequire(join(root, 'kun', 'package.json'))
export const problems = []
export const LINUX_USER_NAMESPACE_STEP_NAME = 'Prepare and verify Linux user namespace sandbox'
export const LINUX_USER_NAMESPACE_SETUP = [
  'if [[ -e /proc/sys/kernel/unprivileged_userns_clone ]]; then',
  '  sudo sysctl -w kernel.unprivileged_userns_clone=1',
  'fi',
  'if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then',
  '  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
  'fi',
  'unshare --user --map-root-user /bin/true'
].join('\n')
export const apiContract = {
  currentApiVersion: undefined,
  currentApiMajor: undefined,
  canonicalSupportedApiVersions: []
}

const documentation = await validateExtensionDocumentation(root)
for (const problem of documentation.problems) problems.push(`Documentation/API gate: ${problem}`)

export function check(condition, message) {
  if (!condition) problems.push(message)
}

export async function text(relativePath) {
  return readFile(join(root, relativePath), 'utf8')
}

export async function json(relativePath) {
  return JSON.parse(await text(relativePath))
}

export async function requirePath(relativePath, label = relativePath) {
  try {
    await access(join(root, relativePath))
  } catch {
    problems.push(`Missing ${label}: ${relativePath}`)
  }
}

export async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue
      files.push(...(await collectSourceFiles(path)))
      continue
    }
    if (!/\.(?:cjs|mjs|ts|tsx)$/.test(entry.name) || /\.test\.[cm]?tsx?$/.test(entry.name)) continue
    files.push(path)
  }
  return files
}

export function major(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version)
  if (!match) {
    problems.push(`Invalid SemVer in release gate: ${String(version)}`)
    return Number.NaN
  }
  return Number(match[1])
}

export function sameNumbers(left, right) {
  return JSON.stringify([...left]) === JSON.stringify([...right])
}

export function workflowJob(document, jobId, runner) {
  const job = document?.jobs?.[jobId]
  check(Boolean(job), `Workflow is missing job: ${jobId}`)
  if (!job) return undefined
  check(job['runs-on'] === runner, `Workflow job ${jobId} must run on ${runner}`)
  check(job.if === undefined, `Workflow job ${jobId} must not conditionally skip its release gates`)
  return job
}

export function requireOrderedCommands(job, jobId, commands) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  let priorIndex = -1
  for (const command of commands) {
    const index = steps.findIndex(
      (step, candidateIndex) =>
        candidateIndex > priorIndex &&
        typeof step?.run === 'string' &&
        step.run.split(/\r?\n/).some((line) => line.trim() === command) &&
        step.if === undefined &&
        (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
    )
    check(index >= 0, `Workflow job ${jobId} must run after prior gates and fail on: ${command}`)
    if (index >= 0) priorIndex = index
  }
}

export function requireBoundedJobTimeout(job, jobId, maximumMinutes) {
  if (!job) return
  const timeout = job['timeout-minutes']
  check(
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= maximumMinutes,
    `Workflow job ${jobId} must set timeout-minutes between 1 and ${maximumMinutes}`
  )
}

export function requireJobDependencies(job, jobId, dependencies) {
  if (!job) return
  const needs = Array.isArray(job.needs) ? job.needs : [job.needs].filter(Boolean)
  for (const dependency of dependencies) {
    check(needs.includes(dependency), `Workflow job ${jobId} must depend on successful ${dependency}`)
  }
}

export function requireSharedExtensionReleaseGate(document, label, validationJobId, packageJobIds) {
  const validationJob = workflowJob(document, validationJobId, 'ubuntu-latest')
  requireOrderedCommands(validationJob, validationJobId, ['npm run check:extensions'])
  for (const jobId of packageJobIds) {
    const job = document?.jobs?.[jobId]
    check(Boolean(job), `${label} workflow is missing packaging job: ${jobId}`)
    requireJobDependencies(job, jobId, [validationJobId])
    const hasDuplicatedGate = (Array.isArray(job?.steps) ? job.steps : []).some(
      (step) =>
        typeof step?.run === 'string' &&
        step.run.split(/\r?\n/).some((line) => line.trim() === 'npm run check:extension-release-gate')
    )
    check(
      !hasDuplicatedGate,
      `${label} workflow job ${jobId} must not duplicate the shared Extension release gate`
    )
  }
}

export function requireBoundedCommandStep(job, jobId, stepName, command, maximumMinutes) {
  if (!job) return
  const step = (Array.isArray(job.steps) ? job.steps : []).find((candidate) => candidate?.name === stepName)
  const hasCommand = typeof step?.run === 'string' &&
    step.run.split(/\r?\n/).some((line) => line.trim() === command)
  check(
    Boolean(step) && hasCommand && step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false),
    `Workflow job ${jobId} must run ${stepName} unconditionally and fail on: ${command}`
  )
  const timeout = step?.['timeout-minutes']
  check(
    Number.isSafeInteger(timeout) && timeout > 0 && timeout <= maximumMinutes,
    `Workflow job ${jobId} step ${stepName} must set timeout-minutes between 1 and ${maximumMinutes}`
  )
}

export function requireUnconditionalStepAfter(job, jobId, stepName, priorCommand) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  const priorIndex = steps.findIndex(
    (step) =>
      typeof step?.run === 'string' &&
      step.run.split(/\r?\n/).some((line) => line.trim() === priorCommand)
  )
  const stepIndex = steps.findIndex(
    (step, candidateIndex) =>
      candidateIndex > priorIndex &&
      step?.name === stepName &&
      step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
  )
  check(
    priorIndex >= 0 && stepIndex > priorIndex,
    `Workflow job ${jobId} must run ${stepName} unconditionally after: ${priorCommand}`
  )
}

export function requireNamedStepsInOrder(job, jobId, stepNames) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  let priorIndex = -1
  for (const stepName of stepNames) {
    const index = steps.findIndex(
      (step, candidateIndex) =>
        candidateIndex > priorIndex &&
        step?.name === stepName &&
        step.if === undefined &&
        (step['continue-on-error'] === undefined || step['continue-on-error'] === false)
    )
    check(index >= 0, `Workflow job ${jobId} must run after prior gates: ${stepName}`)
    if (index >= 0) priorIndex = index
  }
}

export function requireStepRunMarkers(job, jobId, stepName, markers) {
  if (!job) return
  const step = (Array.isArray(job.steps) ? job.steps : [])
    .find((candidate) => candidate?.name === stepName)
  const run = typeof step?.run === 'string' ? step.run : ''
  for (const marker of markers) {
    check(run.includes(marker), `Workflow job ${jobId} step ${stepName} omits: ${marker}`)
  }
}

export function requireLinuxUserNamespaceStep(job, jobId) {
  if (!job) return
  const steps = Array.isArray(job.steps) ? job.steps : []
  const step = steps.find((candidate) => candidate?.name === LINUX_USER_NAMESPACE_STEP_NAME)
  const run = typeof step?.run === 'string' ? step.run.trim() : ''
  check(
    Boolean(step) && run === LINUX_USER_NAMESPACE_SETUP && step.if === undefined &&
      (step['continue-on-error'] === undefined || step['continue-on-error'] === false),
    `Workflow job ${jobId} must use the fixed fail-closed Linux user namespace setup`
  )
  check(
    !/\bdist\b|\$\{\{|AppImage|chrome-sandbox|chown|chmod/.test(run),
    `Workflow job ${jobId} user namespace setup must not accept or mutate artifact paths`
  )
}

export function requirePublishDependencies(document, workflowLabel) {
  const publish = document?.jobs?.publish
  check(Boolean(publish), `${workflowLabel} must define a publish job`)
  if (!publish) return
  const needs = Array.isArray(publish.needs) ? publish.needs : [publish.needs].filter(Boolean)
  for (const dependency of [
    'prepare',
    'build-macos',
    'build-windows',
    'build-linux',
    'build-linux-arm64'
  ]) {
    check(
      needs.includes(dependency),
      `${workflowLabel} publish job must depend on successful ${dependency}`
    )
  }
  check(publish.if === undefined, `${workflowLabel} publish job must not bypass failed build/smoke jobs`)
}

export function requireOrderedSourceMarkers(source, label, markers) {
  source = source.replace(/\r\n/gu, '\n')
  let priorIndex = -1
  for (const marker of markers) {
    const index = source.indexOf(marker, priorIndex + 1)
    check(index >= 0, `${label} must run after prior gates and fail closed at: ${marker}`)
    if (index >= 0) priorIndex = index
  }
}

export function requireSourceMarkersAfter(source, label, priorMarker, markers) {
  source = source.replace(/\r\n/gu, '\n')
  const priorIndex = source.indexOf(priorMarker)
  check(priorIndex >= 0, `${label} is missing required gate marker: ${priorMarker}`)
  for (const marker of markers) {
    const markerIndex = source.indexOf(marker, priorIndex + 1)
    check(
      priorIndex >= 0 && markerIndex > priorIndex,
      `${label} must keep public release operation after ${priorMarker}: ${marker}`
    )
  }
}

// The public platform must not be hidden by an internal build/runtime feature flag.
// KUN_EXTENSION_HOST_RUNNER is intentionally not a gate: it marks the dedicated
// child entrypoint and remains allowed.
