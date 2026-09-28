/**
 * Legacy provider kind a provider-sourced harness requires (docs/ade): SDK and
 * CLI harnesses only accept provider connections of their own kind, so a
 * `provider`-mode route to a mismatched connection must be refused up front.
 */
export function legacyProviderKindFor(harnessId: string): string | undefined {
  switch (harnessId) {
    case 'claude-code':
      return 'agent-sdk'
    case 'cursor':
      return 'cursor-sdk'
    case 'antigravity':
      return 'antigravity-cli'
    default:
      return undefined
  }
}
