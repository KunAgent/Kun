/**
 * Mobile composers clear their draft the moment a message is submitted; a send
 * that the store later rejects puts the text back without clobbering anything
 * typed since.
 */
export function mergeRestoredDraft(restored: string, current: string): string {
  const text = restored.trim()
  if (!text) return current
  if (!current.trim()) return text
  if (current.trim() === text || current.startsWith(`${text}\n\n`)) return current
  return `${text}\n\n${current}`
}
