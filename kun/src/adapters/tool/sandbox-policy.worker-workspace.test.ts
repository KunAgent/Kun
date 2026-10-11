import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWriteLocalTool } from './builtin-file-tools.js'
import { canWritePath, sandboxBlockForTool } from './sandbox-policy.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-worker-scopes-'))
  roots.push(root)
  const workspace = join(root, 'worker')
  const sibling = join(root, 'sibling')
  await Promise.all([mkdir(workspace), mkdir(sibling)])
  const context: ToolHostContext = { threadId: 'worker', turnId: 'turn', workspace,
    approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
    allowedWritePaths: [workspace], abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' }
  return { root, workspace, sibling, context }
}

describe('host-bound worker write scopes', () => {
  it('writes a real worker file with the absolute scope minted by ManagerRuntime', async () => {
    const { workspace, context } = await fixture()
    const result = await createWriteLocalTool().execute({ path: 'worker.txt', content: 'worker result' }, context)
    expect(result.isError).not.toBe(true)
    expect(await readFile(join(workspace, 'worker.txt'), 'utf8')).toBe('worker result')
    // File access does not turn a delegated shell into an unconfined writer.
    expect(sandboxBlockForTool({ name: 'bash', toolKind: 'command_execution' }, context))
      .toMatchObject({ code: 'sandbox_command_blocked' })
  })

  it('preserves narrow absolute scopes and rejects sibling, parent and traversal grants', async () => {
    const { root, workspace, sibling, context } = await fixture()
    const inside = join(workspace, 'src', 'app.ts')
    expect(canWritePath(inside, { ...context, allowedWritePaths: [join(workspace, 'src')] })).toEqual({ ok: true })
    expect(canWritePath(join(workspace, 'other.txt'), { ...context, allowedWritePaths: [join(workspace, 'src')] }).ok).toBe(false)
    expect(canWritePath(join(sibling, 'other.txt'), context).ok).toBe(false)
    for (const allowedWritePaths of [[root], ['..'], [sibling], []]) {
      expect(canWritePath(inside, { ...context, allowedWritePaths }).ok).toBe(false)
    }
  })

  it('still rejects a lexical worker path whose symlink resolves to a sibling', async () => {
    const { workspace, sibling, context } = await fixture()
    await writeFile(join(sibling, 'private.txt'), 'unchanged')
    await symlink(sibling, join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const result = await createWriteLocalTool().execute({ path: 'linked/private.txt', content: 'wrong' }, context)
    expect(result.isError).toBe(true)
    expect(await readFile(join(sibling, 'private.txt'), 'utf8')).toBe('unchanged')
  })
})
