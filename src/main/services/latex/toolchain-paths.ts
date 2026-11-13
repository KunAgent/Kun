import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

export async function readManagedLatexBin(root?: string): Promise<string | null> {
  if (!root) return null
  try {
    const record = JSON.parse(await readFile(join(root, 'active.json'), 'utf8')) as { directory?: string; bin?: string }
    if (!record.directory || !/^TinyTeX-[\w.-]+$/.test(record.directory) || !record.bin || !/^bin\/[\w-]+$/.test(record.bin)) return null
    const path = await realpath(join(root, record.directory, record.bin))
    const inside = relative(await realpath(root), path)
    return !inside.startsWith('..') && !isAbsolute(inside) ? path : null
  } catch { return null }
}

export async function existingTinyTexBins(): Promise<string[]> {
  const roots = process.platform === 'darwin' ? [join(homedir(), 'Library', 'TinyTeX')]
    : process.platform === 'win32' ? [join(process.env.APPDATA ?? homedir(), 'TinyTeX')]
      : [join(homedir(), '.TinyTeX')]
  const paths = await Promise.all(roots.map(async (root) => {
    try { return (await readdir(join(root, 'bin'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => join(root, 'bin', entry.name)) }
    catch { return [] }
  }))
  return paths.flat()
}
