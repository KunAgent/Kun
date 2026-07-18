import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  buildMigrationDestinationPath,
  parsePackageRelativePath,
  type DataMigrationFileConflictResolution,
  type DataMigrationPackageEntry,
  type DataMigrationSourcePlatform,
  type DataMigrationWorkspaceConflictStrategy,
  type PackageRelativePath
} from '../../shared/data-migration'
import { validateKunpackLinkMetadata } from './archive-security'
import { stableImportedSiblingPath } from './import-planner'
import { extractZip64ArchiveEntries } from './kunpack-zip'

export type StagedWorkspaceFile = {
  entry: DataMigrationPackageEntry
  relativePath: PackageRelativePath
  stagedPath: string
  ordinal: number
}

export type StagedWorkspace = {
  operationId: string
  workspaceId: string
  stagingRoot: string
  destinationRoot: string
  backupRoot: string
  files: StagedWorkspaceFile[]
}

export type WorkspaceCommitMutation = {
  kind: 'create' | 'replace' | 'backup' | 'skip' | 'identical' | 'sibling'
  destinationPath: string
  sourcePath?: string
  backupPath?: string
  expectedSha256?: string
  originalSha256?: string
}

export type WorkspaceCommitMutationLifecycle = {
  before: (mutation: WorkspaceCommitMutation, ordinal: number) => Promise<void>
  after: (mutation: WorkspaceCommitMutation, ordinal: number) => Promise<void>
}

