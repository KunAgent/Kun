import type { ModelContextProfile } from './model-context-profile.js'

/**
 * Provider-scoped profiles win; global profiles only fill in models the
 * provider does not describe. A provider that lists a model without its own
 * capacity facts must not mask a window declared for the same model globally,
 * otherwise the model falls back to the assumed default window.
 */
export function mergeModelContextProfiles(
  primary: readonly ModelContextProfile[],
  fallback: readonly ModelContextProfile[]
): readonly ModelContextProfile[] {
  if (primary === fallback || fallback.length === 0) return primary
  const covered = new Set(primary.flatMap((profile) => [profile.canonicalModel, ...profile.modelIds]))
  const extra = fallback.filter((profile) =>
    !covered.has(profile.canonicalModel) && !profile.modelIds.some((id) => covered.has(id)))
  return extra.length === 0 ? primary : [...primary, ...extra]
}
