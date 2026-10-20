import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createEditLocalTool, createWriteLocalTool } from './builtin-file-tools.js'

const cleanup: string[] = []

function context(workspace: string): ToolHostContext {
  return {
    threadId: 'thr_file_state',
    turnId: 'turn_file_state',
    workspace,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('file tool fileState meta', () => {
  it('records the hash of the bytes write and edit left on disk', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-file-state-')))
    cleanup.push(root)
    const target = join(root, 'notes.txt')

    const write = await createWriteLocalTool().execute(
      { path: 'notes.txt', content: 'alpha\nbeta\n' },
      context(root)
    )
    expect(write.isError).toBeFalsy()
    expect(write.meta).toEqual({
      fileState: { path: target, afterSha256: sha256(await readFile(target)) }
    })
    expect(JSON.stringify(write.output)).not.toContain('afterSha256')

    await writeFile(target, '﻿alpha\r\nbeta\r\n')
    const edit = await createEditLocalTool().execute(
      { path: 'notes.txt', oldText: 'beta', newText: 'gamma' },
      context(root)
    )
    expect(edit.isError).toBeFalsy()
    expect(edit.meta).toEqual({
      fileState: { path: target, afterSha256: sha256(await readFile(target)) }
    })
  })

  it('omits fileState when the tool fails', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-file-state-')))
    cleanup.push(root)
    const edit = await createEditLocalTool().execute(
      { path: 'missing.txt', oldText: 'a', newText: 'b' },
      context(root)
    )
    expect(edit.isError).toBe(true)
    expect(edit.meta).toBeUndefined()
  })
})