export async function stageWorkspaceImport(input: {
  operationId: string
  workspaceId: string
  archivePath: string
  entries: readonly DataMigrationPackageEntry[]
  destinationRoot: string
  destinationPlatform: DataMigrationSourcePlatform
  supportsSymbolicLinks: boolean
  signal?: AbortSignal
  onProgress?: (value: { path: PackageRelativePath; bytes: number; entries: number }) => void
}): Promise<StagedWorkspace> {
  const destinationRoot = resolve(input.destinationRoot)
  const stagingRoot = join(dirname(destinationRoot), `.kun-migration-staging-${input.operationId}-${input.workspaceId}`)
  const backupRoot = join(dirname(destinationRoot), '.kun-migration-backup', input.operationId, input.workspaceId)
  if (await exists(stagingRoot)) throw new Error(`migration staging root already exists: ${stagingRoot}`)
  const files: StagedWorkspaceFile[] = []
  for (const entry of input.entries) {
    const relativePath = workspaceEntryRelativePath(entry.path, input.workspaceId)
    if (!relativePath) continue
    const stagedPath = buildMigrationDestinationPath({
      destinationRoot: stagingRoot,
      relativePath,
      destinationPlatform: input.destinationPlatform
    })
    assertBelow(stagingRoot, stagedPath)
    files.push({ entry, relativePath, stagedPath, ordinal: files.length * 2 })
  }
  validateKunpackLinkMetadata(files.map((file) => file.entry), { allowLinks: input.supportsSymbolicLinks })
  try {
    await extractZip64ArchiveEntries({
      archivePath: input.archivePath,
      destinationRoot: stagingRoot,
      entries: files.map((file) => file.entry),
      destinationPath: (entry) => files.find((file) => file.entry.path === entry.path)?.stagedPath ?? null,
      signal: input.signal,
      onProgress: input.onProgress
    })
    for (const file of files) {
      if (!file.entry.linkTarget) continue
      const targetRelativePath = workspaceEntryRelativePath(file.entry.linkTarget, input.workspaceId)
      if (!targetRelativePath) throw new Error(`link target leaves workspace payload: ${file.entry.path}`)
      const targetPath = buildMigrationDestinationPath({
        destinationRoot: stagingRoot,
        relativePath: targetRelativePath,
        destinationPlatform: input.destinationPlatform
      })
      assertBelow(stagingRoot, targetPath)
      await mkdir(dirname(file.stagedPath), { recursive: true, mode: 0o700 })
      await symlink(relative(dirname(file.stagedPath), targetPath), file.stagedPath)
    }
    return { operationId: input.operationId, workspaceId: input.workspaceId, stagingRoot, destinationRoot, backupRoot, files }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export function reconstructStagedWorkspace(input: {
  operationId: string
  workspaceId: string
  entries: readonly DataMigrationPackageEntry[]
  destinationRoot: string
}): StagedWorkspace {
  const destinationRoot = resolve(input.destinationRoot)
  const stagingRoot = join(dirname(destinationRoot), `.kun-migration-staging-${input.operationId}-${input.workspaceId}`)
  const backupRoot = join(dirname(destinationRoot), '.kun-migration-backup', input.operationId, input.workspaceId)
  const files: StagedWorkspaceFile[] = []
  for (const entry of input.entries) {
    const relativePath = workspaceEntryRelativePath(entry.path, input.workspaceId)
    if (!relativePath) throw new Error(`recovery entry does not belong to workspace ${input.workspaceId}: ${entry.path}`)
    const stagedPath = buildMigrationDestinationPath({
      destinationRoot: stagingRoot,
      relativePath,
      destinationPlatform: currentPlatform()
    })
    assertBelow(stagingRoot, stagedPath)
    files.push({ entry, relativePath, stagedPath, ordinal: files.length * 2 })
  }
  return { operationId: input.operationId, workspaceId: input.workspaceId, stagingRoot, destinationRoot, backupRoot, files }
}

export async function commitStagedWorkspace(input: {
  staged: StagedWorkspace
  strategy: DataMigrationWorkspaceConflictStrategy
  resolutions?: Readonly<Record<string, DataMigrationFileConflictResolution | undefined>>
  renamedPaths?: Readonly<Record<string, PackageRelativePath | undefined>>
  signal?: AbortSignal
  lifecycle?: WorkspaceCommitMutationLifecycle
}): Promise<{ mutations: WorkspaceCommitMutation[]; backupRoot?: string }> {
  const { staged } = input
  input.signal?.throwIfAborted()
  if (input.strategy === 'skip') {
    await rm(staged.stagingRoot, { recursive: true, force: true })
    return { mutations: [] }
  }
  if (input.strategy === 'keep-both') {
    if (await exists(staged.destinationRoot)) throw new Error('Keep both destination became occupied before commit')
    const mutation: WorkspaceCommitMutation = {
      kind: 'create',
      destinationPath: staged.destinationRoot,
      sourcePath: staged.stagingRoot,
      expectedSha256: `tree:${await treeIdentity(staged.stagingRoot)}`
    }
    await input.lifecycle?.before(mutation, 0)
    await rename(staged.stagingRoot, staged.destinationRoot)
    await hardenTreePermissions(staged.destinationRoot)
    await input.lifecycle?.after(mutation, 0)
    return {
      mutations: [mutation]
    }
  }

  await mkdir(staged.destinationRoot, { recursive: true, mode: 0o700 })
  const mutations: WorkspaceCommitMutation[] = []
  let usedBackup = false
  for (const file of staged.files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    input.signal?.throwIfAborted()
    const destinationPath = buildMigrationDestinationPath({
      destinationRoot: staged.destinationRoot,
      relativePath: file.relativePath,
      destinationPlatform: currentPlatform()
    })
    assertBelow(staged.destinationRoot, destinationPath)
    const target = await lstat(destinationPath).catch(() => null)
    const existingBackupPath = join(staged.backupRoot, ...file.relativePath.split('/'))
    if (!target && await exists(existingBackupPath)) {
      const expectedIdentity = await stagedFileIdentity(file)
      const mutation: WorkspaceCommitMutation = {
        kind: 'replace',
        destinationPath,
        sourcePath: file.stagedPath,
        backupPath: existingBackupPath,
        expectedSha256: expectedIdentity,
        originalSha256: await pathIdentity(existingBackupPath)
      }
      await input.lifecycle?.before(mutation, file.ordinal + 1)
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
      await rename(file.stagedPath, destinationPath)
      mutations.push(mutation)
      usedBackup = true
      await input.lifecycle?.after(mutation, file.ordinal + 1)
      continue
    }
    if (!target) {
      const expectedIdentity = await stagedFileIdentity(file)
      const mutation: WorkspaceCommitMutation = {
        kind: 'create', destinationPath, sourcePath: file.stagedPath, expectedSha256: expectedIdentity
      }
      await input.lifecycle?.before(mutation, file.ordinal)
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
      await rename(file.stagedPath, destinationPath)
      mutations.push(mutation)
      await input.lifecycle?.after(mutation, file.ordinal)
      continue
    }
    if (target.isFile() && !file.entry.linkTarget && await sha256File(destinationPath) === file.entry.sha256) {
      const mutation: WorkspaceCommitMutation = {
        kind: 'identical', destinationPath, sourcePath: file.stagedPath, expectedSha256: file.entry.sha256
      }
      await input.lifecycle?.before(mutation, file.ordinal)
      await rm(file.stagedPath, { force: true })
      mutations.push(mutation)
      await input.lifecycle?.after(mutation, file.ordinal)
      continue
    }
    const decision = input.strategy === 'replace'
      ? 'replace-with-backup'
      : input.resolutions?.[file.relativePath]
    if (!decision) throw new Error(`unresolved migration conflict: ${file.relativePath}`)
    if (decision === 'keep-target' || decision === 'skip') {
      const mutation: WorkspaceCommitMutation = { kind: 'skip', destinationPath, sourcePath: file.stagedPath }
      await input.lifecycle?.before(mutation, file.ordinal)
      await rm(file.stagedPath, { recursive: true, force: true })
      mutations.push(mutation)
      await input.lifecycle?.after(mutation, file.ordinal)
      continue
    }
    if (decision === 'import-sibling' || decision === 'rename-source') {
      const renamed = input.renamedPaths?.[file.relativePath] ?? stableImportedSiblingPath(file.relativePath, file.entry.sha256)
      const siblingPath = buildMigrationDestinationPath({
        destinationRoot: staged.destinationRoot,
        relativePath: renamed,
        destinationPlatform: currentPlatform()
      })
      assertBelow(staged.destinationRoot, siblingPath)
      if (await exists(siblingPath)) throw new Error(`migration sibling destination already exists: ${renamed}`)
      const expectedIdentity = await stagedFileIdentity(file)
      const mutation: WorkspaceCommitMutation = {
        kind: 'sibling', destinationPath: siblingPath, sourcePath: file.stagedPath, expectedSha256: expectedIdentity
      }
      await input.lifecycle?.before(mutation, file.ordinal)
      await mkdir(dirname(siblingPath), { recursive: true, mode: 0o700 })
      await rename(file.stagedPath, siblingPath)
      mutations.push(mutation)
      await input.lifecycle?.after(mutation, file.ordinal)
      continue
    }
    const backupPath = join(staged.backupRoot, ...file.relativePath.split('/'))
    assertBelow(staged.backupRoot, backupPath)
    if (await exists(backupPath)) throw new Error(`migration backup path already exists: ${backupPath}`)
    const backupMutation: WorkspaceCommitMutation = {
      kind: 'backup',
      destinationPath,
      backupPath,
      originalSha256: await pathIdentity(destinationPath)
    }
    await input.lifecycle?.before(backupMutation, file.ordinal)
    await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 })
    await rename(destinationPath, backupPath)
    usedBackup = true
    mutations.push(backupMutation)
    await input.lifecycle?.after(backupMutation, file.ordinal)
    try {
      const expectedIdentity = await stagedFileIdentity(file)
      const replaceMutation: WorkspaceCommitMutation = {
        kind: 'replace',
        destinationPath,
        sourcePath: file.stagedPath,
        backupPath,
        expectedSha256: expectedIdentity,
        originalSha256: backupMutation.originalSha256
      }
      await input.lifecycle?.before(replaceMutation, file.ordinal + 1)
      await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 })
      await rename(file.stagedPath, destinationPath)
      mutations.push(replaceMutation)
      await input.lifecycle?.after(replaceMutation, file.ordinal + 1)
    } catch (error) {
      await rename(backupPath, destinationPath).catch(() => undefined)
      throw error
    }
  }
  await rm(staged.stagingRoot, { recursive: true, force: true })
  await hardenTreePermissions(staged.destinationRoot)
  return { mutations, ...(usedBackup ? { backupRoot: staged.backupRoot } : {}) }
}

