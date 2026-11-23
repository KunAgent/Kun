/** Rebuild only after an explicit rejection of the exact requested native session. */
export function isMissingAntigravitySession(error: unknown, nativeSessionId: string): boolean {
  if (!(error instanceof Error)) return false
  const match = /\b(?:conversation|session)(?:\s+(?:id|identifier))?\s+(\S+)\s+(?:(?:was\s+|is\s+)?not found|(?:does|did)\s+not\s+exist|no longer exists)\b/i.exec(error.message)
  return match?.[1]?.replace(/^["']|["']$/g, '') === nativeSessionId
}
