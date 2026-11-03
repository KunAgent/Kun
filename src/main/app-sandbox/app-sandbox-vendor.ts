import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Library URLs a Gen UI page may reference from the allowed CDNs, served from
 * bundled copies so widgets work offline and without slow CDN round trips.
 * Packaged builds copy the files to `<resources>/gen-ui-vendor` (see
 * electron-builder.config.cjs); development reads them from node_modules.
 */
type VendorFile = {
  file: string
  /** Path below the app root in development. */
  devPath: string
  urls: readonly string[]
}

const VENDOR_FILES: readonly VendorFile[] = [
  {
    file: 'd3.min.js',
    devPath: 'node_modules/d3/dist/d3.min.js',
    urls: [
      'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
      'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
      'https://unpkg.com/d3@7.9.0/dist/d3.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js'
    ]
  },
  {
    file: 'echarts.min.js',
    devPath: 'node_modules/echarts/dist/echarts.min.js',
    urls: [
      'https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js',
      'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js',
      'https://unpkg.com/echarts@5.6.0/dist/echarts.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.6.0/echarts.min.js'
    ]
  },
  {
    file: 'lucide.min.js',
    devPath: 'node_modules/lucide/dist/umd/lucide.min.js',
    urls: [
      'https://cdn.jsdelivr.net/npm/lucide@0.544.0/dist/umd/lucide.min.js',
      'https://unpkg.com/lucide@0.544.0/dist/umd/lucide.min.js'
    ]
  }
]

const BY_URL = new Map<string, VendorFile>(
  VENDOR_FILES.flatMap((entry) => entry.urls.map((url) => [url, entry] as const))
)

export function genUiVendorUrls(): string[] {
  return [...BY_URL.keys()]
}

export function isGenUiVendorUrl(url: string): boolean {
  return BY_URL.has(url.split('#')[0]!)
}

export type GenUiVendorLocation = {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

/** Read a bundled library for an exact allow-listed URL; unknown URLs return null. */
export async function readGenUiVendorFile(
  url: string,
  location: GenUiVendorLocation
): Promise<Uint8Array | null> {
  const entry = BY_URL.get(url.split('#')[0]!)
  if (!entry) return null
  const path = location.isPackaged
    ? join(location.resourcesPath, 'gen-ui-vendor', entry.file)
    : join(location.appPath, entry.devPath)
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}
