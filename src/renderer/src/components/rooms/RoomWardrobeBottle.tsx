import type { ReactElement } from 'react'

/** A corked bottle; its glow color comes from the surrounding rarity token. */
export function WardrobeBottleIcon({ size = 28 }: { size?: number }): ReactElement {
  return <svg className="rooms-wardrobe-bottle-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M13 3h6v4.2l1.6 1.3c1.5 1.2 2.4 3 2.4 4.9V25a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4V13.4c0-1.9.9-3.7 2.4-4.9L13 7.2z"
      fill="var(--wardrobe-glass, #dbe7ff)" stroke="var(--wardrobe-ink, #4b5565)" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M12 2.5h8v2.4h-8z" fill="var(--wardrobe-ink, #4b5565)" />
    <path d="M11.5 17c0-2.2 1.3-3.5 3-4.3" stroke="#ffffffb3" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="16" cy="20" r="3.2" fill="var(--avatar-rarity, var(--ds-accent))" opacity=".85" />
    <circle cx="16" cy="20" r="5.5" fill="var(--avatar-rarity, var(--ds-accent))" opacity=".18" />
  </svg>
}
