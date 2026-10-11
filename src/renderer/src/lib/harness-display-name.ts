import { useHarnessStore } from '../store/harness-store'

/** Display names for external Agents ("devin" -> "Devin"); unknown ids are shown as-is. */
export function harnessDisplayNames(ids: readonly string[] | undefined): string {
  if (!ids?.length) return ''
  const rows = useHarnessStore.getState().rows
  return ids.map((id) => rows.find((row) => row.definition.id === id)?.definition.displayName ?? id).join(', ')
}
