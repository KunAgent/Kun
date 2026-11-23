import { useEffect } from 'react'
import { create } from 'zustand'
import type {
  ColabPortForwardStartRequest,
  ColabPortForwardStartResult,
  ColabPortForwardView
} from '@shared/colab/colab-notebook-types'

type PortForwardStore = {
  forwards: ColabPortForwardView[]
  setForwards: (forwards: ColabPortForwardView[]) => void
  refresh: () => Promise<void>
  startForward: (input: ColabPortForwardStartRequest) => Promise<ColabPortForwardStartResult>
  stopForward: (forwardId: string) => Promise<void>
}

export const useColabPortForwardStore = create<PortForwardStore>((set) => ({
  forwards: [],
  setForwards: (forwards) => set({ forwards }),
  refresh: async () => {
    if (typeof window === 'undefined' || typeof window.kunGui?.colabPortForwardList !== 'function') {
      return
    }
    try {
      set({ forwards: await window.kunGui.colabPortForwardList() })
    } catch {
      // Host unavailable in headless unit tests.
    }
  },
  startForward: async (input) => {
    if (typeof window.kunGui?.colabPortForwardStart !== 'function') {
      return { ok: false, message: 'Port forwarding bridge is unavailable.' }
    }
    const res = await window.kunGui.colabPortForwardStart(input)
    if (res.ok) {
      set((state) => ({
        forwards: [...state.forwards.filter((item) => item.id !== res.forward.id), res.forward]
      }))
    }
    return res
  },
  stopForward: async (forwardId) => {
    if (typeof window.kunGui?.colabPortForwardStop === 'function') {
      await window.kunGui.colabPortForwardStop({ forwardId })
    }
    set((state) => ({ forwards: state.forwards.filter((item) => item.id !== forwardId) }))
  }
}))

let subscribed = false

export function useColabPortForwardSubscription(): void {
  useEffect(() => {
    if (subscribed || typeof window === 'undefined') return
    if (typeof window.kunGui?.onColabPortForwardsChanged !== 'function') return
    subscribed = true
    window.kunGui.onColabPortForwardsChanged((forwards) => {
      useColabPortForwardStore.getState().setForwards(forwards)
    })
    void useColabPortForwardStore.getState().refresh()
  }, [])
}
