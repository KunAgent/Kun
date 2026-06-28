import { access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { LocalTool } from './local-tool-host.js'
import { shellSpawnEnv, terminateSpawnTree, workspaceRoot } from './builtin-tool-utils.js'

export const VERIFY_CHANGES_TOOL_NAME = 'verify_changes'

const DEFAULT_TIMEOUT_SECONDS = 180
const MAX_TIMEOUT_SECONDS = 600
const MAX_OUTPUT_CHARS = 24_000
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/i
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i

type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type VerificationCommand = {
  label: string
  command: string
  args: string[]
  cwd: string
}

export type VerificationCheck = VerificationCommand & {
  exitCode: number | null
  output: string
  durationMs: number
}

type VerifyToolOperations = {
  runCommand?: (
    command: VerificationCommand,
    options: { signal: AbortSignal; timeoutSeconds: number }
  ) => Promise<VerificationCheck>
}

export function createVerifyChangesLocalTool(
  operations: VerifyToolOperations = {}
): LocalTool {
  return {
    name: VERIFY_CHANGES_TOOL_NAME,
    description:
      'Run project-aware acceptance checks for files changed in the workspace. ' +
      'The focused scope selects adjacent Vitest tests and typecheck scripts; full also runs lint and build scripts. ' +
      'Use after code changes and fix failures before finishing.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['focused', 'full'] },
        timeout: { type: 'number', minimum: 1, maximum: MAX_TIMEOUT_SECONDS }
      },
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'command_execution',
    execute: async (args, context, onUpdate) => {
      const root = workspaceRoot(context.workspace)
      const scope = args.scope === 'full' ? 'full' : 'focused'
      const timeoutSeconds = normalizeTimeout(args.timeout)
      const changedFiles = await listChangedFiles(root, context.abortSignal, timeoutSeconds, operations)
      if (changedFiles.length === 0) {
        return {
          output: {
            status: 'skipped',
            scope,
            changed_files: [],
            checks: [],
            summary: 'No changed files were detected in the workspace.'
          }
        }
      }

      const commands = await planVerificationCommands(root, changedFiles, scope)
      if (commands.length === 0) {
        return {
          output: {
            status: 'skipped',
            scope,
            changed_files: changedFiles,
            checks: [],
            summary: 'No supported project verification scripts were found.'
          }
        }
      }

      const checks: VerificationCheck[] = []
      const runCommand = operations.runCommand ?? runVerificationCommand
      for (const command of commands) {
        const check = await runCommand(command, {
          signal: context.abortSignal,
          timeoutSeconds
        })
        if (context.abortSignal.aborted) throw new Error('verification aborted')
        checks.push(check)
        await onUpdate?.({
          output: {
            status: check.exitCode === 0 ? 'running' : 'failed',
            scope,
            changed_files: changedFiles,
            checks,
            summary: `${command.label} ${check.exitCode === 0 ? 'passed' : 'failed'}.`
          },
          isError: check.exitCode !== 0
        })
        if (check.exitCode !== 0) {
          return {
            output: {
              status: 'failed',
              scope,
              changed_files: changedFiles,
              checks,
              summary: `${command.label} failed. Fix the reported error and run verification again.`
            },
            isError: true
          }
        }
      }

      return {
        output: {
          status: 'passed',
          scope,
          changed_files: changedFiles,
          checks,
          summary: `${checks.length} verification check(s) passed.`
        }
      }
    }
  }
}

export async function planVerificationCommands(
  root: string,
  changedFiles: readonly string[],
  scope: 'focused' | 'full'
): Promise<VerificationCommand[]> {
  const packageRoots = await packageRootsForChangedFiles(root, changedFiles)
  const filesByPackageRoot = new Map(packageRoots.map((packageRoot) => [packageRoot, [] as string[]]))
  for (const file of changedFiles) {
    const owner = packageRoots.find((packageRoot) => isInside(packageRoot, resolve(root, file)))
    if (owner) filesByPackageRoot.get(owner)?.push(file)
  }
  const commands: VerificationCommand[] = []
  for (const packageRoot of packageRoots) {
    const packageJson = await readPackageJson(packageRoot)
    if (!packageJson?.scripts) continue
    const packageManager = await detectPackageManager(packageRoot)
    const packageChangedFiles = filesByPackageRoot.get(packageRoot) ?? []
    if (packageChangedFiles.length === 0) continue
    const tests = await adjacentTests(packageRoot, root, packageChangedFiles)
    if (tests.length > 0 && packageJson.scripts.test && usesVitest(packageJson)) {
      commands.push(scriptCommand(packageManager, packageRoot, 'test', tests, 'focused tests'))
    }
    if (packageJson.scripts.typecheck && packageChangedFiles.some((file) => SOURCE_EXTENSION.test(file))) {
      commands.push(scriptCommand(packageManager, packageRoot, 'typecheck', [], 'typecheck'))
    }
    if (scope === 'full' && packageJson.scripts.lint) {
      commands.push(scriptCommand(packageManager, packageRoot, 'lint', [], 'lint'))
    }
    if (scope === 'full' && packageJson.scripts.build) {
      commands.push(scriptCommand(packageManager, packageRoot, 'build', [], 'build'))
    }
  }
  return dedupeCommands(commands)
}

