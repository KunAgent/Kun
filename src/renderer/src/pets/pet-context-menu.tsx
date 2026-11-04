import { useEffect, useRef, type ReactElement } from 'react'
import { EyeOff, Settings } from 'lucide-react'

export function PetContextMenu(props: {
  labels: { settings: string; hide: string }
  onSettings: () => void
  onHide: () => void
  onClose: () => void
}): ReactElement {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [])

  return (
    <div ref={menu} id="pet-context-menu" className="pet-menu" role="menu" data-pet-menu
      onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault()
          event.stopPropagation()
          props.onClose()
          return
        }
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        let next: number
        if (event.key === 'ArrowDown') next = (current + 1) % items.length
        else if (event.key === 'ArrowUp') next = (current + items.length - 1) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        items[next]?.focus({ preventScroll: true })
      }}>
      <button type="button" role="menuitem" className="pet-menu-item" data-pet-menu-settings onClick={props.onSettings}>
        <Settings aria-hidden="true" strokeWidth={1.7} />
        <span>{props.labels.settings}</span>
      </button>
      <button type="button" role="menuitem" className="pet-menu-item" data-pet-menu-hide onClick={props.onHide}>
        <EyeOff aria-hidden="true" strokeWidth={1.7} />
        <span>{props.labels.hide}</span>
      </button>
    </div>
  )
}
