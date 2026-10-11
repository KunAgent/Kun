import { sessionInstructions } from '../../session/session-instructions.js'
import { composeSdkPromptText } from '../agent-sdk/sdk-context-assembler.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'

export function cursorSessionPrompt(input: {
  preparation?: DelegatedSessionPreparation
  handoff?: string
  includeHistory: boolean
  history: () => string
  userText: string
  instructionBlocks: readonly string[]
  turnLocalInstructions?: readonly string[]
}): string {
  return composeSdkPromptText({
    handoffBrief: input.handoff,
    historyTranscript: !input.handoff && input.includeHistory ? input.history() : undefined,
    userText: input.userText,
    instructionBlocks: sessionInstructions(input.preparation, input.instructionBlocks, input.includeHistory, input.turnLocalInstructions)
  })
}
