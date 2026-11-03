import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { writeFocusModeFloatingLayerClassName } from '../../write/write-focus-mode'
import { inlineAgentPlacement, type WriteInlineAgentPlacement, type WriteInlineAgentPosition } from './write-workspace-view-utils'
import { SelectionMenu } from './selection-menu/SelectionMenu'
import type { SelectionMenuProps } from './selection-menu/menu-types'

export function WriteInlineAgent({ action, preferAbove = false, ...props }: SelectionMenuProps & {
  action: WriteInlineAgentPosition; preferAbove?: boolean
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<WriteInlineAgentPlacement | null>(null)
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const measure = (): void => setPlacement(inlineAgentPlacement(action, {
      menuHeight: el.scrollHeight, viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight, preferAbove
    }))
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(el)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [action, preferAbove])
  return (
    <div className={`write-selection-menu ${writeFocusModeFloatingLayerClassName(props.focusMode ?? false, 'z-50')}`}
      data-selection-ignore="true" data-origin={placement?.origin ?? 'top-center'}
      style={{ left: placement?.left ?? action.left, top: placement?.top ?? action.anchorBottom,
        width: action.width, maxHeight: placement?.maxHeight,
        transformOrigin: placement?.origin.replace('-', ' '), visibility: placement ? 'visible' : 'hidden' }}>
      <div ref={menuRef} className="write-selection-menu-content"
        style={{ maxHeight: placement?.maxHeight, overflowY: placement?.constrained ? 'auto' : 'visible' }}>
        <SelectionMenu {...props} />
      </div>
    </div>
  )
}