export async function restoreWorkspaceCommit(mutations: readonly WorkspaceCommitMutation[]): Promise<string[]> {
  const warnings: string[] = []
  for (const mutation of [...mutations].reverse()) {
    if (mutation.kind === 'skip' || mutation.kind === 'identical') continue
    if (mutation.kind === 'backup') {
      if (!mutation.backupPath || !await exists(mutation.backupPath)) continue
      const current = await lstat(mutation.destinationPath).catch(() => null)
      if (current) {
        warnings.push(`Preserved destination created after backup: ${mutation.destinationPath}`)
        continue
      }
      if (mutation.originalSha256 && await pathIdentity(mutation.backupPath) !== mutation.originalSha256) {
        warnings.push(`Preserved independently modified backup: ${mutation.backupPath}`)
        continue
      }
      await mkdir(dirname(mutation.destinationPath), { recursive: true, mode: 0o700 })
      await rename(mutation.backupPath, mutation.destinationPath)
      continue
    }
    const current = await lstat(mutation.destinationPath).catch(() => null)
    if (current && mutation.expectedSha256) {
      const currentIdentity = current.isDirectory()
        ? `tree:${await treeIdentity(mutation.destinationPath)}`
        : current.isSymbolicLink()
          ? `link:${await readlink(mutation.destinationPath)}`
          : current.isFile()
            ? await sha256File(mutation.destinationPath)
            : 'unsupported'
      if (currentIdentity !== mutation.expectedSha256) {
        warnings.push(`Preserved independently modified path: ${mutation.destinationPath}`)
        continue
      }
    }
    if (current) await rm(mutation.destinationPath, { recursive: true, force: true })
    if (mutation.backupPath && await exists(mutation.backupPath)) {
      await mkdir(dirname(mutation.destinationPath), { recursive: true, mode: 0o700 })
      await rename(mutation.backupPath, mutation.destinationPath)
    }
  }
  return warnings
}

