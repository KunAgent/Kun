import { lstat, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import {
  isPathInsideOrEqual,
  sameFilesystemPath
} from './workspace-path.js'

type ExistingKind = 'file' | 'directory' | 'file-or-directory'
type MutationKind = 'file' | 'directory'

type ScopedPathInput = {
  workspaceRoot: string
  scopeRoot: string
  targetPath: string
  label: string
}

export type PptScopedPathProof = {
  lexicalPath: string
  physicalPath: string
  physicalWorkspaceRoot: string
  physicalScopeRoot: string
  exists: boolean
  kind: 'file' | 'directory' | 'missing'
  bytes?: number
}

const MAX_TREE_ENTRIES = 20_000
const MAX_TREE_DEPTH = 64

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function pathSegments(root: string, target: string): string[] {
  const remainder = relative(root, target)
  return remainder ? remainder.split(sep).filter(Boolean) : []
}

function regularFileIdentityIsExclusive(info: Awaited<ReturnType<typeof lstat>>): boolean {
  return info.isFile() && info.nlink === 1 && info.ino !== 0
}

function rejectUnsafeEntry(
  info: Awaited<ReturnType<typeof lstat>>,
  target: string,
  label: string,
  intermediate: boolean
): void {
  if (info.isSymbolicLink()) {
    throw new Error(`${label} contains a symbolic link or junction: ${target}`)
  }
  if (intermediate && !info.isDirectory()) {
    throw new Error(`${label} has a non-directory path component: ${target}`)
  }
  if (info.isFile() && !regularFileIdentityIsExclusive(info)) {
    throw new Error(`${label} contains a hard-linked or unstable file: ${target}`)
  }
}

async function inspectScopedPath(
  input: ScopedPathInput,
  expected: ExistingKind | MutationKind,
  mayBeMissing: boolean
): Promise<PptScopedPathProof> {
  const lexicalWorkspaceRoot = resolve(input.workspaceRoot)
  const lexicalScopeRoot = resolve(input.scopeRoot)
  const lexicalTarget = resolve(input.targetPath)
  if (!isPathInsideOrEqual(lexicalWorkspaceRoot, lexicalScopeRoot)) {
    throw new Error(`${input.label} scope is outside the active workspace`)
  }
  if (!isPathInsideOrEqual(lexicalScopeRoot, lexicalTarget)) {
    throw new Error(`${input.label} is outside its host-managed PPT scope`)
  }

  const workspaceInfo = await lstat(lexicalWorkspaceRoot)
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) {
    throw new Error(`${input.label} workspace root must be a real directory`)
  }
  const physicalWorkspaceRoot = await realpath(lexicalWorkspaceRoot)
  const physicalScopeRoot = resolve(
    physicalWorkspaceRoot,
    ...pathSegments(lexicalWorkspaceRoot, lexicalScopeRoot)
  )
  const targetSegments = pathSegments(lexicalWorkspaceRoot, lexicalTarget)
  let current = lexicalWorkspaceRoot
  let finalInfo: Awaited<ReturnType<typeof lstat>> | undefined
  let missing = false

  for (let index = 0; index < targetSegments.length; index += 1) {
    current = resolve(current, targetSegments[index]!)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(current)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      missing = true
      break
    }
    rejectUnsafeEntry(info, current, input.label, index < targetSegments.length - 1)
    const physical = await realpath(current)
    const expectedPhysical = resolve(
      physicalWorkspaceRoot,
      ...targetSegments.slice(0, index + 1)
    )
    if (!sameFilesystemPath(physical, expectedPhysical)) {
      throw new Error(`${input.label} changes physical location through a link or junction: ${current}`)
    }
    finalInfo = info
  }

  if (missing && !mayBeMissing) {
    throw new Error(`${input.label} does not exist: ${lexicalTarget}`)
  }
  const physicalTarget = resolve(physicalWorkspaceRoot, ...targetSegments)
  if (!isPathInsideOrEqual(physicalScopeRoot, physicalTarget)) {
    throw new Error(`${input.label} resolves outside its host-managed PPT scope`)
  }
  if (!missing) {
    finalInfo ??= workspaceInfo
    if (expected === 'file' && !finalInfo.isFile()) {
      throw new Error(`${input.label} must be a regular file`)
    }
    if (expected === 'directory' && !finalInfo.isDirectory()) {
      throw new Error(`${input.label} must be a directory`)
    }
    if (expected === 'file-or-directory' && !finalInfo.isFile() && !finalInfo.isDirectory()) {
      throw new Error(`${input.label} must be a regular file or directory`)
    }
  }
  return {
    lexicalPath: lexicalTarget,
    physicalPath: physicalTarget,
    physicalWorkspaceRoot,
    physicalScopeRoot,
    exists: !missing,
    kind: missing ? 'missing' : finalInfo!.isDirectory() ? 'directory' : 'file',
    ...(!missing && finalInfo!.isFile() ? { bytes: Number(finalInfo!.size) } : {})
  }
}

async function inspectTree(
  directory: string,
  scopeRoot: string,
  label: string,
  counter: { entries: number },
  depth: number
): Promise<void> {
  if (depth > MAX_TREE_DEPTH) throw new Error(`${label} exceeds the safe directory depth`)
  const entries = await readdir(directory)
  for (const name of entries) {
    counter.entries += 1
    if (counter.entries > MAX_TREE_ENTRIES) throw new Error(`${label} exceeds the safe file count`)
    const target = resolve(directory, name)
    if (!isPathInsideOrEqual(scopeRoot, target)) {
      throw new Error(`${label} contains a path outside its host-managed PPT scope`)
    }
    const info = await lstat(target)
    rejectUnsafeEntry(info, target, label, false)
    const physical = await realpath(target)
    if (!sameFilesystemPath(physical, target) || !isPathInsideOrEqual(scopeRoot, physical)) {
      throw new Error(`${label} contains a linked path outside its host-managed PPT scope: ${target}`)
    }
    if (info.isDirectory()) {
      await inspectTree(target, scopeRoot, label, counter, depth + 1)
    } else if (!info.isFile()) {
      throw new Error(`${label} contains a non-regular filesystem entry: ${target}`)
    }
  }
}

export async function assertPptScopedExistingPath(
  input: ScopedPathInput & { expected: ExistingKind; recursive?: boolean }
): Promise<PptScopedPathProof> {
  const proof = await inspectScopedPath(input, input.expected, false)
  if (input.recursive) {
    const root = proof.kind === 'directory' ? proof.physicalPath : resolve(proof.physicalPath, '..')
    await inspectTree(root, proof.physicalScopeRoot, input.label, { entries: 0 }, 0)
  }
  return proof
}

export async function assertPptScopedMutationPath(
  input: ScopedPathInput & { expected: MutationKind }
): Promise<PptScopedPathProof> {
  return inspectScopedPath(input, input.expected, true)
}
