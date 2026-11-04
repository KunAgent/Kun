import { useLayoutEffect, useRef } from 'react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { useAgentBrowserSurfaceStore } from './agent-browser-surface-store'

export function AgentBrowserSurfaceSlot({ state, variant, layoutVersion }: {
  state: BrowserUseViewState
  variant: 'full' | 'pip'
  layoutVersion?: string | number
}) {
  const element = useRef<HTMLDivElement | null>(null)
  const update = useRef<(() => void) | undefined>(undefined)
  const { threadId, sessionId, turnId } = state
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !threadId || !sessionId) return
    const owner = Symbol('browser-surface')
    const store = useAgentBrowserSurfaceStore.getState()
    let live = true
    const read = () => {
      const rect = node.getBoundingClientRect()
      return { owner, threadId, sessionId, turnId, variant,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    }
    const present = () => { if (live) store.present(read()) }
    update.current = present
    store.claim(read())
    const observer = new ResizeObserver(present)
    observer.observe(node)
    window.addEventListener('resize', present)
    window.addEventListener('scroll', present, true)
    return () => {
      live = false
      observer.disconnect()
      window.removeEventListener('resize', present)
      window.removeEventListener('scroll', present, true)
      if (update.current === present) update.current = undefined
      store.release(threadId, owner)
    }
  }, [threadId, sessionId, turnId, variant])
  useLayoutEffect(() => { update.current?.() }, [layoutVersion])
  return <div ref={element} className="size-full" data-agent-browser-slot={variant} />
}
