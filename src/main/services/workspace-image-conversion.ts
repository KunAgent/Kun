import { nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Formats Chromium cannot decode; the preview shows a PNG copy instead. */
export const CONVERTED_IMAGE_EXTENSIONS = new Set(['.heic', '.heif', '.tif', '.tiff'])

export const MAX_CONVERTED_IMAGE_SOURCE_BYTES = 80 * 1024 * 1024
const MAX_CONVERTED_IMAGE_EDGE = 4096
const CONVERSION_TIMEOUT_MS = 20_000

/**
 * Converts an image to PNG bytes for preview, or returns null when this
 * platform has no converter. macOS uses the bundled `sips`; Windows uses the
 * shell thumbnail provider. The source file is never modified.
 */
export async function convertImageToPng(
  sourcePath: string,
  platform: NodeJS.Platform = process.platform
): Promise<Buffer | null> {
  if (platform === 'darwin') {
    const directory = await mkdtemp(join(tmpdir(), 'kun-image-preview-'))
    const outputPath = join(directory, 'preview.png')
    try {
      // `-Z` also enlarges, so only pass it when the image is bigger than the cap.
      const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', sourcePath],
        { timeout: CONVERSION_TIMEOUT_MS })
      const edges = [...stdout.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((match) => Number(match[1]))
      const resize = Math.max(0, ...edges) > MAX_CONVERTED_IMAGE_EDGE ? ['-Z', String(MAX_CONVERTED_IMAGE_EDGE)] : []
      await execFileAsync(
        '/usr/bin/sips',
        ['-s', 'format', 'png', ...resize, sourcePath, '--out', outputPath],
        { timeout: CONVERSION_TIMEOUT_MS }
      )
      return await readFile(outputPath)
    } catch {
      return null
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  if (platform === 'win32' && typeof nativeImage?.createThumbnailFromPath === 'function') {
    try {
      const image = await nativeImage.createThumbnailFromPath(sourcePath, {
        width: MAX_CONVERTED_IMAGE_EDGE / 2,
        height: MAX_CONVERTED_IMAGE_EDGE / 2
      })
      return image.isEmpty() ? null : image.toPNG()
    } catch {
      return null
    }
  }
  return null
}
