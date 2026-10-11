import type { ReactElement, ReactNode } from 'react'

/**
 * Settings that only matter while another one is on. Height and opacity ease
 * together so opening a switch never shoves the rest of the page down in one
 * jump; while closed the content stays mounted but is inert and hidden from
 * assistive technology.
 */
export function SettingsReveal({
  open,
  children,
  className = ''
}: {
  open: boolean
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <div
      className={`ds-settings-reveal ${className}`.trim()}
      data-open={open ? 'true' : 'false'}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div className="ds-settings-reveal-inner divide-y divide-ds-border-muted">{children}</div>
    </div>
  )
}
