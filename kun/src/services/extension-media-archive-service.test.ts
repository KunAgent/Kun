import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as yauzl from 'yauzl'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaArchiveService } from './extension-media-archive-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(options: { existingOutput?: string; outputName?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-media-archive-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  const outputName = options.outputName ?? 'project.kun-video.zip'
  await mkdir(join(workspace, 'media'), { recursive: true })
  await mkdir(join(workspace, 'exports'), { recursive: true })
  await writeFile(join(workspace, 'media', 'clip.bin'), Buffer.from([0, 1, 2, 3, 255]))
  if (options.existingOutput !== undefined) {
    await writeFile(join(workspace, 'exports', outputName), options.existingOutput)
  }
  const principal: ExtensionPrincipal = {
    extensionId: 'acme.video',
    extensionVersion: '1.0.0',
    permissions: [
      'jobs.manage',
      'media.read',
      'media.export',
      'workspace.read',
      'workspace.write'
    ],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  const handles = new ExtensionMediaHandleService({ dataDir })
  const input = await handles.register(principal, {
    workspaceRoot: workspace,
    path: 'media/clip.bin',
    mode: 'read',
    source: 'workspace',
    mimeType: 'application/octet-stream'
  })
  const output = await handles.register(principal, {
    workspaceRoot: workspace,
    path: `exports/${outputName}`,
    mode: 'write',
    source: 'workspace',
    mimeType: 'application/zip'
  })
  const archive = new ExtensionMediaArchiveService({ handles })
  return { root, workspace, principal, handles, input, output, outputName, archive }
}

function request(inputHandleId: string, outputHandleId: string) {
  return {
    format: 'zip' as const,
    outputHandleId,
    entries: [
      {
        kind: 'inline-text' as const,
        archivePath: 'manifest/project.json',
        content: '{"revision":7}\n',
        mimeType: 'application/json' as const
      },
      {
        kind: 'media' as const,
        inputHandleId,
        archivePath: 'media/clip.bin'
      }
    ]
  }
}

async function zipEntries(path: string): Promise<string[]> {
  const archive = await yauzl.openPromise(path, {
    autoClose: false,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true
  })
  try {
    const names: string[] = []
    for await (const entry of archive.eachEntry()) names.push(entry.fileName)
    return names
  } finally {
    archive.close()
  }
}

describe('ExtensionMediaArchiveService', () => {
  it('streams binary and inline entries in deterministic path order without exposing paths', async () => {
    const first = await fixture({ outputName: 'first.zip' })
    const firstTransaction = await first.archive.executeTransaction(
      first.principal,
      request(first.input.id, first.output.id),
      'archive-1'
    )
    await firstTransaction.commit()

    const secondOutput = await first.handles.register(first.principal, {
      workspaceRoot: first.workspace,
      path: 'exports/second.zip',
      mode: 'write',
      source: 'workspace',
      mimeType: 'application/zip'
    })
    const secondTransaction = await first.archive.executeTransaction(
      first.principal,
      request(first.input.id, secondOutput.id),
      'archive-2'
    )
    await secondTransaction.commit()

    const firstBytes = await readFile(join(first.workspace, 'exports', 'first.zip'))
    const secondBytes = await readFile(join(first.workspace, 'exports', 'second.zip'))
    expect(secondBytes.equals(firstBytes)).toBe(true)
    expect(firstTransaction.result).toMatchObject({
      schemaVersion: 1,
      format: 'zip',
      entryCount: 2,
      inputBytes: 20,
      archiveBytes: firstBytes.byteLength,
      generatedMedia: {
        handleId: expect.stringMatching(/^media_/u),
        mode: 'read',
        kind: 'data',
        mimeType: 'application/zip'
      }
    })
    expect(JSON.stringify(firstTransaction.result)).not.toContain(first.workspace)
    expect(await zipEntries(join(first.workspace, 'exports', 'first.zip'))).toEqual([
      'manifest/project.json',
      'media/clip.bin'
    ])
  })

  it('restores a prior target when the durable result is discarded', async () => {
    const test = await fixture({ existingOutput: 'prior-package' })
    const transaction = await test.archive.executeTransaction(
      test.principal,
      request(test.input.id, test.output.id),
      'archive-rollback'
    )
    expect(await readFile(join(test.workspace, 'exports', test.outputName), 'utf8'))
      .not.toBe('prior-package')

    await transaction.rollback()

    expect(await readFile(join(test.workspace, 'exports', test.outputName), 'utf8'))
      .toBe('prior-package')
    expect((await readdir(join(test.workspace, 'exports'))).filter((name) =>
      name.startsWith('.kun-archive-') || name.endsWith('.kun-backup'))).toEqual([])
  })

  it('honors cancellation before touching the output grant', async () => {
    const test = await fixture({ existingOutput: 'prior-package' })
    const controller = new AbortController()
    controller.abort()

    await expect(test.archive.executeTransaction(
      test.principal,
      request(test.input.id, test.output.id),
      'archive-cancelled',
      { signal: controller.signal }
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(join(test.workspace, 'exports', test.outputName), 'utf8'))
      .toBe('prior-package')
  })

  it('rejects output aliases and enforces trusted archive permissions', async () => {
    const test = await fixture()
    await expect(test.archive.preflight(test.principal, {
      ...request(test.input.id, test.output.id),
      outputHandleId: test.input.id
    })).rejects.toMatchObject({ code: 'mode_denied' })

    await expect(test.archive.preflight({
      ...test.principal,
      workspaceTrusted: false
    }, request(test.input.id, test.output.id))).rejects.toMatchObject({
      code: 'permission_denied'
    })
  })
})
