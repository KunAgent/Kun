import type { ReactElement } from 'react'

/**
 * papers.cool mark — a snowflake, matching the "cool" branding. Drawn inline so
 * it can inherit `currentColor` like the lucide icons used around it.
 */
export function CoolPapersIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3v18" />
      <path d="M4.2 7.5l15.6 9" />
      <path d="M19.8 7.5l-15.6 9" />
      <path d="M12 3l-2.2 2.4M12 3l2.2 2.4" />
      <path d="M12 21l-2.2-2.4M12 21l2.2-2.4" />
      <path d="M4.2 7.5l3.2.5M4.2 7.5l.5 3.2" />
      <path d="M19.8 16.5l-3.2-.5M19.8 16.5l-.5-3.2" />
      <path d="M19.8 7.5l-3.2.5M19.8 7.5l-.5 3.2" />
      <path d="M4.2 16.5l3.2-.5M4.2 16.5l.5-3.2" />
    </svg>
  )
}
