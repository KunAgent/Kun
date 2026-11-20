import { create } from 'zustand'
import type { RuntimeUploadProgress, RuntimeUploadResult } from '@shared/colab/runtime-upload'

type UploadState =
  | { busy: true; progress?: RuntimeUploadProgress }
  | { busy: false; result: RuntimeUploadResult }

type UploadStore = {
  sessions: Record<string, UploadState | undefined>
  start: (sessionId: string, workspaceNotebook?: string, prepare?: () => Promise<void>) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
}

// Keep transfers alive when the Files tab unmounts. Only the active invoke owns its IPC listener.
export const useRuntimeUploads = create<UploadStore>((set, get) => {
  const put = (id: string, value: UploadState): void => set((state) => ({ sessions: { ...state.sessions, [id]: value } }))
  return {
    sessions: {},
    start: async (sessionId, workspaceNotebook, prepare) => {
      if (get().sessions[sessionId]?.busy) return
      put(sessionId, { busy: true })
      let unsubscribe: (() => void) | undefined
      try {
        await prepare?.()
        unsubscribe = window.kunGui.onColabUploadProgress((event) => {
          if (event.sessionId === sessionId) put(sessionId, { busy: true, progress: event })
        })
        const result = await window.kunGui.colabUploadToSession({ sessionId, workspaceNotebook })
        put(sessionId, { busy: false, result })
      } catch (error) {
        put(sessionId, { busy: false, result: { ok: false, uploadedCount: 0, message: String(error instanceof Error ? error.message : error) } })
      } finally {
        unsubscribe?.()
      }
    },
    cancel: async (sessionId) => {
      if (get().sessions[sessionId]?.busy) await window.kunGui.colabCancelUpload({ sessionId })
    }
  }
})
