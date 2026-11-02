// Error details are untrusted and intentionally remain outside strict persisted schemas.
export function interruptedStreamPartialOutput(details: unknown): boolean | undefined {
  if (!details || typeof details !== 'object') return undefined
  const failure = (details as { modelFailure?: unknown }).modelFailure
  if (!failure || typeof failure !== 'object') return undefined
  const value = failure as { responsePhase?: unknown; partialOutput?: unknown }
  return value.responsePhase === 'interrupted' && typeof value.partialOutput === 'boolean'
    ? value.partialOutput
    : undefined
}
