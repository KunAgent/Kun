import { useEffect } from 'react'
import { create } from 'zustand'
import type { ColabDriveMountResult, ColabDriveMountState } from '@shared/colab/colab-notebook-types'

type DriveMountStore = {
  states: Record<string, ColabDriveMountState | undefined>
  probedSessions: Record<string, boolean | undefined>
  autoMountAttemptedSessions: Record<string, boolean | undefined>
  applyState: (state: ColabDriveMountState) => void
  syncStatus: (sessionId: string, options?: { probe?: boolean }) => Promise<ColabDriveMountState | null>
  autoMountSession: (sessionId: string) => void
  mount: (sessionId: string, options?: { forceRemount?: boolean }) => Promise<ColabDriveMountResult>
  completeAuth: (sessionId: string) => Promise<ColabDriveMountResult>
  openAuth: (sessionId: string) => Promise<boolean>
  cancelMount: (sessionId: string) => Promise<void>
  unmount: (sessionId: string) => Promise<ColabDriveMountResult>
}

export const useColabDriveStore = create<DriveMountStore>((set, get) => ({
  states: {},
  probedSessions: {},
  autoMountAttemptedSessions: {},

  applyState: (next) =>
    set((s) => ({
      states: { ...s.states, [next.sessionId]: next },
      ...(next.status === 'mounted'
        ? { probedSessions: { ...s.probedSessions, [next.sessionId]: true } }
        : {})
    })),

  syncStatus: async (sessionId, options) => {
    if (typeof window === 'undefined' || typeof window.kunGui?.colabDriveGetMountState !== 'function') {
      return null
    }
    const probe = Boolean(options?.probe)
    try {
      const state = await window.kunGui.colabDriveGetMountState({ sessionId, probe })
      if (probe && (state.status === 'mounted' || state.status === 'unmounted')) {
        set((s) => ({ probedSessions: { ...s.probedSessions, [sessionId]: true } }))
      }
      get().applyState(state)
      return state
    } catch {
      return null
    }
  },

  autoMountSession: (sessionId) => {
    if (typeof window === 'undefined' || typeof window.kunGui?.colabDriveMount !== 'function') {
      return
    }
    if (!sessionId || get().autoMountAttemptedSessions[sessionId]) return
    set((s) => ({
      autoMountAttemptedSessions: { ...s.autoMountAttemptedSessions, [sessionId]: true }
    }))
    void get().mount(sessionId)
  },

  mount: async (sessionId, options) => {
    if (typeof window.kunGui?.colabDriveMount !== 'function') {
      return { ok: false, message: 'Google Drive mount bridge is unavailable.' }
    }
    const cur = get().states[sessionId]
    if (!options?.forceRemount && cur?.status !== 'needs_auth') {
      get().applyState({ sessionId, status: 'mounting' })
    } else if (options?.forceRemount) {
      get().applyState({ sessionId, status: 'mounting' })
    }
    try {
      const res = await window.kunGui.colabDriveMount({
        sessionId,
        forceRemount: options?.forceRemount
      })
      if (res.state) get().applyState(res.state)
      else if (!res.ok) {
        get().applyState({ sessionId, status: 'error', message: res.message, code: res.code })
      }
      return res
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errState: ColabDriveMountState = { sessionId, status: 'error', message }
      get().applyState(errState)
      return { ok: false, message, state: errState }
    }
  },

  completeAuth: async (sessionId) => {
    if (typeof window.kunGui?.colabDriveCompleteMountAuth !== 'function') {
      return { ok: false, message: 'Google Drive authorization bridge is unavailable.' }
    }
    try {
      const res = await window.kunGui.colabDriveCompleteMountAuth({ sessionId })
      if (res.state) get().applyState(res.state)
      return res
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
  },

  openAuth: async (sessionId) => {
    if (typeof window.kunGui?.colabDriveOpenMountAuth !== 'function') return false
    try {
      return (await window.kunGui.colabDriveOpenMountAuth({ sessionId })).ok
    } catch {
      return false
    }
  },

  cancelMount: async (sessionId) => {
    if (typeof window.kunGui?.colabDriveCancelMount === 'function') {
      try {
        const next = await window.kunGui.colabDriveCancelMount({ sessionId })
        get().applyState(next)
        return
      } catch {
        // Fall through to local reset.
      }
    }
    get().applyState({ sessionId, status: 'unmounted' })
  },

  unmount: async (sessionId) => {
    if (typeof window.kunGui?.colabDriveUnmount !== 'function') {
      return { ok: false, message: 'Google Drive unmount bridge is unavailable.' }
    }
    get().applyState({ sessionId, status: 'unmounting' })
    try {
      const res = await window.kunGui.colabDriveUnmount({ sessionId })
      if (res.state) get().applyState(res.state)
      return res
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errState: ColabDriveMountState = { sessionId, status: 'error', message }
      get().applyState(errState)
      return { ok: false, message, state: errState }
    }
  }
}))

let subscribed = false

export function useColabDriveMountSubscription(): void {
  useEffect(() => {
    if (subscribed || typeof window === 'undefined') return
    if (typeof window.kunGui?.onColabDriveMountChanged !== 'function') return
    subscribed = true
    window.kunGui.onColabDriveMountChanged((state) => {
      useColabDriveStore.getState().applyState(state)
    })
  }, [])
}
