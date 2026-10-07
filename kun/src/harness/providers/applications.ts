import { APPLICATION_HARNESSES } from '../application-harnesses.js'
import type { AgentProviderModule } from './provider-module.js'

/** Desktop applications and editors: integration targets, not turn runtimes. */
export const APPLICATION_MODULES: readonly AgentProviderModule[] =
  APPLICATION_HARNESSES.map((definition) => ({ definition }))
