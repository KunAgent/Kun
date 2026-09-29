import './rooms-workbench.css'
import { useEffect } from 'react'
import { create } from 'zustand'

type Flash = { id: number; text: string; tone: 'ok' | 'error' }
type FlashState = { flash: Flash | null; show: (text: string, tone?: Flash['tone']) => void; clear: (id: number) => void }

let sequence = 0
export const useWorkbenchFlash = create<FlashState>((set) => ({
  flash: null,
  show: (text, tone = 'ok') => set({ flash: { id: ++sequence, text, tone } }),
  clear: (id) => set((state) => state.flash?.id === id ? { flash: null } : state)
}))
export const showWorkbenchFlash = (text: string, tone: Flash['tone'] = 'ok'): void => useWorkbenchFlash.getState().show(text, tone)

/** A small, self-dismissing notice for actions taken from Code or Work (send to bot, watch). */
export function WorkbenchFlash() {
  const flash = useWorkbenchFlash((state) => state.flash)
  const clear = useWorkbenchFlash((state) => state.clear)
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => clear(flash.id), 4000)
    return () => clearTimeout(timer)
  }, [flash, clear])
  if (!flash) return null
  return <div className={`workbench-flash workbench-flash-${flash.tone}`} role="status" aria-live="polite">{flash.text}</div>
}
