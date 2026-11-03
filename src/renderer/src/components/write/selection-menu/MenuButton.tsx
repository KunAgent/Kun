import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

/** Mouse actions retain the selection. Touch/pen activation suppresses the subsequent synthetic click. */
export function MenuButton({ label, onActivate, children, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  label: string; onActivate: () => void; children: ReactNode
}): ReactElement {
  return <button type="button" aria-label={label} title={label} {...props}
    onPointerDown={(event) => { event.stopPropagation(); if (event.pointerType !== 'mouse') event.preventDefault() }}
    onPointerUp={(event) => {
      if (event.pointerType === 'mouse') return
      event.preventDefault(); event.stopPropagation()
      if (!props.disabled) onActivate()
    }}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }}
    onClick={(event) => {
      if ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType && event.nativeEvent.pointerType !== 'mouse') return
      onActivate()
    }}>{children}</button>
}
