/**
 * Re-export shim: the plan-context and user-input gate helpers moved to the
 * shared transport-independent Kun tool bridge host (docs/ade/05 §3.2).
 */
export { resolveTurnPlanContext, waitForGate } from '../../harness/kun-tool-bridge-host.js'
