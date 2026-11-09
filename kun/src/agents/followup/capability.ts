import { FOLLOW_UP_API_VERSION, FollowUpCapability } from '../../contracts/collaboration-followup-api.js'
import type { FollowUpFeatures } from './state.js'

/**
 * Advertises what can actually run. `auto` continuation and `observe` new work are declared
 * in the policy contract but have no executor, so they are never offered to a client.
 */
export function followUpCapability(features: FollowUpFeatures): FollowUpCapability {
  return FollowUpCapability.parse({
    apiVersion: FOLLOW_UP_API_VERSION,
    features: {
      tracking: features.enabled,
      manualContinuation: features.enabled,
      attention: features.enabled,
      sourceGrants: features.enabled && features.github,
      githubReader: features.enabled && features.github
    },
    modes: { continuation: ['manual'], newWork: ['off'] }
  })
}
