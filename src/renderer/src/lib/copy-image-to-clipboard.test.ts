import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyImageToClipboard, parseImageDataUrl } from './copy-image-to-clipboard'

describe('parseImageDataUrl', () => {
  it('parses a png data URL', () => {
    expect(parseImageDataUrl('data:image/png;base64,QQ==')).toEqual({
      dataBase64: 'QQ==',
      mimeType: 'image/png'
    })
  })

  it('returns null for a remote URL', () => {
    expect(parseImageDataUrl('https://example.com/a.png')).toBeNull()
  })
})

describe('copyImageToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes a workspace path through kunGui', async () => {
    const writeClipboardImage = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { kunGui: { writeClipboardImage } })

    await expect(copyImageToClipboard({
      path: '/repo/img/a.png',
      workspaceRoot: '/repo'
    })).resolves.toEqual({ ok: true })

    expect(writeClipboardImage).toHaveBeenCalledWith({
      path: '/repo/img/a.png',
      workspaceRoot: '/repo'
    })
  })

  it('falls back to data URL when path copy fails', async () => {
    const writeClipboardImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'Path must stay within the selected workspace.' })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('window', { kunGui: { writeClipboardImage } })

    await expect(copyImageToClipboard({
      path: '/tmp/a.png',
      workspaceRoot: '/repo',
      dataUrl: 'data:image/png;base64,QQ=='
    })).resolves.toEqual({ ok: true })

    expect(writeClipboardImage).toHaveBeenNthCalledWith(2, {
      dataBase64: 'QQ==',
      mimeType: 'image/png'
    })
  })

  it('falls back to ClipboardItem when write IPC is missing', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: {} })
    vi.stubGlobal('navigator', {
      clipboard: { write }
    })
    vi.stubGlobal('ClipboardItem', class ClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    })

    await expect(copyImageToClipboard({
      dataUrl: 'data:image/png;base64,QQ=='
    })).resolves.toEqual({ ok: true })

    expect(write).toHaveBeenCalledTimes(1)
    const item = write.mock.calls[0]?.[0]?.[0] as { items: Record<string, Blob> }
    expect(item.items['image/png']).toBeInstanceOf(Blob)
  })
})
