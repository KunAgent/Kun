import { useEffect } from 'react'
import { create } from 'zustand'
import type { JupyterStateSnapshot } from '@shared/colab/colab-notebook-types'

type JupyterStoreState = {
  snapshot: JupyterStateSnapshot
  setSnapshot: (snapshot: JupyterStateSnapshot) => void
}

export const useJupyterStore = create<JupyterStoreState>((set) => ({
  snapshot: { servers: [], sessions: [] },
  setSnapshot: (snapshot) => set({ snapshot })
}))

let subscriberCount = 0
let teardown: (() => void) | null = null

export function useJupyterSubscription(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.kunGui?.jupyterGetSnapshot) return undefined
    subscriberCount += 1
    if (subscriberCount === 1) {
      void window.kunGui
        .jupyterGetSnapshot()
        .then((snap) => useJupyterStore.getState().setSnapshot(snap))
        .catch(() => undefined)
      teardown =
        window.kunGui.onJupyterStateChanged?.((snap) => {
          useJupyterStore.getState().setSnapshot(snap)
        }) ?? null
    }
    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1)
      if (subscriberCount === 0 && teardown) {
        teardown()
        teardown = null
      }
    }
  }, [])
}
