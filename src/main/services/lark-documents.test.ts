import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  completeLarkDocumentAuth,
  configureLarkCli,
  getLarkDocumentImportMetadata,
  importLarkDocumentToWorkspace,
  installLarkCli,
  listImportedLarkDocuments,
  listLarkDocuments,
  readLarkImportMetadata,
  refreshLarkDocumentFromWorkspace,
  startLarkDocumentAuth,
  updateLarkDocumentFromWorkspace
} from './lark-documents'

async function createFakeLarkCli(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-lark-cli-'))
  const bin = join(dir, 'fake-lark-cli.mjs')
  await writeFile(
    bin,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') {
  process.stdout.write('1.0.99')
  process.exit(0)
}
if (args[0] === 'config' && args[1] === 'init') {
  let input = ''
  process.stdin.on('data', (chunk) => { input += chunk.toString() })
  process.stdin.on('end', () => {
    if (!args.includes('--app-id') || !args.includes('--app-secret-stdin') || !input.includes('secret')) {
      process.stderr.write('missing config input')
      process.exit(4)
    }
    process.stdout.write('configured')
    process.exit(0)
  })
  process.stdin.resume()
} else if (args[0] === 'auth' && args[1] === 'login' && args.includes('--no-wait')) {
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      verification_url: 'https://example.feishu.cn/auth',
      device_code: 'device-123',
      user_code: 'CODE-123',
      interval: 3,
      expires_in: 300
    }
  }))
  process.exit(0)
} else if (args[0] === 'auth' && args[1] === 'login' && args.includes('--device-code')) {
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      status: 'success'
    }
  }))
  process.exit(0)
} else if (args[0] === 'drive' && args[1] === '+search') {
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      has_more: false,
      results: [
        {
          entity_type: 'docx',
          title_highlighted: '<h>Fake</h> 文档',
          result_meta: {
            title: 'Fake 文档',
            url: 'https://example.feishu.cn/docx/fakeToken',
            token: 'fakeToken',
            doc_types: 'docx',
            owner_name: 'Rubick',
            update_time_iso: '2026-06-20T12:00:00.000Z'
          }
        }
      ]
    }
  }))
  process.exit(0)
} else if (args[0] === 'docs' && args[1] === '+fetch') {
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      document: {
        document_id: 'fakeToken',
        revision_id: 7,
        content: '# Fake 文档\\n\\n正文内容'
      }
    }
  }))
  process.exit(0)
} else if (args[0] === 'docs' && args[1] === '+update') {
  let input = ''
  process.stdin.on('data', (chunk) => { input += chunk.toString() })
  process.stdin.on('end', () => {
    if (!input.includes('更新后的正文')) {
      process.stderr.write('missing stdin markdown')
      process.exit(3)
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      data: {
        document: {
          revision_id: 8
        },
        result: 'success'
      }
    }))
    process.exit(0)
  })
  process.stdin.resume()
} else if (args[0] === 'docs' && args[1] === '+create') {
  let input = ''
  process.stdin.on('data', (chunk) => { input += chunk.toString() })
  process.stdin.on('end', () => {
    if (!args.includes('--doc-format') || !args.includes('markdown') || !input.includes('新建后的正文')) {
      process.stderr.write('missing create markdown input')
      process.exit(5)
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      data: {
        document: {
          document_id: 'createdToken',
          revision_id: 1,
          url: 'https://example.feishu.cn/docx/createdToken'
        }
      }
    }))
    process.exit(0)
  })
  process.stdin.resume()
} else {
  process.stderr.write('unexpected command: ' + args.join(' '))
  process.exit(2)
}
`,
    'utf8'
  )
  await chmod(bin, 0o755)
  return bin
}

async function createFakeNpm(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-fake-npm-'))
  const bin = join(dir, 'fake-npm.mjs')
  await writeFile(
    bin,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const prefix = args[args.indexOf('--prefix') + 1]
if (!prefix || !args.includes('@larksuite/cli@latest')) {
  process.stderr.write('unexpected npm args: ' + args.join(' '))
  process.exit(2)
}
const binDir = join(prefix, 'node_modules', '.bin')
mkdirSync(binDir, { recursive: true })
const cli = join(binDir, process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli')
writeFileSync(cli, '#!/usr/bin/env node\\nif (process.argv[2] === "--version") process.stdout.write("1.0.56")\\n')
chmodSync(cli, 0o755)
process.stdout.write('installed')
`,
    'utf8'
  )
  await chmod(bin, 0o755)
  return bin
}

