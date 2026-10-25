/**
 * A release can carry one interactive card between the intro and the
 * highlights. Cards are code, not markdown, so they are registered here by
 * version rather than parsed from `release/release-v<version>.md`.
 */
export type WhatsNewSpotlight = {
  id: 'focus-mode' | 'artifacts'
  /** Feature titles the card already tells; they leave the highlight rows. */
  covers: RegExp
}

const SPOTLIGHTS: Record<string, WhatsNewSpotlight> = {
  '0.4.1': { id: 'focus-mode', covers: /focus|专注/i },
  '0.4.2': { id: 'artifacts', covers: /^(artifacts library|产物库)$/i }
}

/** With a card, two highlight rows keep the dialog at its usual height. */
export const SPOTLIGHT_HIGHLIGHT_LIMIT = 2

export function whatsNewSpotlight(version: string): WhatsNewSpotlight | null {
  return SPOTLIGHTS[version.trim().replace(/^v/i, '')] ?? null
}
