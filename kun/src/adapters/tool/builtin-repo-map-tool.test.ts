import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createRepoMapLocalTool } from './builtin-repo-map-tool.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-repo-map-'))
  tempRoots.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'ignored'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'repo-map-fixture' }))
  await writeFile(
    join(root, 'src', 'user-service.ts'),
    [
      "import { openDatabase } from './database'",
      'export class UserRepository {}',
      'export async function findUserByEmail(email: string) {',
      '  return openDatabase().users.find((user) => user.email === email)',
      '}'
    ].join('\n')
  )
  await writeFile(
    join(root, 'src', 'payment.ts'),
    'export function chargeInvoice(total: number) { return total }\n'
  )
  await writeFile(
    join(root, 'node_modules', 'ignored', 'user-copy.ts'),
    'export class UserRepositoryCopy {}\n'
  )
  return root
}

function context(workspace: string): ToolHostContext {
  return {
    threadId: 'thread_repo_map',
    turnId: 'turn_repo_map',
    workspace,
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: vi.fn()
  }
}

describe('repo_map tool', () => {
  it('ranks relevant symbols and skips dependency directories', async () => {
    const root = await createFixture()
    const tool = createRepoMapLocalTool()

    const result = await tool.execute(
      { query: 'find user repository by email', maxFiles: 5 },
      context(root)
    )
    const output = result.output as {
      cache: { hit: boolean }
      totals: { scanBackend: string; scannedFiles: number; indexedFiles: number; truncated: boolean }
      files: Array<{
        relative_path: string
        symbols: Array<{ name: string; kind: string; line: number }>
        imports: string[]
      }>
      skippedDirectories: string[]
    }

    expect(output.cache.hit).toBe(false)
    expect(output.totals).toMatchObject({
      scanBackend: 'filesystem',
      scannedFiles: 3,
      indexedFiles: 3,
      truncated: false
    })
    expect(output.files[0]?.relative_path).toBe('src/user-service.ts')
    expect(output.files[0]?.symbols).toEqual(expect.arrayContaining([
      { name: 'UserRepository', kind: 'class', line: 2 },
      { name: 'findUserByEmail', kind: 'function', line: 3 }
    ]))
    expect(output.files[0]?.imports).toContain('./database')
    expect(output.skippedDirectories).toContain('node_modules')
  })

  it('reuses the short-lived index and is enabled for read-only subagents', async () => {
    const root = await createFixture()
    const tool = createRepoMapLocalTool()
    await tool.execute({ query: 'payment' }, context(root))

    const cached = await tool.execute({ query: 'user' }, context(root))
    expect((cached.output as { cache: { hit: boolean } }).cache.hit).toBe(true)
    expect(SUBAGENT_READ_ONLY_TOOL_NAMES).toContain('repo_map')
  })
})
