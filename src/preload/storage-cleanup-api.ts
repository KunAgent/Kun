import { ipcRenderer } from 'electron'
import type { StorageCleanupApi } from '../shared/storage-cleanup'

export function createStorageCleanupApi(): StorageCleanupApi {
  return {
    getStatus: () => ipcRenderer.invoke('storage-cleanup:status'),
    scan: () => ipcRenderer.invoke('storage-cleanup:scan'),
    enable: (input) => ipcRenderer.invoke('storage-cleanup:enable', input),
    disable: () => ipcRenderer.invoke('storage-cleanup:disable'),
    updateConfig: (patch) => ipcRenderer.invoke('storage-cleanup:update-config', patch),
    preview: (input) => ipcRenderer.invoke('storage-cleanup:preview', input),
    run: (input) => ipcRenderer.invoke('storage-cleanup:run', input),
    clearCaches: () => ipcRenderer.invoke('storage-cleanup:clear-caches'),
    removeMigrationBackups: () => ipcRenderer.invoke('storage-cleanup:remove-migration-backups'),
    skipPendingRun: () => ipcRenderer.invoke('storage-cleanup:skip-pending'),
    history: () => ipcRenderer.invoke('storage-cleanup:history'),
    restoreTrashRun: (runId) => ipcRenderer.invoke('storage-cleanup:restore-trash-run', runId),
    emptyTrash: () => ipcRenderer.invoke('storage-cleanup:empty-trash'),
    reveal: (itemId) => ipcRenderer.invoke('storage-cleanup:reveal', itemId),
    onNoticeClicked: (handler) => {
      const listener = (): void => handler()
      ipcRenderer.on('storage-cleanup:notice-clicked', listener)
      return () => ipcRenderer.removeListener('storage-cleanup:notice-clicked', listener)
    }
  }
}
