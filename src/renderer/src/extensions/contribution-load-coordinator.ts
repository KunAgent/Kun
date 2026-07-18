export type ExtensionContributionLoadContext = Readonly<{
  workspaceRoot: string
  locale: string
}>

export type ExtensionContributionLoadToken = Readonly<{
  generation: number
  contextKey: string
}>

function contextKey(context: ExtensionContributionLoadContext): string {
  return JSON.stringify([context.workspaceRoot, context.locale])
}

export function sameExtensionContributionLoadContext(
  left: ExtensionContributionLoadContext,
  right: ExtensionContributionLoadContext
): boolean {
  return left.workspaceRoot === right.workspaceRoot && left.locale === right.locale
}

/**
 * Coordinates every renderer-side contribution snapshot replacement. A newer
 * request, workspace, or locale invalidates older responses before they can
 * replace the process-wide contribution registry.
 */
export class ExtensionContributionLoadCoordinator {
  private generation = 0
  private activeContextKey = ''

  updateContext(context: ExtensionContributionLoadContext): void {
    const nextKey = contextKey(context)
    if (nextKey === this.activeContextKey) return
    this.activeContextKey = nextKey
    this.generation += 1
  }

  begin(context: ExtensionContributionLoadContext): ExtensionContributionLoadToken {
    const requestedContextKey = contextKey(context)
    if (this.activeContextKey === '') this.updateContext(context)
    if (requestedContextKey !== this.activeContextKey) {
      return { generation: this.generation, contextKey: requestedContextKey }
    }
    this.generation += 1
    return { generation: this.generation, contextKey: this.activeContextKey }
  }

  isCurrent(token: ExtensionContributionLoadToken): boolean {
    return token.generation === this.generation && token.contextKey === this.activeContextKey
  }
}

export const workbenchContributionLoadCoordinator = new ExtensionContributionLoadCoordinator()
