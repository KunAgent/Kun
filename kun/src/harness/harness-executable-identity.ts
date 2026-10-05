import { statSync, realpathSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, delimiter, join } from 'node:path'
import { harnessExecutableEnv } from './harness-executable-env.js'

/** In-place upgrades must invalidate probes/pools even if their launcher path is unchanged. */
export function harnessExecutableIdentity(path: string | undefined): string {
  if (!path) return 'default'
  if (!isAbsolute(path)) {
    const name = path
    path = (harnessExecutableEnv().PATH ?? '').split(delimiter).flatMap((dir) =>
      (process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']).map((suffix) => join(dir, name + suffix)))
      .find((candidate) => existsSync(candidate)) ?? path
  }
  try {
    const target = realpathSync(path)
    const stat = statSync(target, { bigint: true })
    return createHash('sha256').update(`${target}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`).digest('hex')
  } catch { return createHash('sha256').update(`missing:${path}`).digest('hex') }
}
