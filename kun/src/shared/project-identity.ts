import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type CanonicalProjectIdentity = {
  key: string
  sourcePath: string
  kind: 'git' | 'directory'
}

/** Same object-scoped revision in Main settings and Kun task admission. */
export function adeProjectDefaultsRevision(projectKey: string, value: unknown): string {
  return `ade-project-v1:${createHash('sha256')
    .update(JSON.stringify([projectKey, value])).digest('hex')}`
}

/** Source checkout identity shared by Main settings and Kun thread creation. */
export async function canonicalProjectIdentity(projectPath: string): Promise<CanonicalProjectIdentity> {
  const actual = await realpath(resolve(projectPath))
  const git = async (...args: string[]): Promise<string> => {
    const result = await execFileAsync('git', ['-C', actual, ...args], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024
    })
    return result.stdout.trim()
  }
  try {
    const [topLevel, common] = await Promise.all([
      git('rev-parse', '--show-toplevel'),
      git('rev-parse', '--git-common-dir')
    ])
    const commonPath = await realpath(isAbsolute(common) ? common : resolve(actual, common))
    const sourcePath = basename(commonPath) === '.git'
      ? await realpath(dirname(commonPath))
      : await realpath(topLevel)
    return { key: sourcePath, sourcePath, kind: 'git' }
  } catch {
    return { key: actual, sourcePath: actual, kind: 'directory' }
  }
}
