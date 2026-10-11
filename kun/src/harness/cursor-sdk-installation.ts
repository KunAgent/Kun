import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

async function packageVersion(path: string): Promise<string> {
  if ((await stat(path)).size > 64 * 1024) throw new Error('Invalid Cursor SDK package manifest')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || !('version' in value) || typeof value.version !== 'string') {
    throw new Error('Invalid Cursor SDK package manifest')
  }
  return value.version
}

/** Installed SDK 1.0.x local runtime requires its matching rg/sandbox package. */
export async function checkCursorSdkInstallation(input: {
  resolve?: (id: string) => string
  platform?: NodeJS.Platform
  arch?: string
} = {}): Promise<string> {
  const resolve = input.resolve ?? ((id: string) => require.resolve(id))
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const entry = resolve('@cursor/sdk')
  const version = await packageVersion(join(dirname(entry), '..', '..', 'package.json'))
  const nativeManifest = resolve(`@cursor/sdk-${platform}-${arch}/package.json`)
  if (await packageVersion(nativeManifest) !== version) throw new Error('Cursor SDK platform package version mismatch')
  for (const name of ['rg', 'cursorsandbox']) {
    const binary = join(dirname(nativeManifest), 'bin', `${name}${platform === 'win32' ? '.exe' : ''}`)
    if (!(await stat(binary)).isFile()) throw new Error('Cursor SDK platform helper is missing')
    await access(binary, platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK)
  }
  return version
}
