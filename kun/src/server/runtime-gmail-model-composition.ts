import { assertEncryptedGmailStorage } from '../gmail/data-protection.js'
import { createGmailThreadDataPolicyOptions } from '../gmail/thread-data-state.js'
import type { GmailModelDataPolicyOptions, GmailModelSelection } from '../gmail/model-data-policy.js'
import type { GmailServicePort } from '../gmail/ports.js'
import type { ThreadStore } from '../ports/thread-store.js'

/** Gmail grants belong to the private conversation and follow normal configured model routing. */
export function createRuntimeGmailModelPolicy(input: {
  threads: ThreadStore; gmail: GmailServicePort; dataDir: string
  fallback: () => GmailModelSelection
}): GmailModelDataPolicyOptions {
  const policy = createGmailThreadDataPolicyOptions(input.threads, input.gmail, input.fallback)
  return { ...policy, dataState: async (...args: Parameters<typeof policy.dataState>) => {
    const state = await policy.dataState(...args)
    if (state.sensitive) await assertEncryptedGmailStorage(input.dataDir)
    return state
  } }
}
