/**
 * User Agents derived from a builtin engine show that
 * engine's icon. The harness store records the lineage when the catalog
 * loads; an unknown id keeps its own (monogram or generic) icon.
 */
const derivedFrom = new Map<string, string>()

export function rememberAgentIconAliases(rows: readonly { definition: { id: string; derivedFrom?: string } }[]): void {
  for (const row of rows) {
    if (row.definition.derivedFrom) derivedFrom.set(row.definition.id, row.definition.derivedFrom)
    else derivedFrom.delete(row.definition.id)
  }
}

/** The id whose icon an Agent uses. */
export function agentIconId(harnessId: string): string {
  return derivedFrom.get(harnessId) ?? harnessId
}
