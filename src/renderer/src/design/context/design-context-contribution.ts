export type DesignContextContributionKind = 'design-system' | 'skill' | 'component' | 'asset'

export type DesignContextContribution = {
  id: string
  kind: DesignContextContributionKind
  title: string
  summary: string
  version: string
  loadDetail: () => Promise<unknown>
}

export class DesignContextContributionRegistry {
  private readonly contributions = new Map<string, DesignContextContribution>()

  register(contribution: DesignContextContribution): void {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`Duplicate design context contribution: ${contribution.id}`)
    }
    this.contributions.set(contribution.id, contribution)
  }

  registerAll(contributions: readonly DesignContextContribution[]): void {
    for (const contribution of contributions) this.register(contribution)
  }

  list(kind?: DesignContextContributionKind): DesignContextContribution[] {
    return [...this.contributions.values()]
      .filter((contribution) => !kind || contribution.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}
