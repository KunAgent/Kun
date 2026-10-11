import { realpath, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import semver from 'semver'

/** Editor launch scripts with a CLI-shaped name are not Agent protocol servers. */
export async function isApplicationLauncher(command: string): Promise<boolean> {
  const path = (await realpath(command).catch(() => command)).replaceAll('\\', '/')
  return /\/(?:Contents\/Resources|resources)\/app\/bin\/(?:code|qoder|qodercn)(?:\.(?:cmd|exe))?$/i.test(path)
}

/** Bootstrap clients may self-update even on --version; inspect their owned package instead. */
export async function executablePackageVersion(command: string, packageName: string): Promise<string | undefined> {
  let folder = dirname(await realpath(command).catch(() => command))
  for (let depth = 0; depth < 8; depth++) {
    const file = join(folder, 'package.json')
    try {
      if ((await stat(file)).size <= 64 * 1024) {
        const pkg = JSON.parse(await readFile(file, 'utf8'))
        if (pkg.name === packageName && typeof pkg.version === 'string' && semver.valid(pkg.version)) return pkg.version
      }
    } catch { /* Not the selected publisher package. */ }
    const parent = dirname(folder)
    if (parent === folder) break
    folder = parent
  }
  return undefined
}
