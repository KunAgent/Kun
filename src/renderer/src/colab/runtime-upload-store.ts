import { create } from 'zustand'
import type { RuntimeUploadProgress, RuntimeUploadResult } from '@shared/colab/runtime-upload'

type UploadState =
  | { busy: true; progress?: RuntimeUploadProgress; targetRemoteDir?: string }
  | { busy: false; result: RuntimeUploadResult; targetRemoteDir?: string }

type UploadStore = {
  sessions: Record<string, UploadState | undefined>
  start: (
    sessionId: string,
    workspaceNotebook?: string,
    prepare?: () => Promise<void>,
    targetRemoteDir?: string
  ) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
}

// Keep transfers alive when the Files tab unmounts. Only the active invoke owns its IPC listener.
export const useRuntimeUploads = create<UploadStore>((set, get) => {
  const put = (id: string, value: UploadState): void => set((state) => ({ sessions: { ...state.sessions, [id]: value } }))
  return {
    sessions: {},
    start: async (sessionId, workspaceNotebook, prepare, targetRemoteDir) => {
      if (get().sessions[sessionId]?.busy) return
      const dirMeta = targetRemoteDir ? { targetRemoteDir } : {}
      put(sessionId, { busy: true, ...dirMeta })
      let unsubscribe: (() => void) | undefined
      try {
        await prepare?.()
        unsubscribe = window.kunGui.onColabUploadProgress((event) => {
          if (event.sessionId === sessionId) put(sessionId, { busy: true, progress: event, ...dirMeta })
        })
        const result = await window.kunGui.colabUploadToSession({
          sessionId,
          workspaceNotebook,
          ...dirMeta
        })
        put(sessionId, { busy: false, result, ...dirMeta })
      } catch (error) {
        put(sessionId, {
          busy: false,
          result: { ok: false, uploadedCount: 0, message: String(error instanceof Error ? error.message : error) },
          ...dirMeta
        })
      } finally {
        unsubscribe?.()
      }
    },
    cancel: async (sessionId) => {
      if (get().sessions[sessionId]?.busy) await window.kunGui.colabCancelUpload({ sessionId })
    }
  }
})
