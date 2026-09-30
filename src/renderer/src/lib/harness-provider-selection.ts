import type { AdeHarnessProviderModelGroup } from '@shared/ade-harnesses'

type Selection = { providerId?: string; model?: string }
/** Pick only inside this harness's eligible sources; ambiguity remains a user choice. */
export function selectHarnessProvider(
  groups: readonly AdeHarnessProviderModelGroup[], defaults: Selection | undefined, previous: Selection
): { providerId: string; model: string } {
  const preferred = defaults?.providerId || previous.providerId
  const group = groups.find((entry) => entry.providerId === preferred) ??
    (!defaults?.providerId && groups.length === 1 ? groups[0] : undefined)
  if (!group) return { providerId: '', model: '' }
  const model = defaults?.providerId === group.providerId && defaults.model
    ? defaults.model
    : previous.providerId === group.providerId && previous.model && group.models.includes(previous.model)
      ? previous.model : group.models[0] ?? ''
  return { providerId: group.providerId, model }
}
