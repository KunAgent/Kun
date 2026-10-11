import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { WorkbenchDirectorySchema, type WorkbenchDirectory } from '../contracts/workbench-links.js'

/** True when `target` equals `root` or lives beneath it (both already canonical). */
export function pathWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function canonicalDirectory(path: string): Promise<string | undefined> {
  try {
    const real = await realpath(resolve(path))
    return (await stat(real)).isDirectory() ? real : undefined
  } catch { return undefined }
}

/**
 * Workspace roots the desktop shell registered. Kun cannot discover Work
 * workspaces or the user's project list by itself, so the shell pushes a
 * snapshot whenever it changes; the last snapshot survives a runtime restart.
 */
export class WorkbenchDirectoryService {
  private current: WorkbenchDirectory = { workRoots: [], codeProjects: [] }
  private loaded = false
  constructor(private readonly path: string) {}

  static forDataDir(dataDir: string): WorkbenchDirectoryService {
    return new WorkbenchDirectoryService(join(dataDir, 'workbench', 'directory.json'))
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = WorkbenchDirectorySchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')))
      if (parsed.success) this.current = parsed.data
    } catch { /* first run or unreadable snapshot: start empty */ }
  }

  async get(): Promise<WorkbenchDirectory> {
    await this.load()
    return this.current
  }

  /** Replace the snapshot; roots that no longer resolve to directories are dropped. */
  async set(raw: unknown): Promise<WorkbenchDirectory> {
    const input = WorkbenchDirectorySchema.parse(raw)
    const keep = async (roots: readonly string[]) => [...new Set((await Promise.all(roots.map(canonicalDirectory)))
      .filter((root): root is string => Boolean(root)))]
    const workRoots = await keep(input.workRoots)
    const defaultCanonical = input.defaultWorkRoot ? await canonicalDirectory(input.defaultWorkRoot) : undefined
    const next: WorkbenchDirectory = {
      workRoots,
      ...(defaultCanonical && workRoots.includes(defaultCanonical) ? { defaultWorkRoot: defaultCanonical } : {}),
      codeProjects: await keep(input.codeProjects)
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temp = this.path + '.tmp'
    await writeFile(temp, JSON.stringify(next), 'utf8')
    await rename(temp, this.path)
    this.current = next
    this.loaded = true
    return next
  }

  /** Work roots an Agent may read; `allowedRoots` (when the Agent has limits) narrows them. */
  async readableWorkRoots(allowedRoots?: readonly string[]): Promise<string[]> {
    const { workRoots } = await this.get()
    return allowedRoots ? workRoots.filter((root) => allowedRoots.some((allowed) => pathWithin(allowed, root))) : workRoots
  }

  /** Where an Agent may create or change Work documents: the default root unless the Agent lists its own. */
  async writableWorkRoots(allowedRoots?: readonly string[]): Promise<string[]> {
    const directory = await this.get()
    if (allowedRoots) return directory.workRoots.filter((root) => allowedRoots.some((allowed) => pathWithin(allowed, root)))
    const fallback = directory.defaultWorkRoot ?? directory.workRoots[0]
    return fallback ? [fallback] : []
  }
}
