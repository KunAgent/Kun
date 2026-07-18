import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { extensionError } from './errors.js'

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/

export type ExtensionPathsOptions = {
  packageRoot?: string
  dataRoot?: string
}

export class ExtensionPaths {
  readonly packageRoot: string
  readonly dataRoot: string
  readonly registryFile: string
  readonly stagingRoot: string
  readonly downloadsRoot: string

  constructor(options: ExtensionPathsOptions = {}) {
    this.packageRoot = resolve(options.packageRoot ?? join(homedir(), '.kun', 'extensions'))
    this.dataRoot = resolve(options.dataRoot ?? join(homedir(), '.kun', 'extension-data'))
    this.registryFile = join(this.packageRoot, 'registry.json')
    this.stagingRoot = join(this.packageRoot, '.staging')
    this.downloadsRoot = join(this.packageRoot, '.downloads')
  }

  packageVersion(extensionId: string, version: string): string {
    assertExtensionId(extensionId)
    assertPathSegment(version, 'version')
    return join(this.packageRoot, extensionId, version)
  }

  extensionData(extensionId: string): string {
    assertExtensionId(extensionId)
    return join(this.dataRoot, extensionId)
  }

  stateDirectory(extensionId: string): string {
    return join(this.extensionData(extensionId), 'state')
  }

  logsDirectory(extensionId: string): string {
    return join(this.extensionData(extensionId), 'logs')
  }

  backupsDirectory(extensionId: string): string {
    return join(this.extensionData(extensionId), 'backups')
  }

  workspaceKey(workspaceRoot: string): string {
    return extensionWorkspaceKey(workspaceRoot)
  }
}

/** Stable opaque workspace identity shared by activation, jobs, and artifacts. */
export function extensionWorkspaceKey(workspaceRoot: string): string {
  if (!isAbsolute(workspaceRoot)) {
    throw extensionError('EXTENSION_WORKSPACE_INVALID', 'Workspace root must be absolute', {
      workspaceRoot
    })
  }
  // Keep activation identity lexical. A workspace may be opened through an
  // absolute symlink; media confinement performs its own canonical realpath checks.
  return createHash('sha256').update(resolve(workspaceRoot)).digest('hex')
}

export function extensionIdentity(publisher: string, name: string): string {
  const id = `${publisher}.${name}`
  assertExtensionId(id)
  return id
}

export function assertExtensionId(extensionId: string): void {
  if (!EXTENSION_ID.test(extensionId)) {
    throw extensionError('EXTENSION_ID_INVALID', 'Extension ID must be publisher.name', {
      extensionId
    })
  }
}

function assertPathSegment(value: string, field: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw extensionError('EXTENSION_PATH_SEGMENT_INVALID', `Invalid extension ${field}`, {
      field,
      value
    })
  }
}
