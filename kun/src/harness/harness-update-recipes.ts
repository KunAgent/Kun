/** Host-owned recipes only. Neither providers nor renderer requests supply commands/URLs. */
export type HarnessUpdateRecipe = { command: string; packageName?: string; tag?: string; cask?: string; nativeArgs?: string[] }
export const HARNESS_UPDATE_RECIPES: Readonly<Record<string, HarnessUpdateRecipe>> = {
  'claude-code': { command: 'claude', packageName: '@anthropic-ai/claude-code', cask: 'claude-code', nativeArgs: ['update'] },
  codex: { command: 'codex', packageName: '@openai/codex', cask: 'codex' },
  opencode: { command: 'opencode', packageName: 'opencode-ai' },
  opencode2: { command: 'opencode2', packageName: '@opencode-ai/cli', tag: 'next' },
  pi: { command: 'pi', packageName: '@earendil-works/pi-coding-agent' },
  'deepseek-harness': { command: 'dsh', packageName: '@deepseek-ai/dsh', tag: 'next' },
  devin: { command: 'devin', cask: 'devin-cli' },
  antigravity: { command: 'agy', nativeArgs: ['update'] }
}
