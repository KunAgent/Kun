import type { HarnessUpdateRecipe } from './harness-update-recipes.js'

/** Fixed publisher identities. Native installers and Python packages need their own update adapters. */
export const EXPANDED_HARNESS_UPDATE_RECIPES: Readonly<Record<string, HarnessUpdateRecipe>> = {
  copilot: { command: 'copilot', packageName: '@github/copilot' },
  cline: { command: 'cline', packageName: 'cline' },
  crush: { command: 'crush', packageName: '@charmland/crush' },
  commandcode: { command: 'command-code', packageName: 'command-code' },
  omo: { command: 'omo', packageName: 'omo-ai', nativeArgs: ['update'] },
  omp: { command: 'omp', packageName: '@oh-my-pi/pi-coding-agent' },
  'minimax-code': { command: 'mcode', packageName: '@minimax-ai/code' },
  mimocode: { command: 'mimo', packageName: '@mimo-ai/cli' },
  kimi: { command: 'kimi', packageName: '@moonshot-ai/kimi-code' },
  droid: { command: 'droid', packageName: 'droid' },
  qoder: { command: 'qoder', packageName: '@qoder-ai/qodercli' },
  'qoder-cn': { command: 'qodercn', packageName: '@qodercn-ai/qoderclicn' },
  atomcode: { command: 'atomcode', packageName: '@atomgit.com/atomcode', cask: 'atomcode' }
}
