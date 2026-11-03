import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarketService } from './market-service'
import { installMarketSkill } from './market-skill-installer'
import type { MarketSource } from './market-source'
import { findSkillPrefix, normalizeArchiveEntryPath } from './market-zip-extract'

type ZipFiles = Record<string, string | { content: string; mode?: number }>

async function buildZip(files: ZipFiles): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(files)) {
    const entry = typeof value === 'string' ? { content: value } : value
    zip.file(name, entry.content, entry.mode ? { unixPermissions: entry.mode } : undefined)
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

const DOWNLOAD_URL = 'https://cdn.example.test/demo.zip'

function createSource(downloadUrl = DOWNLOAD_URL, version = '1.0.0'): MarketSource {
  return {
    info: { id: 'demo', label: { en: 'Demo Market' } },
    allowedDownloadHosts: ['.example.test'],
    async fetchCatalog() {
      return {
        skills: [{ sourceId: 'demo', id: 'demo-skill', name: { en: 'Demo' }, description: {}, tags: [], version, downloadUrl }],
        mcpServers: [],
        skillTags: [],
        mcpCategories: []
      }
    }
  }
}

describe('installMarketSkill', () => {
  let temp = ''
  let root = ''

  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), 'market-install-'))
    root = join(temp, 'skills')
    await mkdir(root, { recursive: true })
  })

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true })
  })

  let cacheCounter = 0

  function deps(archive: Buffer | (() => Buffer), source = createSource()) {
    const fetched: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      fetched.push(url)
      const body = typeof archive === 'function' ? archive() : archive
      return new Response(new Uint8Array(body), { status: 200 })
    }
    const service = new MarketService({ sources: [source], cacheDir: join(temp, `cache-${cacheCounter++}`), fetcher })
    return { service, fetcher, fetched }
  }

  const request = { sourceId: 'demo', skillId: 'demo-skill', get rootPath() { return root } }

  it('unpacks the skill folder with its scripts and records where it came from', async () => {
    const archive = await buildZip({
      'demo-skill/SKILL.md': '---\nname: demo-skill\n---\nBody',
      'demo-skill/scripts/run.sh': { content: '#!/bin/sh\necho hi\n', mode: 0o755 },
      'demo-skill/references/guide.md': '# Guide',
      '__MACOSX/demo-skill/._SKILL.md': 'junk',
      'demo-skill/.DS_Store': 'junk'
    })
    const result = await installMarketSkill(request, deps(archive))

    expect(result).toEqual({ ok: true, path: join(root, 'demo-skill', 'SKILL.md'), version: '1.0.0' })
    expect(await readFile(join(root, 'demo-skill', 'SKILL.md'), 'utf8')).toContain('Body')
    expect(await readFile(join(root, 'demo-skill', 'references', 'guide.md'), 'utf8')).toBe('# Guide')
    const script = await stat(join(root, 'demo-skill', 'scripts', 'run.sh'))
    expect(script.mode & 0o111).not.toBe(0)
    const provenance = JSON.parse(await readFile(join(root, 'demo-skill', '.kun-market.json'), 'utf8'))
    expect(provenance).toMatchObject({ sourceId: 'demo', skillId: 'demo-skill', version: '1.0.0', downloadUrl: DOWNLOAD_URL })
    const entries = await readdir(root)
    expect(entries).toEqual(['demo-skill'])
  })

  it('accepts an archive whose SKILL.md sits at the root', async () => {
    const archive = await buildZip({ 'SKILL.md': 'Root skill', 'notes.md': 'n' })
    await expect(installMarketSkill(request, deps(archive))).resolves.toMatchObject({ ok: true })
    expect(await readFile(join(root, 'demo-skill', 'notes.md'), 'utf8')).toBe('n')
  })

  it('refuses an archive with no SKILL.md and leaves nothing behind', async () => {
    const archive = await buildZip({ 'demo-skill/readme.md': 'no skill here' })
    const result = await installMarketSkill(request, deps(archive))
    expect(result).toMatchObject({ ok: false, code: 'failed', message: expect.stringContaining('SKILL.md') })
    expect(await readdir(root)).toEqual([])
  })

  it('refuses path traversal inside the archive', async () => {
    const archive = await buildZip({ 'demo-skill/SKILL.md': 'x', '../../escape.txt': 'pwned' })
    const result = await installMarketSkill(request, deps(archive))
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/invalid relative path|Unsafe path/) })
    expect(await readdir(root)).toEqual([])
    await expect(stat(join(temp, 'escape.txt'))).rejects.toThrow()
  })

  it('skips symlink entries instead of extracting them', async () => {
    const archive = await buildZip({
      'demo-skill/SKILL.md': 'x',
      'demo-skill/link': { content: '/etc/passwd', mode: 0o120777 }
    })
    await installMarketSkill(request, deps(archive))
    await expect(stat(join(root, 'demo-skill', 'link'))).rejects.toThrow()
  })

  it('does not overwrite an existing folder by default', async () => {
    await mkdir(join(root, 'demo-skill'))
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), 'mine', 'utf8')
    const archive = await buildZip({ 'demo-skill/SKILL.md': 'market' })
    const { service, fetcher, fetched } = deps(archive)
    const result = await installMarketSkill(request, { service, fetcher })
    expect(result).toMatchObject({ ok: false, code: 'exists' })
    expect(fetched).toEqual([])
    expect(await readFile(join(root, 'demo-skill', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  it('refuses to overwrite a folder the market did not install', async () => {
    await mkdir(join(root, 'demo-skill'))
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), 'mine', 'utf8')
    const archive = await buildZip({ 'demo-skill/SKILL.md': 'market' })
    const result = await installMarketSkill({ ...request, overwrite: true }, deps(archive))
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not installed from this market') })
    expect(await readFile(join(root, 'demo-skill', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  it('upgrades a market-installed skill in place', async () => {
    await installMarketSkill(request, deps(await buildZip({ 'demo-skill/SKILL.md': 'v1', 'demo-skill/old.md': 'old' })))
    const result = await installMarketSkill(
      { ...request, overwrite: true },
      deps(await buildZip({ 'demo-skill/SKILL.md': 'v2' }), createSource(DOWNLOAD_URL, '2.0.0'))
    )
    expect(result).toMatchObject({ ok: true, version: '2.0.0' })
    expect(await readFile(join(root, 'demo-skill', 'SKILL.md'), 'utf8')).toBe('v2')
    await expect(stat(join(root, 'demo-skill', 'old.md'))).rejects.toThrow()
    expect(await readdir(root)).toEqual(['demo-skill'])
  })

  it('refuses downloads from hosts the source does not own', async () => {
    const source = createSource('https://evil.test/demo.zip')
    const { service, fetcher, fetched } = deps(await buildZip({ 'SKILL.md': 'x' }), source)
    const result = await installMarketSkill(request, { service, fetcher })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('untrusted') })
    expect(fetched).toEqual([])
  })

  it('reports an unknown skill and an HTTP failure', async () => {
    const { service, fetcher } = deps(await buildZip({ 'SKILL.md': 'x' }))
    await expect(installMarketSkill({ ...request, skillId: 'ghost' }, { service, fetcher }))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining('ghost') })
    const failing = new MarketService({
      sources: [createSource()],
      cacheDir: join(temp, 'cache2'),
      fetcher: async () => new Response('', { status: 500 })
    })
    await expect(installMarketSkill(request, { service: failing, fetcher: async () => new Response('', { status: 500 }) }))
      .resolves.toMatchObject({ ok: false, message: expect.stringContaining('HTTP 500') })
  })
})

describe('archive path helpers', () => {
  it('normalizes entry names and rejects unsafe ones', () => {
    expect(normalizeArchiveEntryPath('a\\b/./c.md')).toBe('a/b/c.md')
    expect(normalizeArchiveEntryPath('/etc/passwd')).toBeNull()
    expect(normalizeArchiveEntryPath('C:/windows/x')).toBeNull()
    expect(normalizeArchiveEntryPath('a/../../b')).toBeNull()
    expect(normalizeArchiveEntryPath('__MACOSX/a/._b')).toBeNull()
    expect(normalizeArchiveEntryPath('skill/.DS_Store')).toBeNull()
  })

  it('finds the single skill folder or fails clearly', () => {
    expect(findSkillPrefix(['SKILL.md', 'a.md'])).toBe('')
    expect(findSkillPrefix(['pack/SKILL.md', 'pack/x.md'])).toBe('pack/')
    expect(() => findSkillPrefix(['pack/readme.md'])).toThrow('SKILL.md')
    expect(() => findSkillPrefix(['a/SKILL.md', 'b/SKILL.md'])).toThrow('more than one')
  })
})