describe('lark documents service', () => {
  it('installs lark-cli into the managed tool directory', async () => {
    const npmBin = await createFakeNpm()
    const managedRoot = await mkdtemp(join(tmpdir(), 'kun-managed-lark-'))
    const result = await installLarkCli({ npmBin, managedRoot })

    expect(result).toMatchObject({
      ok: true,
      status: 'enabled',
      version: '1.0.56'
    })
    if (result.ok) expect(result.cliPath).toContain('node_modules')
  })

  it('configures and authorizes lark-cli for document access', async () => {
    const larkBin = await createFakeLarkCli()

    await expect(configureLarkCli({
      appId: 'cli_fake',
      appSecret: 'secret',
      domain: 'feishu'
    }, { larkBin })).resolves.toMatchObject({
      ok: true,
      status: 'enabled'
    })

    const started = await startLarkDocumentAuth({ larkBin })
    expect(started).toMatchObject({
      ok: true,
      verificationUrl: 'https://example.feishu.cn/auth',
      deviceCode: 'device-123'
    })
    if (!started.ok) return

    await expect(completeLarkDocumentAuth({
      deviceCode: started.deviceCode
    }, { larkBin })).resolves.toMatchObject({
      ok: true,
      status: 'enabled'
    })
  })

  it('lists lark documents through lark-cli search', async () => {
    const larkBin = await createFakeLarkCli()
    const result = await listLarkDocuments({}, { larkBin })

    expect(result.status).toBe('enabled')
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({
      source: 'lark',
      title: 'Fake 文档',
      token: 'fakeToken',
      ownerName: 'Rubick'
    })
  })

  it('imports a lark document as a local markdown file with sidecar metadata', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const listed = await listLarkDocuments({}, { larkBin })

    const result = await importLarkDocumentToWorkspace(
      {
        workspaceRoot,
        document: listed.documents[0]
      },
      { larkBin }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.path).toContain('飞书文档')
    await expect(readFile(result.path, 'utf8')).resolves.toContain('# Fake 文档')
    await expect(readFile(result.metadataPath, 'utf8')).resolves.toContain('"remoteWriteBack": "manual"')
    await expect(readLarkImportMetadata(result.path)).resolves.toMatchObject({ exists: true })
  })

  it('lists locally imported lark documents from sidecar metadata', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const listed = await listLarkDocuments({}, { larkBin })
    const imported = await importLarkDocumentToWorkspace(
      {
        workspaceRoot,
        document: listed.documents[0]
      },
      { larkBin }
    )

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    await expect(listImportedLarkDocuments({ workspaceRoot })).resolves.toMatchObject({
      ok: true,
      documents: [
        {
          path: imported.path,
          metadataPath: imported.metadataPath,
          title: 'Fake 文档',
          token: 'fakeToken',
          documentId: 'fakeToken'
        }
      ]
    })
  })

  it('updates an imported lark document through lark-cli overwrite', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const listed = await listLarkDocuments({}, { larkBin })
    const imported = await importLarkDocumentToWorkspace(
      {
        workspaceRoot,
        document: listed.documents[0]
      },
      { larkBin }
    )

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    await expect(getLarkDocumentImportMetadata({
      workspaceRoot,
      path: imported.path
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        document: {
          token: 'fakeToken'
        }
      }
    })

    const result = await updateLarkDocumentFromWorkspace(
      {
        workspaceRoot,
        path: imported.path,
        mode: 'overwrite',
        content: '# Fake 文档\n\n更新后的正文'
      },
      { larkBin }
    )

    expect(result).toMatchObject({
      ok: true,
      mode: 'overwrite',
      revisionId: 8
    })
    await expect(readFile(imported.metadataPath, 'utf8')).resolves.toContain('"lastPushedMode": "overwrite"')
    await expect(readFile(imported.metadataPath, 'utf8')).resolves.toContain('"lastPushedRevisionId": 8')
  })

  it('refreshes an imported lark document and overwrites the local markdown file', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const listed = await listLarkDocuments({}, { larkBin })
    const imported = await importLarkDocumentToWorkspace(
      {
        workspaceRoot,
        document: listed.documents[0]
      },
      { larkBin }
    )

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    await writeFile(imported.path, '# Local edit\n\n本地未上传内容', 'utf8')

    const result = await refreshLarkDocumentFromWorkspace(
      {
        workspaceRoot,
        path: imported.path
      },
      { larkBin }
    )

    expect(result).toMatchObject({
      ok: true,
      title: 'Fake 文档',
      revisionId: 7
    })
    await expect(readFile(imported.path, 'utf8')).resolves.toContain('正文内容')
    await expect(readFile(imported.path, 'utf8')).resolves.not.toContain('本地未上传内容')
    await expect(readFile(imported.metadataPath, 'utf8')).resolves.toContain('"revisionId": 7')
  })

  it('creates a new lark document from an imported local markdown draft', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const listed = await listLarkDocuments({}, { larkBin })
    const imported = await importLarkDocumentToWorkspace(
      {
        workspaceRoot,
        document: listed.documents[0]
      },
      { larkBin }
    )

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    const result = await updateLarkDocumentFromWorkspace(
      {
        workspaceRoot,
        path: imported.path,
        mode: 'create',
        title: 'Fake 文档 copy',
        content: '# Fake 文档 copy\n\n新建后的正文'
      },
      { larkBin }
    )

    expect(result).toMatchObject({
      ok: true,
      mode: 'create',
      revisionId: 1,
      document: {
        token: 'createdToken',
        url: 'https://example.feishu.cn/docx/createdToken'
      }
    })
    const metadata = await readFile(imported.metadataPath, 'utf8')
    expect(metadata).toContain('"token": "fakeToken"')
    expect(metadata).toContain('"lastPushedMode": "create"')
    expect(metadata).toContain('"lastCreatedDocument"')
    expect(metadata).toContain('"token": "createdToken"')
  })

  it('creates and links a new lark document from a regular local text file', async () => {
    const larkBin = await createFakeLarkCli()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'kun-write-workspace-'))
    const localPath = join(workspaceRoot, 'local-note.txt')
    await writeFile(localPath, 'local text before upload', 'utf8')

    const result = await updateLarkDocumentFromWorkspace(
      {
        workspaceRoot,
        path: localPath,
        mode: 'create',
        title: 'Local note',
        content: '# Local note\n\n新建后的正文'
      },
      { larkBin }
    )

    expect(result).toMatchObject({
      ok: true,
      mode: 'create',
      document: {
        title: 'Local note',
        token: 'createdToken',
        url: 'https://example.feishu.cn/docx/createdToken'
      }
    })
    await expect(readFile(localPath, 'utf8')).resolves.toBe('local text before upload')
    await expect(readFile(`${localPath}.lark.json`, 'utf8')).resolves.toContain('"token": "createdToken"')
    await expect(getLarkDocumentImportMetadata({
      workspaceRoot,
      path: localPath
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        document: {
          token: 'createdToken'
        },
        sync: {
          lastPushedMode: 'create'
        }
      }
    })
  })
})
