import { join } from 'node:path'

export type StorageCleanupPaths = {
  /** `~/.kun`: worktrees, agents, toolchains and (by default) the data dir. */
  kunHome: string
  /** Kun runtime data dir (`~/.kun/data` unless relocated). */
  dataDir: string
  /** Electron userData (`~/Library/Application Support/Kun` on macOS). */
  userData: string
}

export const storageCleanupLocations = {
  trashRoot: (paths: StorageCleanupPaths) => join(paths.kunHome, 'trash', 'storage-cleanup'),
  threadsDir: (paths: StorageCleanupPaths) => join(paths.dataDir, 'threads'),
  taskWorktrees: (paths: StorageCleanupPaths) => join(paths.kunHome, 'worktrees', 'tasks'),
  trajectoryRecords: (paths: StorageCleanupPaths) => join(paths.dataDir, 'observability', 'trajectory', 'records'),
  config: (paths: StorageCleanupPaths) => join(paths.userData, 'storage-cleanup.json'),
  history: (paths: StorageCleanupPaths) => join(paths.userData, 'storage-cleanup-history.json')
}
