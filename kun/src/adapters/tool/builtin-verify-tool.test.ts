import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVerifyChangesLocalTool,
  planVerificationCommands,
  type VerificationCheck,
  type VerificationCommand
} from './builtin-verify-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-verify-'))
  tempRoots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'package-lock.json'), '{}')
  await writeFile(join(root, 'src', 'sample.ts'), 'export const sample = 1\n')
  await writeFile(join(root, 'src', 'sample.test.ts'), 'export {}\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      build: 'vite build'
    },
    devDependencies: { vitest: '^4.0.0' }
  }))
  return root
}

function context(root: string): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: root,
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function check(command: VerificationCommand, exitCode = 0, output = ''): VerificationCheck {
  return { ...command, exitCode, output, durationMs: 1 }
}

describe('planVerificationCommands', () => {
  it('selects adjacent Vitest coverage and typecheck for focused verification', async () => {
    const root = await fixture()
    const commands = await planVerificationCommands(root, ['src/sample.ts'], 'focused')

    expect(commands.map((command) => command.label)).toEqual(['focused tests', 'typecheck'])
    expect(commands[0]?.args).toContain('src/sample.test.ts')
  })

  it('adds lint and build only for full verification', async () => {
    const root = await fixture()
    const commands = await planVerificationCommands(root, ['src/sample.ts'], 'full')

    expect(commands.map((command) => command.label)).toEqual([
      'focused tests',
      'typecheck',
      'lint',
      'build'
    ])
  })

  it('assigns monorepo files only to their nearest package root', async () => {
    const root = await fixture()
    await mkdir(join(root, 'packages', 'child', 'src'), { recursive: true })
    await writeFile(join(root, 'packages', 'child', 'src', 'child.ts'), 'export {}\n')
    await writeFile(join(root, 'packages', 'child', 'package.json'), JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit' }
    }))

    const commands = await planVerificationCommands(
      root,
      ['packages/child/src/child.ts'],
      'focused'
    )

    expect(commands).toHaveLength(1)
    expect(commands[0]?.cwd).toBe(join(root, 'packages', 'child'))
    expect(commands[0]?.label).toBe('typecheck')
  })
})

describe('createVerifyChangesLocalTool', () => {
  it('runs selected checks and returns structured evidence', async () => {
    const root = await fixture()
    const executed: string[] = []
    const tool = createVerifyChangesLocalTool({
      runCommand: async (command) => {
        if (command.label === 'unstaged changes') return check(command, 0, 'src/sample.ts')
        if (command.label === 'staged changes' || command.label === 'untracked files') {
          return check(command)
        }
        executed.push(command.label)
        return check(command, 0, `${command.label} passed`)
      }
    })

    const result = await tool.execute({}, context(root))

    expect(result.isError).not.toBe(true)
    expect(executed).toEqual(['focused tests', 'typecheck'])
    expect(result.output).toMatchObject({ status: 'passed', changed_files: ['src/sample.ts'] })
  })

  it('stops on the first failed check so the model can repair it', async () => {
    const root = await fixture()
    const executed: string[] = []
    const tool = createVerifyChangesLocalTool({
      runCommand: async (command) => {
        if (command.label === 'unstaged changes') return check(command, 0, 'src/sample.ts')
        if (command.label === 'staged changes' || command.label === 'untracked files') {
          return check(command)
        }
        executed.push(command.label)
        return check(command, command.label === 'focused tests' ? 1 : 0, 'test failed')
      }
    })

    const result = await tool.execute({}, context(root))

    expect(result.isError).toBe(true)
    expect(executed).toEqual(['focused tests'])
    expect(result.output).toMatchObject({ status: 'failed' })
  })

  it('treats "nothing to verify" as a benign skip, not a failure', async () => {
    const root = await fixture()
    const tool = createVerifyChangesLocalTool({
      // Only a non-source doc changed, so no Vitest/typecheck command applies.
      runCommand: async (command) => {
        if (command.label === 'unstaged changes') return check(command, 0, 'README.md')
        return check(command)
      }
    })

    const result = await tool.execute({}, context(root))

    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({ status: 'skipped' })
  })
})