export async function verifyWorkspaceCommit(mutations: readonly WorkspaceCommitMutation[]): Promise<void> {
  for (const mutation of mutations) {
    if (mutation.kind === 'skip') continue
    if (mutation.kind === 'backup') {
      if (!mutation.backupPath || !await exists(mutation.backupPath)) {
        // A following replace mutation may already have restored the backup during rollback;
        // verification is only called for forward commits, where it must still exist.
        throw new Error(`migration backup is missing after commit: ${mutation.backupPath ?? mutation.destinationPath}`)
      }
      if (mutation.originalSha256 && await pathIdentity(mutation.backupPath) !== mutation.originalSha256) {
        throw new Error(`migration backup identity changed after commit: ${mutation.backupPath}`)
      }
      continue
    }
    const current = await lstat(mutation.destinationPath).catch(() => null)
    if (!current) throw new Error(`migration destination is missing after commit: ${mutation.destinationPath}`)
    if (mutation.expectedSha256 && await pathIdentity(mutation.destinationPath) !== mutation.expectedSha256) {
      throw new Error(`migration destination identity mismatch after commit: ${mutation.destinationPath}`)
    }
  }
}

function workspaceEntryRelativePath(path: PackageRelativePath, workspaceId: string): PackageRelativePath | null {
  const prefix = `payload/workspaces/${workspaceId}/files/`
  return path.startsWith(prefix) ? parsePackageRelativePath(path.slice(prefix.length)) : null
}

function assertBelow(root: string, path: string): void {
  const candidate = relative(resolve(root), resolve(path))
  if (!candidate || candidate.startsWith('..') || isAbsolute(candidate)) {
    throw new Error(`migration path escapes root: ${path}`)
  }
}

async function hardenTreePermissions(root: string): Promise<void> {
  const details = await lstat(root)
  if (details.isSymbolicLink()) return
  await chmod(root, details.isDirectory() ? 0o700 : 0o600 | (details.mode & 0o111))
  if (!details.isDirectory()) return
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(root)) await hardenTreePermissions(join(root, name))
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false)
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function stagedFileIdentity(file: StagedWorkspaceFile): Promise<string> {
  return file.entry.linkTarget ? `link:${await readlink(file.stagedPath)}` : file.entry.sha256
}

async function pathIdentity(path: string): Promise<string> {
  const details = await lstat(path)
  if (details.isDirectory()) return `tree:${await treeIdentity(path)}`
  if (details.isSymbolicLink()) return `link:${await readlink(path)}`
  if (details.isFile()) return sha256File(path)
  return 'unsupported'
}

async function treeIdentity(root: string): Promise<string> {
  const hash = createHash('sha256')
  const { readdir } = await import('node:fs/promises')
  const walk = async (path: string, prefix: string): Promise<void> => {
    const details = await lstat(path)
    if (details.isSymbolicLink()) {
      hash.update(`l\0${prefix}\0${await readlink(path)}\n`)
      return
    }
    if (details.isDirectory()) {
      hash.update(`d\0${prefix}\n`)
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), prefix ? `${prefix}/${name}` : name)
      return
    }
    if (details.isFile()) hash.update(`f\0${prefix}\0${await sha256File(path)}\n`)
  }
  await walk(root, '')
  return hash.digest('hex')
}

function currentPlatform(): DataMigrationSourcePlatform {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
}
