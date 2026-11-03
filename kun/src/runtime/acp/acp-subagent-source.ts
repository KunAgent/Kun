import type { ExternalSubagentSource } from '../../contracts/external-subagent.js'

/** ACP Agents whose tool calls can spawn subagents Kun presents as cards. */
export function acpSubagentSource(harnessId: string): ExternalSubagentSource | undefined {
  switch (harnessId) {
    case 'opencode':
    case 'opencode2':
    case 'codemaker':
    case 'devin':
      return harnessId
    default:
      return undefined
  }
}
