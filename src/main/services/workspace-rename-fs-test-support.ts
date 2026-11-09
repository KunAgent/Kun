import { basename, dirname, join, parse, resolve, sep } from 'node:path'

export type RenameFileInfo = {
  dev: number
  ino: number
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}
export type RenameTestFileSystem = {
  access: (path: string) => Promise<unknown>
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<RenameFileInfo>
  lstat: (path: string) => Promise<RenameFileInfo>
  readdir: (path: string) => Promise<string[]>
  rename: (source: string, target: string) => Promise<void>
}
type Entry = { kind: 'file' | 'directory' | 'symlink'; ino: number; content?: string; target?: string }

/** Models case-preserving lookup and native rename, including overwrite semantics. */
export class WorkspaceRenameFileSystem implements RenameTestFileSystem {
  readonly entries = new Map<string, Entry>()
  failRename = false
  private sequence = 0
  constructor(readonly caseInsensitive: boolean) {
    this.directory(parse(resolve('/')).root)
  }
  directory(path: string): void {
    this.entries.set(resolve(path), { kind: 'directory', ino: ++this.sequence })
  }
  file(path: string, content = 'draft'): void {
    this.entries.set(resolve(path), { kind: 'file', ino: ++this.sequence, content })
  }
  symlink(path: string, target: string): void {
    this.entries.set(resolve(path), { kind: 'symlink', ino: ++this.sequence, target })
  }
  hardlink(path: string, source: string): void {
    this.entries.set(resolve(path), this.lookup(source).entry)
  }
  private lookup(raw: string, followLeaf = true, depth = 0): { path: string; entry: Entry } {
    if (depth > 10) throw new Error('Too many symbolic links')
    const absolute = resolve(raw)
    const root = parse(absolute).root
    const segments = absolute.slice(root.length).split(sep).filter(Boolean)
    let current = root
    for (const [index, segment] of segments.entries()) {
      const requested = join(current, segment)
      const found = [...this.entries.keys()].find((path) => this.caseInsensitive
        ? path.toLowerCase() === requested.toLowerCase()
        : path === requested)
      if (!found) throw Object.assign(new Error(`Missing: ${raw}`), { code: 'ENOENT' })
      current = found
      const entry = this.entries.get(current)!
      if (entry.kind === 'symlink' && (followLeaf || index < segments.length - 1)) {
        return this.lookup(resolve(dirname(current), entry.target!, ...segments.slice(index + 1)), followLeaf, depth + 1)
      }
    }
    const entry = this.entries.get(current)
    if (!entry) throw Object.assign(new Error(`Missing: ${raw}`), { code: 'ENOENT' })
    return { path: current, entry }
  }
  async access(path: string): Promise<void> { this.lookup(path) }
  async realpath(path: string): Promise<string> { return this.lookup(path).path }
  private info(entry: Entry): RenameFileInfo {
    return {
      dev: 1, ino: entry.ino,
      isFile: () => entry.kind === 'file',
      isDirectory: () => entry.kind === 'directory',
      isSymbolicLink: () => entry.kind === 'symlink'
    }
  }
  async stat(path: string): Promise<RenameFileInfo> { return this.info(this.lookup(path).entry) }
  async lstat(path: string): Promise<RenameFileInfo> { return this.info(this.lookup(path, false).entry) }
  async readdir(path: string): Promise<string[]> {
    const directory = this.lookup(path)
    if (directory.entry.kind !== 'directory') throw new Error('Not a directory')
    return [...this.entries.keys()].filter((entry) => entry !== directory.path && dirname(entry) === directory.path)
      .map((entry) => basename(entry))
  }
  async rename(source: string, target: string): Promise<void> {
    if (this.failRename) throw Object.assign(new Error('Rename denied'), { code: 'EPERM' })
    const previous = this.lookup(source, false).path
    const next = join(this.lookup(dirname(target)).path, basename(target))
    let existing: string | undefined
    try { existing = this.lookup(next, false).path } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    // Native rename may overwrite a different target. The service must reject it first.
    if (existing && existing !== previous) this.entries.delete(existing)
    const moved = [...this.entries].filter(([path]) => path === previous || path.startsWith(`${previous}${sep}`))
    for (const [path] of moved) this.entries.delete(path)
    for (const [path, entry] of moved) this.entries.set(`${next}${path.slice(previous.length)}`, entry)
  }
  content(path: string): string | undefined { return this.lookup(path).entry.content }
}
