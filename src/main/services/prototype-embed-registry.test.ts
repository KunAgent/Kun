import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authorizePrototypePath,
  clearAuthorizedPrototypes,
  isAuthorizedPrototypeFileUrl
} from './prototype-embed-registry'

let workspace: string

describe('prototype embed registry', () => {
  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'proto-registry-')))
    mkdirSync(join(workspace, '.kunsdd', 'proto'), { recursive: true })
    writeFileSync(join(workspace, '.kunsdd', 'proto', 'page.html'), '<html></html>')
  })

  afterEach(() => {
    clearAuthorizedPrototypes()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('authorizes a contained prototype and allow-lists its file url', async () => {
    const result = await authorizePrototypePath(
      join(workspace, '.kunsdd', 'proto', 'page.html'),
      workspace
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.fileUrl.startsWith('file://')).toBe(true)
    expect(isAuthorizedPrototypeFileUrl(result.fileUrl)).toBe(true)
  })

  it('authorizes the nested inline component prototype artifact path', async () => {
    const relativePath = join(
      '.kun-design',
      'component-prototypes',
      'date-range-picker-abcdef',
      'prototype.html'
    )
    mkdirSync(join(workspace, relativePath, '..'), { recursive: true })
    writeFileSync(join(workspace, relativePath), '<!doctype html><html></html>')

    const result = await authorizePrototypePath(relativePath, workspace)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.absolutePath).toBe(join(workspace, relativePath))
    expect(isAuthorizedPrototypeFileUrl(result.fileUrl)).toBe(true)
  })

  it('rejects non-html files and files outside a proto directory', async () => {
    writeFileSync(join(workspace, '.kunsdd', 'proto', 'notes.txt'), 'x')
    writeFileSync(join(workspace, 'loose.html'), '<html></html>')

    const txt = await authorizePrototypePath(join(workspace, '.kunsdd', 'proto', 'notes.txt'), workspace)
    expect(txt.ok).toBe(false)

    const loose = await authorizePrototypePath(join(workspace, 'loose.html'), workspace)
    expect(loose).toMatchObject({ ok: false, message: expect.stringContaining('directory') })
  })

  it('rejects paths escaping the workspace and missing files', async () => {
    const escaped = await authorizePrototypePath('/tmp/.kunsdd/proto/evil.html', workspace)
    expect(escaped.ok).toBe(false)

    const missing = await authorizePrototypePath(
      join(workspace, '.kunsdd', 'proto', 'gone.html'),
      workspace
    )
    expect(missing).toMatchObject({ ok: false, message: expect.stringContaining('not found') })
  })

  it('only admits exact previously-authorized file urls', () => {
    expect(isAuthorizedPrototypeFileUrl('file:///anything.html')).toBe(false)
    expect(isAuthorizedPrototypeFileUrl('https://example.com')).toBe(false)
  })
})