async function listChangedFiles(
  root: string,
  signal: AbortSignal,
  timeoutSeconds: number,
  operations: VerifyToolOperations
): Promise<string[]> {
  const runCommand = operations.runCommand ?? runVerificationCommand
  const commands: VerificationCommand[] = [
    { label: 'unstaged changes', command: 'git', args: ['diff', '--name-only', '--diff-filter=ACMRTUXB'], cwd: root },
    { label: 'staged changes', command: 'git', args: ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'], cwd: root },
    { label: 'untracked files', command: 'git', args: ['ls-files', '--others', '--exclude-standard'], cwd: root }
  ]
  const files = new Set<string>()
  for (const command of commands) {
    const result = await runCommand(command, { signal, timeoutSeconds })
    if (signal.aborted) throw new Error('verification aborted')
    if (result.exitCode !== 0) continue
    for (const line of result.output.split(/\r?\n/)) {
      const file = line.trim().replaceAll('\\', '/')
      if (file) files.add(file)
    }
  }
  return [...files].sort()
}

async function packageRootsForChangedFiles(root: string, changedFiles: readonly string[]): Promise<string[]> {
  const roots = new Set<string>()
  if (await exists(join(root, 'package.json'))) roots.add(root)
  for (const file of changedFiles) {
    let current = dirname(resolve(root, file))
    while (isInside(root, current)) {
      if (await exists(join(current, 'package.json'))) {
        roots.add(current)
        break
      }
      if (current === root) break
      current = dirname(current)
    }
  }
  return [...roots].sort((left, right) => right.length - left.length)
}

async function adjacentTests(
  packageRoot: string,
  workspaceRoot: string,
  changedFiles: readonly string[]
): Promise<string[]> {
  const tests = new Set<string>()
  for (const file of changedFiles) {
    const absolute = resolve(workspaceRoot, file)
    if (!isInside(packageRoot, absolute) || !SOURCE_EXTENSION.test(file)) continue
    const packageRelative = relative(packageRoot, absolute).replaceAll('\\', '/')
    if (TEST_FILE.test(packageRelative)) {
      tests.add(packageRelative)
      continue
    }
    const extension = packageRelative.match(/(\.[cm]?[jt]sx?)$/i)?.[1]
    if (!extension) continue
    const stem = packageRelative.slice(0, -extension.length)
    for (const candidate of [`${stem}.test${extension}`, `${stem}.spec${extension}`]) {
      if (await exists(join(packageRoot, candidate))) tests.add(candidate)
    }
  }
  return [...tests].sort()
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return null
  }
}

function usesVitest(packageJson: PackageJson): boolean {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
  return Boolean(deps.vitest) || /\bvitest\b/.test(packageJson.scripts?.test ?? '')
}

async function detectPackageManager(root: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun'> {
  if (await exists(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(root, 'yarn.lock'))) return 'yarn'
  if (await exists(join(root, 'bun.lockb')) || await exists(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

function scriptCommand(
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  cwd: string,
  script: string,
  extraArgs: string[],
  label: string
): VerificationCommand {
  const command = process.platform === 'win32' && packageManager === 'npm' ? 'npm.cmd' : packageManager
  if (packageManager === 'yarn') {
    return { label, command, args: [script, ...extraArgs], cwd }
  }
  return {
    label,
    command,
    args: ['run', script, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])],
    cwd
  }
}

async function runVerificationCommand(
  command: VerificationCommand,
  options: { signal: AbortSignal; timeoutSeconds: number }
): Promise<VerificationCheck> {
  const startedAt = Date.now()
  return await new Promise((resolvePromise) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: shellSpawnEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer | string) => {
      output += chunk.toString()
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const stop = () => terminateSpawnTree(child)
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, options.timeoutSeconds * 1000)
    options.signal.addEventListener('abort', stop, { once: true })
    child.once('error', (error) => {
      append(error.message)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', stop)
      resolvePromise({
        ...command,
        exitCode: timedOut || options.signal.aborted ? null : code,
        output: timedOut ? `${output}\nCommand timed out.`.trim() : output.trim(),
        durationMs: Date.now() - startedAt
      })
    })
  })
}

function dedupeCommands(commands: readonly VerificationCommand[]): VerificationCommand[] {
  const seen = new Set<string>()
  return commands.filter((command) => {
    const key = `${command.cwd}\0${command.command}\0${command.args.join('\0')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeTimeout(value: unknown): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_TIMEOUT_SECONDS
  return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, parsed))
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`))
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
