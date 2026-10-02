import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { workbenchDividerClassName } from './workbench-divider'

type ElementProps = HTMLAttributes<HTMLDivElement> & { [key: `data-${string}`]: unknown }

type Props = {
  visible: boolean
  width: number
  header: ReactNode
  children: ReactNode
  panelRef?: Ref<HTMLDivElement>
  panelProps?: ElementProps
  dividerProps: ElementProps
  className?: string
}

/** Shared physical frame for Code and conversation-owned right workspaces. */
export function WorkbenchRightSidebar({ visible, width, header, children, panelRef,
  panelProps, dividerProps, className = '' }: Props) {
  return <>
    <div {...dividerProps} role="separator" aria-orientation="vertical"
      className={`${visible ? '' : 'hidden '}${workbenchDividerClassName('chat')}`} />
    <div {...panelProps} ref={panelRef} data-workbench-right-panel
      className={`${visible ? 'flex' : 'hidden'} ds-sidebar-surface h-full min-h-0 min-w-0 shrink-0 flex-col ${className}`}
      style={{ width }}>
      {header}
      <div className="ds-sidebar-surface-body relative min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  </>
}
