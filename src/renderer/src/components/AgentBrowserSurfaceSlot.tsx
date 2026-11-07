import { useLayoutEffect, useRef } from 'react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { useAgentBrowserSurfaceStore } from './agent-browser-surface-store'
import { bodyZoom } from '../lib/body-zoom'
import { observeBrowserLayout } from './agent-browser-layout-observer'

export function AgentBrowserSurfaceSlot({ state, variant, layoutVersion, visible = true }: {
  state: BrowserUseViewState
  variant: 'full' | 'pip'
  layoutVersion?: string | number
  visible?: boolean
}) {
  const element = useRef<HTMLDivElement | null>(null)
  const update = useRef<(() => void) | undefined>(undefined)
  const display = useRef(visible)
  display.current = visible
  const { threadId, sessionId, turnId } = state
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !threadId || !sessionId) return
    const owner = Symbol('browser-surface')
    const store = useAgentBrowserSurfaceStore.getState()
    let live = true
    const read = () => {
      const rect = node.getBoundingClientRect()
      return { owner, threadId, sessionId, turnId, variant, visible: display.current, layoutScale: bodyZoom(),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    }
    const present = () => { if (live) store.present(read()) }
    update.current = present
    store.claim(read())
    const unobserve = observeBrowserLayout(node, present)
    return () => {
      live = false
      unobserve()
      if (update.current === present) update.current = undefined
      store.release(threadId, owner)
    }
  }, [threadId, sessionId, turnId, variant])
  useLayoutEffect(() => { update.current?.() }, [layoutVersion, visible])
  return <div ref={element} className="size-full" data-agent-browser-slot={variant} />
}
