import type { PreparedThreadSend } from './chat-store-thread-send-direct-types'
import { rememberThreadComposerSelection } from './chat-store-helpers'

/** Persist the submitted route, including its alias scope, after asynchronous thread preparation. */
export function rememberSubmittedComposerRoute(threadId: string, input: Pick<PreparedThreadSend,
  'composerModel' | 'composerProviderId' | 'composerHarnessId' | 'composerCredentialMode' | 'composerGatewayBinding'>): void {
  rememberThreadComposerSelection(threadId, input.composerModel, input.composerProviderId, 'user',
    input.composerHarnessId ? { harnessId: input.composerHarnessId, credentialMode: input.composerCredentialMode,
      ...(input.composerGatewayBinding ? { gatewayBinding: input.composerGatewayBinding } : {}) } : undefined)
}
