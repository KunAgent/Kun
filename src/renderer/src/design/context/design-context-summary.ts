import type { DesignContextContribution } from './design-context-contribution'
import type { DesignContextSelection } from './design-context-selection'
import { loadDesignContextSelection } from './design-context-selection'
import { loadDesignContextContributions } from './design-context-resources'

export function buildBoundedDesignContextSummary(input: {
  contributions: readonly DesignContextContribution[]
  selection: DesignContextSelection
  maxTokens?: number
}): string {
  const maxChars = Math.max(0, input.maxTokens ?? 2_000) * 4
  const byId = new Map(input.contributions.map((item) => [item.id, item]))
  const lines = input.selection.selected
    .filter((selected) => selected.enabled)
    .sort((a, b) => a.contributionId.localeCompare(b.contributionId))
    .flatMap((selected) => {
      const contribution = byId.get(selected.contributionId)
      if (!contribution) return [`- ${selected.contributionId}: unavailable (selected version ${selected.version})`]
      const mismatch = selected.version === contribution.version ? '' : `; selected version ${selected.version}`
      const summary = contribution.summary.replace(/\s+/g, ' ').trim().slice(0, 600)
      return [`- ${contribution.id} [${contribution.kind}] v${contribution.version}${mismatch}: ${summary}; detail: design-context://${contribution.id}`]
    })
  const header = 'Selected Design Context resources (summaries only; load detail handles on demand):'
  let output = header
  for (const line of lines) {
    if (`${output}\n${line}`.length > maxChars) break
    output += `\n${line}`
  }
  return lines.length > 0 ? output : ''
}

export async function loadSelectedDesignContextSummary(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot) return ''
  try {
    const [contributions, selection] = await Promise.all([
      loadDesignContextContributions(),
      loadDesignContextSelection(workspaceRoot)
    ])
    return buildBoundedDesignContextSummary({ contributions, selection, maxTokens: 2_000 })
  } catch {
    return ''
  }
}
