import { z } from 'zod'
import { RuntimeEventBase } from './runtime-event-base.js'
import { AgentDispatchIntentPublicSchema } from './agent-dispatch-intents.js'

export const AgentDispatchIntentEvent = RuntimeEventBase.extend({
  kind: z.literal('agent_dispatch_intent'),
  dispatchIntent: AgentDispatchIntentPublicSchema
})
