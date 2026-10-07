import { DEEPSEEK_HARNESS_DEFINITION } from '../deepseek-harness-definition.js'
import { deepSeekHarnessProfileFingerprint, hasDeepSeekHarnessNativeKey, resolveDeepSeekHarnessNativeKey } from '../deepseek-harness-profile.js'
import type { AgentProviderModule } from './provider-module.js'

export const DEEPSEEK_HARNESS_MODULE: AgentProviderModule = {
  definition: DEEPSEEK_HARNESS_DEFINITION,
  credentials: {
    env: (base): Record<string, string> => {
      const value = resolveDeepSeekHarnessNativeKey(base)
      return value === undefined ? {} : { DEEPSEEK_API_KEY: value }
    },
    configured: (context) => hasDeepSeekHarnessNativeKey(context.merged),
    fingerprint: (env) => deepSeekHarnessProfileFingerprint(env)
  },
  update: { command: 'dsh', packageName: '@deepseek-ai/dsh', tag: 'next' }
}
