import type { HarnessDefinition } from '../../contracts/harness.js'
import { expandedCliHarnesses } from '../expanded-cli-harnesses.js'
import { EXPANDED_HARNESS_UPDATE_RECIPES } from '../expanded-harness-update-recipes.js'
import { probeFxNativeCredentials } from '../fx-native-credential-probe.js'
import { ACP_DEFAULT_CAPABILITIES } from './capabilities.js'
import type { AgentProviderModule } from './provider-module.js'

/**
 * Spec-driven ACP and terminal CLIs. Their credential formats live in the
 * native credential libraries, which the pipeline consults for every id.
 */
function expandedModule(definition: HarnessDefinition): AgentProviderModule {
  const update = EXPANDED_HARNESS_UPDATE_RECIPES[definition.id]
  return {
    definition,
    ...(update ? { update } : {}),
    // fx keeps its login in the macOS Keychain; its prompt-free status
    // command is configured evidence, never verified authentication.
    ...(definition.id === 'fx' ? { credentials: {
      requireEvidence: true,
      commandEvidence: (command: string | undefined, input: { env: Record<string, string>; signal: AbortSignal }) =>
        probeFxNativeCredentials(command, input)
    } } : {})
  }
}

export const EXPANDED_CLI_MODULES: readonly AgentProviderModule[] =
  expandedCliHarnesses(ACP_DEFAULT_CAPABILITIES).map(expandedModule)
