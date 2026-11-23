import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

export type LatexToolchainFetch = (url: string, init?: RequestInit) => Promise<Response>
export type TinyTexAsset = { name: string; url: string; size: number; sha256: string; version: string }
const RELEASES = 'https://api.github.com/repos/rstudio/tinytex-releases/releases/latest'
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024

export function tinyTexPlatform(platform: string, arch: string, musl = false): string | null {
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'darwin'
  if (platform === 'win32' && arch === 'x64') return 'windows'
  if (platform === 'linux' && arch === 'x64') return musl ? 'linuxmusl-x86_64' : 'linux-x86_64'
  if (platform === 'linux' && arch === 'arm64' && !musl) return 'linux-arm64'
  return null
}

export async function resolveTinyTexAsset(fetcher: LatexToolchainFetch, platform: string, signal: AbortSignal): Promise<TinyTexAsset> {
  const response = await fetcher(RELEASES, { signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kun-LaTeX' } })
  if (!response.ok) throw new Error(`Cannot check the official TinyTeX release (HTTP ${response.status}).`)
  const text = await response.text()
  if (text.length > 2 * 1024 * 1024) throw new Error('TinyTeX release metadata is too large.')
  const release = JSON.parse(text) as { tag_name?: string; assets?: Array<{ name?: string; size?: number; digest?: string }> }
  if (!release.tag_name || !/^v\d{4}\.\d{2}(?:\.\d+)?$/.test(release.tag_name)) throw new Error('Invalid TinyTeX release version.')
  const name = `TinyTeX-1-${platform}-${release.tag_name}.${platform === 'windows' ? 'exe' : 'tar.xz'}`
  const asset = release.assets?.find((asset) => asset.name === name)
  if (!asset || !Number.isSafeInteger(asset.size) || !asset.size || asset.size < 0 || asset.size > MAX_ARCHIVE_BYTES ||
    !asset.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error('A verified TinyTeX download is not available for this platform.')
  return { name, url: `https://github.com/rstudio/tinytex-releases/releases/download/${release.tag_name}/${name}`,
    size: asset.size, sha256: asset.digest.slice(7), version: release.tag_name }
}

export async function downloadTinyTex(fetcher: LatexToolchainFetch, asset: TinyTexAsset, path: string, signal: AbortSignal,
  onProgress: (bytes: number) => void): Promise<void> {
  const response = await fetcher(asset.url, { signal })
  if (!response.ok || !response.body) throw new Error(`TinyTeX download failed (HTTP ${response.status}).`)
  const file = await open(path, 'wx')
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let bytes = 0
  let lastReport = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > asset.size || bytes > MAX_ARCHIVE_BYTES) throw new Error('TinyTeX download exceeds its declared size.')
      hash.update(value)
      await file.writeFile(value)
      if (Date.now() - lastReport > 150 || bytes === asset.size) { onProgress(bytes); lastReport = Date.now() }
    }
    if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('TinyTeX download checksum or size does not match. Please retry.')
  } finally {
    await file.close()
    await reader.cancel().catch(() => {})
  }
}
