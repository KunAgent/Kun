import { buildClawRuntimePrompt, buildCodeRuntimePrompt } from '@shared/app-settings'
import type { ClawImChannelV1 } from '@shared/app-settings'

export function runtimePromptForSurface(input: {
  channel: ClawImChannelV1 | null
  requestedAgentSurface: 'code' | 'write' | 'design' | undefined
  writeContext: unknown
  settings: Parameters<typeof buildClawRuntimePrompt>[0] & Parameters<typeof buildCodeRuntimePrompt>[0]
  prompt: string
}): string {
  if (input.channel) {
    return buildClawRuntimePrompt(input.settings, input.prompt, { channel: input.channel })
  }
  if (input.requestedAgentSurface === 'write' || input.writeContext) return input.prompt
  return buildCodeRuntimePrompt(input.settings, input.prompt)
}
