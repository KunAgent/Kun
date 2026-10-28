import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: class {}
}))

const { renderArtifactThumbnail } = await import('./artifact-thumbnail-service')
const { loadSharp } = await import('./lazy-sharp')

let root = ''
let cacheDir = ''

async function solidPng(width: number, height: number): Promise<Buffer> {
  const sharp = await loadSharp()
  return sharp({ create: { width, height, channels: 3, background: '#7c3aed' } }).png().toBuffer()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-thumb-ws-'))
  cacheDir = join(root, '.cache')
  await mkdir(join(root, '.kun-design', 'doc-1', 'screen-1'), { recursive: true })
  await writeFile(join(root, '.kun-design', 'doc-1', 'screen-1', 'index.html'), '<h1>hi</h1>')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'report.docx'), 'stub')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('renderArtifactThumbnail', () => {
  it('renders a design screen once and serves later reads from the disk cache', async () => {
    const renderDesign = vi.fn(async () => solidPng(1280, 800))
    const request = { workspaceRoot: root, path: '.kun-design/doc-1/screen-1/index.html', source: 'design-html' as const }

    const first = await renderArtifactThumbnail(request, { cacheDir, renderDesign })
    const second = await renderArtifactThumbnail(request, { cacheDir, renderDesign })

    expect(first).toMatchObject({ ok: true, width: 720, height: 450 })
    expect(second).toMatchObject({ ok: true, width: 720, height: 450 })
    expect(first.ok && first.dataUrl.startsWith('data:image/webp;base64,')).toBe(true)
    expect(renderDesign).toHaveBeenCalledTimes(1)
    expect(await readdir(cacheDir)).toHaveLength(1)
  })

  it('re-renders after the file changes', async () => {
    const renderDesign = vi.fn(async () => solidPng(1280, 800))
    const request = { workspaceRoot: root, path: '.kun-design/doc-1/screen-1/index.html', source: 'design-html' as const }
    await renderArtifactThumbnail(request, { cacheDir, renderDesign })
    const later = new Date(Date.now() + 60_000)
    await utimes(join(root, request.path), later, later)
    await renderArtifactThumbnail(request, { cacheDir, renderDesign })
    expect(renderDesign).toHaveBeenCalledTimes(2)
  })

  it('keeps only the top of a tall document page', async () => {
    const renderOffice = vi.fn(async () => solidPng(800, 4000))
    const result = await renderArtifactThumbnail(
      { workspaceRoot: root, path: 'docs/report.docx', source: 'office' },
      { cacheDir, renderOffice }
    )
    expect(result).toMatchObject({ ok: true, width: 720, height: 1008 })
  })

  it('refuses design HTML outside a design directory and reports render failures', async () => {
    await writeFile(join(root, 'page.html'), '<p>x</p>')
    const outside = await renderArtifactThumbnail(
      { workspaceRoot: root, path: 'page.html', source: 'design-html' },
      { cacheDir, renderDesign: vi.fn() }
    )
    expect(outside.ok).toBe(false)

    const failed = await renderArtifactThumbnail(
      { workspaceRoot: root, path: 'docs/report.docx', source: 'office' },
      { cacheDir, renderOffice: async () => { throw new Error('officecli exploded') } }
    )
    expect(failed).toEqual({ ok: false, message: 'officecli exploded' })
  })
})

describe('withoutOfficeViewerChrome', () => {
  it('hides the OfficeCLI viewer chrome inside the head', async () => {
    const { withoutOfficeViewerChrome } = await import('./artifact-thumbnail-service')
    const html = withoutOfficeViewerChrome('<html><head><title>x</title></head><body></body></html>')
    expect(html).toMatch(/<style>[^<]*\.sidebar[^<]*<\/style><\/head>/)
  })
})
